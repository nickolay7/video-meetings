import { readFileSync } from 'node:fs';
import { NotFoundException } from '@nestjs/common';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ErrorCode,
  McpError,
  type CallToolResult,
  type GetPromptResult,
  type ReadResourceResult,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod/v4';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { Meeting } from '../meetings/meeting.entity';
import { TasksRepository } from '../tasks/tasks.repository';
import { TasksService } from '../tasks/tasks.service';
import { Task, TaskSource, TaskStatus } from '../tasks/task.entity';
import { MeetingOwner } from './meeting-owner';

/**
 * Автономный MCP-сервер встречи с транспортом stdio. Имя и версия задаются в конструкторе
 * `McpServer` из SDK — они попадают в `serverInfo` JSON-описания сервера (ответ на `initialize`).
 *
 * Регистрирует инструменты `findTask` (поиск задач встречи) и `addTask` (создание задачи),
 * ресурсы `tasks://open` (открытые задачи) и `task://{id}` (задача по id), а также промпты
 * `meeting_brief` и `meeting_task_review`. `meeting_id` приходит извне, поэтому в инпут
 * передаётся `user_id`, и перед доступом к данным `MeetingOwner` проверяет, что встреча
 * принадлежит именно этому пользователю. Весь доступ к данным задач идёт через единый
 * сервисный слой `TasksService`.
 */
export const SERVER_NAME = 'meeting-tasks';
export const SERVER_VERSION = '1.0.0';

/**
 * Зависимости сервера: репозиторий встреч и сервис задач (обычные классы, без контейнера
 * Nest — `TasksService` инстанцируется напрямую). Инструменты/ресурсы/промпты работают
 * только через `TasksService`, а не через репозиторий задач напрямую.
 */
export interface MeetingTasksMcpServerDeps {
  meetingsRepository: MeetingsRepository;
  tasksService: TasksService;
}

const findTaskSchema = z.object({
  query: z.string(),
  meeting_id: z.string(),
  user_id: z.string(),
});

const addTaskSchema = z.object({
  meeting_id: z.string(),
  user_id: z.string(),
  title: z.string(),
  assignee: z.string().optional(),
  source: z.enum(['manual', 'insights']).optional(),
});

/** Текстовый результат MCP-инструмента: данные сериализуются в JSON. */
function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

/** Ошибка MCP-инструмента: isError + текст ошибки в JSON. */
function errorResult(error: unknown): CallToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
}

/** Текстовое содержимое ресурса: данные сериализуются в JSON. */
function textResourceContents(uri: string, data: unknown): ReadResourceResult['contents'] {
  return [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }];
}

/** Сообщение промпта с ролью user — структурированный контент с подставленным текстом. */
function userPromptMessage(text: string): GetPromptResult['messages'][number] {
  return { role: 'user', content: { type: 'text', text } };
}

/**
 * Регистрирует инструмент `findTask`: поиск задач встречи по текстовому `query`
 * (регистронезависимая подстрока по названию задачи, пустой query — все задачи).
 * Данные читаются через `TasksService.listForMeeting`. Перед возвратом данных проверяет
 * через `MeetingOwner`, что встреча принадлежит `user_id`. Только чтение — `readOnlyHint: true`.
 */
export function registerFindTaskTool(server: McpServer, deps: MeetingTasksMcpServerDeps) {
  const meetingOwner = new MeetingOwner(deps.meetingsRepository);
  return server.registerTool(
    'findTask',
    {
      title: 'Search meeting tasks',
      description: 'Search tasks of a meeting by a text query. Returns matching tasks.',
      inputSchema: findTaskSchema.shape,
      annotations: {
        title: 'Search meeting tasks',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (args) => {
      try {
        const params = findTaskSchema.parse(args);
        await meetingOwner.findOwnedByUser(params.user_id, params.meeting_id);
        const tasks = await deps.tasksService.listForMeeting(params.meeting_id);
        const query = params.query.trim().toLowerCase();
        const matchingTasks =
          query === '' ? tasks : tasks.filter((task) => task.title.toLowerCase().includes(query));
        return textResult(matchingTasks);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

/**
 * Регистрирует инструмент `addTask`: создание задачи встречи через `TasksService.createTask`.
 * Перед созданием проверяет через `MeetingOwner`, что встреча принадлежит `user_id`.
 * Запись — `readOnlyHint: false`.
 */
export function registerAddTaskTool(server: McpServer, deps: MeetingTasksMcpServerDeps) {
  const meetingOwner = new MeetingOwner(deps.meetingsRepository);
  return server.registerTool(
    'addTask',
    {
      title: 'Add a meeting task',
      description: 'Create a new task for a meeting. Returns the created task.',
      inputSchema: addTaskSchema.shape,
      annotations: {
        title: 'Add a meeting task',
        readOnlyHint: false,
      },
    },
    async (args) => {
      try {
        const params = addTaskSchema.parse(args);
        await meetingOwner.findOwnedByUser(params.user_id, params.meeting_id);
        const task = await deps.tasksService.createTask(
          params.meeting_id,
          params.title,
          params.source ?? 'manual',
          params.assignee,
        );
        return textResult(task);
      } catch (error) {
        return errorResult(error);
      }
    },
  );
}

/**
 * Регистрирует статический ресурс `tasks://open`: список открытых задач всех встреч
 * через `TasksService.listOpenTasks`. Авторизация не реализована — данные без ограничений.
 */
export function registerOpenTasksResource(server: McpServer, deps: MeetingTasksMcpServerDeps) {
  return server.registerResource(
    'tasks.open',
    'tasks://open',
    {
      title: 'Open tasks',
      description: 'List of open tasks across all meetings',
      mimeType: 'application/json',
    },
    async (uri) => {
      const tasks = await deps.tasksService.listOpenTasks();
      return { contents: textResourceContents(uri.toString(), tasks) };
    },
  );
}

/**
 * Регистрирует динамический ресурс `task://{id}`: данные конкретной задачи по её id через
 * `TasksService.getTaskById`. Авторизация не реализована — задача доступна по любому id;
 * несуществующий id даёт ошибку чтения ресурса (`InvalidParams`).
 */
export function registerTaskByIdResource(server: McpServer, deps: MeetingTasksMcpServerDeps) {
  return server.registerResource(
    'task',
    new ResourceTemplate('task://{id}', { list: undefined }),
    {
      title: 'Task by id',
      description: 'A single task of any meeting by its id',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const taskId = Array.isArray(variables.id) ? variables.id[0] : variables.id;
      try {
        const task = await deps.tasksService.getTaskById(taskId);
        return { contents: textResourceContents(uri.toString(), task) };
      } catch (error) {
        if (error instanceof NotFoundException) {
          throw new McpError(ErrorCode.InvalidParams, error.message);
        }
        throw error;
      }
    },
  );
}

const meetingArgsSchema = z.object({ meeting_id: z.string() });

/** Единый путь: найти встречу по id, иначе — ошибка чтения промпта. */
async function findMeetingForPrompt(
  deps: MeetingTasksMcpServerDeps,
  meetingId: string,
): Promise<Meeting> {
  const meeting = await deps.meetingsRepository.findById(meetingId);
  if (!meeting) {
    throw new McpError(ErrorCode.InvalidParams, `Meeting with id ${meetingId} not found`);
  }
  return meeting;
}

/**
 * Регистрирует промпт `meeting_brief`: собирает информацию о встрече (название, описание,
 * summary) и формирует готовый бриф для дальнейшей работы.
 */
export function registerMeetingBriefPrompt(server: McpServer, deps: MeetingTasksMcpServerDeps) {
  return server.registerPrompt(
    'meeting_brief',
    {
      title: 'Meeting Brief',
      description: 'Collect information about a meeting and prepare a brief',
      argsSchema: meetingArgsSchema.shape,
    },
    async (args) => {
      const meeting = await findMeetingForPrompt(deps, args.meeting_id);
      const brief = [
        `Meeting Brief: ${meeting.name}`,
        `ID: ${meeting.id}`,
        `Description: ${meeting.description || '—'}`,
        `Summary: ${meeting.summary ?? 'not generated yet'}`,
        '',
        'Use this information to brief someone about the meeting. Ask the user for any missing details.',
      ].join('\n');
      return { messages: [userPromptMessage(brief)] };
    },
  );
}

/**
 * Регистрирует промпт `meeting_task_review`: находит встречу, агрегирует связанные задачи
 * через `TasksService.listForMeeting` и формирует готовый промпт для ревью задач.
 */
export function registerMeetingTaskReviewPrompt(
  server: McpServer,
  deps: MeetingTasksMcpServerDeps,
) {
  return server.registerPrompt(
    'meeting_task_review',
    {
      title: 'Meeting Task Review',
      description: 'Review the tasks associated with a meeting',
      argsSchema: meetingArgsSchema.shape,
    },
    async (args) => {
      const meeting = await findMeetingForPrompt(deps, args.meeting_id);
      const tasks = await deps.tasksService.listForMeeting(meeting.id);
      const taskLines =
        tasks.length === 0
          ? ['(no tasks yet)']
          : tasks.map((task, index) => {
              const assignee = task.assignee ? ` (assignee: ${task.assignee})` : '';
              return `${index + 1}. [${task.status}] ${task.title}${assignee}`;
            });
      const review = [
        `Meeting Task Review: ${meeting.name}`,
        `ID: ${meeting.id}`,
        `Summary: ${meeting.summary ?? 'not generated yet'}`,
        '',
        'Tasks:',
        ...taskLines,
        '',
        'Review the task list: flag unassigned tasks, suggest priorities, and propose next steps.',
      ].join('\n');
      return { messages: [userPromptMessage(review)] };
    },
  );
}

/**
 * Собирает MCP-сервер `meeting-tasks` с инструментами, ресурсами и промптами.
 * Переиспользуется в jest через in-memory транспорт (test/mcp-server.e2e-spec.ts) и
 * запускается как автономный процесс (test/mcp-server.real.test.mjs).
 */
export function createMeetingTasksMcpServer(deps: MeetingTasksMcpServerDeps): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );
  registerFindTaskTool(server, deps);
  registerAddTaskTool(server, deps);
  registerOpenTasksResource(server, deps);
  registerTaskByIdResource(server, deps);
  registerMeetingBriefPrompt(server, deps);
  registerMeetingTaskReviewPrompt(server, deps);
  return server;
}

interface SeedMeetingJson {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
}

interface SeedTaskJson {
  id: string;
  meetingId: string;
  title: string;
  source: TaskSource;
  status: TaskStatus;
  assignee?: string;
}

interface SeedFileJson {
  meetings?: SeedMeetingJson[];
  tasks?: SeedTaskJson[];
}

/**
 * Загружает seed-данные в in-memory репозитории (только для автономного запуска и
 * клиентского теста: инструменты только на чтение, данных по протоколу не создать).
 */
async function loadSeedFile(
  meetingsRepository: MeetingsRepository,
  tasksRepository: TasksRepository,
  seedFilePath: string,
): Promise<void> {
  const seed = JSON.parse(readFileSync(seedFilePath, 'utf8')) as SeedFileJson;
  for (const meetingData of seed.meetings ?? []) {
    await meetingsRepository.insert(
      new Meeting(
        meetingData.id,
        meetingData.ownerId,
        meetingData.name,
        meetingData.description ?? '',
        new Date(),
      ),
    );
  }
  for (const taskData of seed.tasks ?? []) {
    await tasksRepository.insert(
      new Task(
        taskData.id,
        taskData.meetingId,
        taskData.title,
        taskData.source,
        taskData.status,
        new Date(),
        taskData.assignee,
      ),
    );
  }
}

async function main(): Promise<void> {
  const meetingsRepository = new MeetingsRepository();
  const tasksRepository = new TasksRepository();
  const tasksService = new TasksService(tasksRepository, meetingsRepository);
  const seedFilePath = process.env.MCP_SEED_FILE;
  if (seedFilePath !== undefined) {
    await loadSeedFile(meetingsRepository, tasksRepository, seedFilePath);
  }
  const server = createMeetingTasksMcpServer({ meetingsRepository, tasksService });
  await server.connect(new StdioServerTransport());
}

// Точка входа: запускается как `node dist/mcp/mcp-server.js`. Логи в stdout запрещены —
// stdout занят MCP-протоколом, любые ошибки пишем в stderr.
if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`mcp-server error: ${message}\n`);
    process.exitCode = 1;
  });
}
