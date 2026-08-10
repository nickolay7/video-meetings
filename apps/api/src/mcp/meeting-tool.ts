import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TasksRepository } from '../tasks/tasks.repository';

/**
 * DI-токен MCP-сервера встречи: конфиг для `query({ mcpServers: { meeting: ... } })`,
 * собранный из инструментов этого файла.
 */
export const MEETING_MCP_SERVER = Symbol('MEETING_MCP_SERVER');

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

// В tool() передаётся `.shape` (тип `AnyZodRawShape`), а парсинг аргументов
// выполняется полной схемой `z.object(...)` — рантайм SDK сам оборачивает shape
// в ZodObject и валидирует вход, parse здесь нужен как защита для прямых вызовов.

const findTaskSchema = z.object({
  meetingId: z.string(),
  status: z.enum(['open', 'completed']).optional(),
  assignee: z.string().optional(),
  taskId: z.string().optional(),
});

/** Поиск существующих задач встречи по параметрам (статус, исполнитель, id). */
export function findTaskTool(deps: MeetingToolDeps) {
  return tool(
    'findTask',
    'Search tasks of a meeting by optional filters (status, assignee, task id). Returns a list of matching tasks.',
    findTaskSchema.shape,
    async (args) => {
      const params = findTaskSchema.parse(args);
      const meeting = await deps.meetingsRepository.findById(params.meetingId);
      if (!meeting) {
        return errorResult(`Meeting with id ${params.meetingId} not found`);
      }
      const tasks = await deps.tasksRepository.findAllByMeeting(params.meetingId);
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

/**
 * Создание новой задачи встречи или обновление существующей: переданные поля
 * title/assignee/status применяются к задаче по taskId. При создании (без taskId)
 * `source` по умолчанию `manual`; агент инсайтов передаёт `insights`, чтобы задачи
 * можно было очищать при перегенерации.
 */
export function updateTaskTool(deps: MeetingToolDeps) {
  return tool(
    'updateTask',
    'Create a new task for a meeting, or update an existing task (title, assignee, status). Provide taskId to update; without it a new task is created. When creating a task generated from meeting insights, set source to "insights".',
    updateTaskSchema.shape,
    async (args) => {
      const params = updateTaskSchema.parse(args);
      const meeting = await deps.meetingsRepository.findById(params.meetingId);
      if (!meeting) {
        return errorResult(`Meeting with id ${params.meetingId} not found`);
      }
      if (params.taskId !== undefined) {
        const task = await deps.tasksRepository.findById(params.taskId);
        if (!task || task.meetingId !== params.meetingId) {
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
        params.meetingId,
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

/** Обновление встречи: запись summary. */
export function updateMeetingTool(deps: MeetingToolDeps) {
  return tool(
    'updateMeeting',
    'Update a meeting by writing its summary text.',
    updateMeetingSchema.shape,
    async (args) => {
      const params = updateMeetingSchema.parse(args);
      const meeting = await deps.meetingsRepository.findById(params.meetingId);
      if (!meeting) {
        return errorResult(`Meeting with id ${params.meetingId} not found`);
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
 */
export function createMeetingMcpServer(deps: MeetingToolDeps) {
  return createSdkMcpServer({
    name: 'meeting',
    version: '1.0.0',
    tools: [findTaskTool(deps), updateTaskTool(deps), updateMeetingTool(deps)],
  });
}
