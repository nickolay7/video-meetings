import {
  createSdkMcpServer,
  tool,
  type AnyZodRawShape,
  type McpServerConfig,
} from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TasksRepository } from '../tasks/tasks.repository';

/**
 * DI-токен фабрики MCP-серверов встречи: `(meetingId) => server`. Каждый вызов создаёт
 * сервер, скопированный под конкретную встречу: `meetingId` модель не передаёт и не может
 * переключить инструменты на чужую встречу (защита от prompt injection — untrusted-текст
 * транскрипции в промпте не может подменить встречу).
 */
export const MEETING_MCP_SERVER_FACTORY = Symbol('MEETING_MCP_SERVER_FACTORY');

/** Фабрика MCP-сервера встречи, привязанного к заданной встрече. */
export type MeetingMcpServerFactory = (meetingId: string) => McpServerConfig;

/** Зависимости инструментов: репозитории Task и Meeting (обычные классы, без DI). */
export interface MeetingToolDeps {
  tasksRepository: TasksRepository;
  meetingsRepository: MeetingsRepository;
}

/** Текстовый результат MCP-инструмента: данные сериализуются в JSON. */
function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** Ошибка MCP-инструмента: isError + текст ошибки в JSON. */
function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

/**
 * Тип аргументов инструмента с опциональным `meetingId`: для скопированной схемы
 * meetingId отсутствует (подставляется из scopedMeetingId), остальные поля сохраняют
 * обязательность из исходной схемы.
 */
type WithOptionalMeetingId<T extends { meetingId: string }> = Omit<T, 'meetingId'> & {
  meetingId?: string;
};

// В tool() передаётся `.shape` (тип `AnyZodRawShape`), а парсинг аргументов
// выполняется полной схемой `z.object(...)` — рантайм SDK сам оборачивает shape
// в ZodObject и валидирует вход, parse здесь нужен как защита для прямых вызовов.
//
// Каждый инструмент принимает `scopedMeetingId`. Когда он задан (генерация инсайтов),
// `meetingId` убирается из схемы: модель физически не может указать другую встречу,
// поэтому untrusted-контент (текст транскрипции в промпте) не может переключить
// инструмент на чужую встречу. Без scopedMeetingId инструмент работает как раньше
// (meetingId задаёт модель) — такой режим пригоден только для доверенного контекста.

const findTaskSchema = z.object({
  meetingId: z.string(),
  status: z.enum(['open', 'completed']).optional(),
  assignee: z.string().optional(),
  taskId: z.string().optional(),
});

type FindTaskParams = z.infer<typeof findTaskSchema>;

const findTaskDescription = (scoped: boolean) =>
  scoped
    ? 'Search tasks of the current meeting by optional filters (status, assignee, task id). Returns a list of matching tasks.'
    : 'Search tasks of a meeting by optional filters (status, assignee, task id). Returns a list of matching tasks.';

/** Поиск существующих задач встречи по параметрам (статус, исполнитель, id). */
export function findTaskTool(deps: MeetingToolDeps, scopedMeetingId?: string) {
  const schema =
    scopedMeetingId === undefined ? findTaskSchema : findTaskSchema.omit({ meetingId: true });
  return tool(
    'findTask',
    findTaskDescription(scopedMeetingId !== undefined),
    schema.shape as AnyZodRawShape,
    async (args: unknown) => {
      const params = schema.parse(args) as WithOptionalMeetingId<FindTaskParams>;
      const meetingId = scopedMeetingId ?? params.meetingId;
      if (meetingId === undefined) {
        return errorResult('meetingId is required');
      }
      const meeting = await deps.meetingsRepository.findById(meetingId);
      if (!meeting) {
        return errorResult(`Meeting with id ${meetingId} not found`);
      }
      const tasks = await deps.tasksRepository.findAllByMeeting(meetingId);
      const matchingTasks = tasks.filter((task) => {
        if (params.status !== undefined && task.status !== params.status) return false;
        if (params.assignee !== undefined && task.assignee !== params.assignee) return false;
        if (params.taskId !== undefined && task.id !== params.taskId) return false;
        return true;
      });
      return textResult(matchingTasks);
    },
  );
}

const updateTaskSchema = z.object({
  meetingId: z.string(),
  taskId: z.string().optional(),
  title: z.string().optional(),
  assignee: z.string().optional(),
  status: z.enum(['open', 'completed']).optional(),
  source: z.enum(['manual', 'insights']).optional(),
});

type UpdateTaskParams = z.infer<typeof updateTaskSchema>;

const updateTaskDescription = (scoped: boolean) =>
  scoped
    ? 'Create a new task for the current meeting, or update an existing task (title, assignee, status). Provide taskId to update; without it a new task is created. When creating a task generated from meeting insights, set source to "insights".'
    : 'Create a new task for a meeting, or update an existing task (title, assignee, status). Provide taskId to update; without it a new task is created. When creating a task generated from meeting insights, set source to "insights".';

/**
 * Создание новой задачи встречи или обновление существующей: переданные поля
 * title/assignee/status применяются к задаче по taskId. При создании (без taskId)
 * `source` по умолчанию `manual`; агент инсайтов передаёт `insights`, чтобы задачи
 * можно было очищать при перегенерации.
 */
export function updateTaskTool(deps: MeetingToolDeps, scopedMeetingId?: string) {
  const schema =
    scopedMeetingId === undefined ? updateTaskSchema : updateTaskSchema.omit({ meetingId: true });
  return tool(
    'updateTask',
    updateTaskDescription(scopedMeetingId !== undefined),
    schema.shape as AnyZodRawShape,
    async (args: unknown) => {
      const params = schema.parse(args) as WithOptionalMeetingId<UpdateTaskParams>;
      const meetingId = scopedMeetingId ?? params.meetingId;
      if (meetingId === undefined) {
        return errorResult('meetingId is required');
      }
      const meeting = await deps.meetingsRepository.findById(meetingId);
      if (!meeting) {
        return errorResult(`Meeting with id ${meetingId} not found`);
      }
      if (params.taskId !== undefined) {
        const task = await deps.tasksRepository.findById(params.taskId);
        if (!task || task.meetingId !== meetingId) {
          return errorResult(`Task with id ${params.taskId} not found`);
        }
        const updatedTask = await deps.tasksRepository.updateTask(task, {
          title: params.title,
          assignee: params.assignee,
          status: params.status,
        });
        return textResult(updatedTask);
      }
      if (params.title === undefined) {
        return errorResult('title is required to create a task');
      }
      const createdTask = await deps.tasksRepository.create(
        meetingId,
        params.title,
        params.source ?? 'manual',
        params.assignee,
      );
      return textResult(createdTask);
    },
  );
}

const updateMeetingSchema = z.object({
  meetingId: z.string(),
  summary: z.string(),
});

type UpdateMeetingParams = z.infer<typeof updateMeetingSchema>;

const updateMeetingDescription = (scoped: boolean) =>
  scoped
    ? 'Update the current meeting by writing its summary text.'
    : 'Update a meeting by writing its summary text.';

/** Обновление встречи: запись summary. */
export function updateMeetingTool(deps: MeetingToolDeps, scopedMeetingId?: string) {
  const schema =
    scopedMeetingId === undefined
      ? updateMeetingSchema
      : updateMeetingSchema.omit({ meetingId: true });
  return tool(
    'updateMeeting',
    updateMeetingDescription(scopedMeetingId !== undefined),
    schema.shape as AnyZodRawShape,
    async (args: unknown) => {
      const params = schema.parse(args) as WithOptionalMeetingId<UpdateMeetingParams>;
      const meetingId = scopedMeetingId ?? params.meetingId;
      if (meetingId === undefined) {
        return errorResult('meetingId is required');
      }
      const meeting = await deps.meetingsRepository.findById(meetingId);
      if (!meeting) {
        return errorResult(`Meeting with id ${meetingId} not found`);
      }
      const updatedMeeting = await deps.meetingsRepository.updateSummary(meeting, params.summary);
      return textResult(updatedMeeting);
    },
  );
}

/**
 * MCP-сервер `meeting` с набором инструментов встречи. Конфиг пригоден для передачи
 * в `query({ mcpServers: { meeting: server } })` и переиспользуется как отдельный
 * MCP-сервер вне NestJS (инструменты зависят только от репозиториев).
 *
 * Опция `meetingId` скопирует сервер под конкретную встречу: `meetingId` убирается из
 * схем инструментов, и модель не может переключиться на другую встречу. Для контекста
 * с untrusted-входом (текст транскрипции в промпте) скопированный сервер обязателен.
 */
export function createMeetingMcpServer(
  deps: MeetingToolDeps,
  options: { meetingId?: string } = {},
) {
  return createSdkMcpServer({
    name: 'meeting',
    version: '1.0.0',
    tools: [
      findTaskTool(deps, options.meetingId),
      updateTaskTool(deps, options.meetingId),
      updateMeetingTool(deps, options.meetingId),
    ],
  });
}
