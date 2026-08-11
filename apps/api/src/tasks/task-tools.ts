import { Injectable, NotFoundException } from '@nestjs/common';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
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
import { TasksService } from './tasks.service';
import { MeetingNotFoundError, MeetingNotOwnedError, MeetingOwner } from '../mcp/meeting-owner';
import type { McpToolRegister } from '../mcp/mcp-tool-register';
import type { Requester } from '../mcp/requester';

/**
 * Регистратор MCP-примитивов домена задач: инструменты `findTask`/`addTask`, ресурсы
 * `tasks://open` и `task://{id}`, промпты `meeting_brief` и `meeting_task_review`.
 * Реализует `McpToolRegister` и предоставляется провайдером с токеном `MCP_TOOL_REGISTER`
 * — McpService применяет его к MCP-серверу при каждом HTTP-запросе.
 *
 * Аутентификация выполнена на HTTP-уровне (`McpAuthGuard`); сюда приходит `Requester` из
 * токена, и каждый примитив авторизует доступ через владение встречей (`MeetingOwner`):
 * `meeting_id` клиент задаёт, но принадлежность встречи проверяется по `requester.id`.
 * Весь доступ к данным задач идёт через единый сервисный слой `TasksService`.
 */
@Injectable()
export class TaskTools implements McpToolRegister {
  private readonly meetingOwner: MeetingOwner;

  constructor(
    private readonly tasksService: TasksService,
    private readonly meetingsRepository: MeetingsRepository,
  ) {
    this.meetingOwner = new MeetingOwner(meetingsRepository);
  }

  /**
   * Регистрирует все MCP-примитивы домена задач на переданном сервере. `requester`
   * захватывается обработчиками в замыкании: McpService вызывает `register` на каждый
   * HTTP-запрос со свежим сервером, поэтому у каждого запроса свой круг доступа.
   */
  register(server: McpServer, requester: Requester): void {
    this.registerFindTaskTool(server, requester);
    this.registerAddTaskTool(server, requester);
    this.registerOpenTasksResource(server, requester);
    this.registerTaskByIdResource(server, requester);
    this.registerMeetingBriefPrompt(server, requester);
    this.registerMeetingTaskReviewPrompt(server, requester);
  }

  private readonly findTaskSchema = z.object({
    query: z.string(),
    meeting_id: z.string(),
  });

  /**
   * Инструмент `findTask`: поиск задач встречи по текстовому `query` (регистронезависимая
   * подстрока по названию, пустой query — все задачи). Перед возвратом данных проверяет через
   * `MeetingOwner`, что встреча принадлежит `requester` (личность из JWT). Только чтение —
   * `readOnlyHint: true`.
   */
  private registerFindTaskTool(server: McpServer, requester: Requester): void {
    server.registerTool(
      'findTask',
      {
        title: 'Search meeting tasks',
        description: 'Search tasks of a meeting by a text query. Returns matching tasks.',
        inputSchema: this.findTaskSchema.shape,
        annotations: {
          title: 'Search meeting tasks',
          readOnlyHint: true,
          idempotentHint: true,
        },
      },
      async (args) => {
        try {
          const params = this.findTaskSchema.parse(args);
          await this.meetingOwner.findOwnedByUser(requester.id, params.meeting_id);
          const tasks = await this.tasksService.listForMeeting(params.meeting_id);
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

  private readonly addTaskSchema = z.object({
    meeting_id: z.string(),
    title: z.string(),
    assignee: z.string().optional(),
    source: z.enum(['manual', 'insights']).optional(),
  });

  /**
   * Инструмент `addTask`: создание задачи встречи через `TasksService.createTask`. Перед
   * созданием проверяет через `MeetingOwner`, что встреча принадлежит `requester` (личность
   * из JWT). Запись — `readOnlyHint: false`.
   */
  private registerAddTaskTool(server: McpServer, requester: Requester): void {
    server.registerTool(
      'addTask',
      {
        title: 'Add a meeting task',
        description: 'Create a new task for a meeting. Returns the created task.',
        inputSchema: this.addTaskSchema.shape,
        annotations: {
          title: 'Add a meeting task',
          readOnlyHint: false,
        },
      },
      async (args) => {
        try {
          const params = this.addTaskSchema.parse(args);
          await this.meetingOwner.findOwnedByUser(requester.id, params.meeting_id);
          const task = await this.tasksService.createTask(
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
   * Статический ресурс `tasks://open`: список открытых задач **встреч запрашивающего** через
   * `TasksService.listOpenTasksForOwner` — чужие встречи в результат не попадают.
   */
  private registerOpenTasksResource(server: McpServer, requester: Requester): void {
    server.registerResource(
      'tasks.open',
      'tasks://open',
      {
        title: 'Open tasks',
        description: 'List of open tasks across the meetings owned by the current user',
        mimeType: 'application/json',
      },
      async (uri) => {
        const tasks = await this.tasksService.listOpenTasksForOwner(requester.id);
        return { contents: textResourceContents(uri.toString(), tasks) };
      },
    );
  }

  /**
   * Динамический ресурс `task://{id}`: данные конкретной задачи по её id через
   * `TasksService.getTaskById`. Доступ только к задачам встреч запрашивающего: несуществующая
   * и недоступная (чужая) задача выглядят одинаково (`InvalidParams` + «not found»), чтобы
   * не раскрывать существование чужих задач.
   */
  private registerTaskByIdResource(server: McpServer, requester: Requester): void {
    server.registerResource(
      'task',
      new ResourceTemplate('task://{id}', { list: undefined }),
      {
        title: 'Task by id',
        description: 'A single task of a meeting owned by the current user, by its id',
        mimeType: 'application/json',
      },
      async (uri, variables) => {
        const taskId = Array.isArray(variables.id) ? variables.id[0] : variables.id;
        try {
          const task = await this.tasksService.getTaskById(taskId);
          await this.meetingOwner.findOwnedByUser(requester.id, task.meetingId);
          return { contents: textResourceContents(uri.toString(), task) };
        } catch (error) {
          if (
            error instanceof NotFoundException ||
            error instanceof MeetingNotFoundError ||
            error instanceof MeetingNotOwnedError
          ) {
            throw new McpError(ErrorCode.InvalidParams, `Task with id ${taskId} not found`);
          }
          throw error;
        }
      },
    );
  }

  private readonly meetingArgsSchema = z.object({ meeting_id: z.string() });

  /**
   * Единый путь для промптов: найти встречу по id и убедиться, что она принадлежит
   * `requester`, иначе — ошибка чтения промпта (`InvalidParams`).
   */
  private async findOwnedMeetingForPrompt(
    requester: Requester,
    meetingId: string,
  ): Promise<Meeting> {
    try {
      return await this.meetingOwner.findOwnedByUser(requester.id, meetingId);
    } catch (error) {
      if (error instanceof MeetingNotFoundError) {
        throw new McpError(ErrorCode.InvalidParams, `Meeting with id ${meetingId} not found`);
      }
      if (error instanceof MeetingNotOwnedError) {
        throw new McpError(ErrorCode.InvalidParams, error.message);
      }
      throw error;
    }
  }

  /**
   * Промпт `meeting_brief`: собирает информацию о встрече (название, описание, summary)
   * и формирует готовый бриф для дальнейшей работы. Доступ — только к своим встречам.
   */
  private registerMeetingBriefPrompt(server: McpServer, requester: Requester): void {
    server.registerPrompt(
      'meeting_brief',
      {
        title: 'Meeting Brief',
        description: 'Collect information about a meeting and prepare a brief',
        argsSchema: this.meetingArgsSchema.shape,
      },
      async (args) => {
        const meeting = await this.findOwnedMeetingForPrompt(requester, args.meeting_id);
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
   * Промпт `meeting_task_review`: находит встречу, агрегирует связанные задачи через
   * `TasksService.listForMeeting` и формирует готовый промпт для ревью задач. Доступ —
   * только к своим встречам.
   */
  private registerMeetingTaskReviewPrompt(server: McpServer, requester: Requester): void {
    server.registerPrompt(
      'meeting_task_review',
      {
        title: 'Meeting Task Review',
        description: 'Review the tasks associated with a meeting',
        argsSchema: this.meetingArgsSchema.shape,
      },
      async (args) => {
        const meeting = await this.findOwnedMeetingForPrompt(requester, args.meeting_id);
        const tasks = await this.tasksService.listForMeeting(meeting.id);
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

/** Текстовое содержимое ресурса: данные сериализуются в JSON. */
function textResourceContents(uri: string, data: unknown): ReadResourceResult['contents'] {
  return [{ uri, mimeType: 'application/json', text: JSON.stringify(data) }];
}

/** Сообщение промпта с ролью user — структурированный контент с подставленным текстом. */
function userPromptMessage(text: string): GetPromptResult['messages'][number] {
  return { role: 'user', content: { type: 'text', text } };
}
