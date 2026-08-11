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
import { MeetingOwner } from '../mcp/meeting-owner';
import type { McpToolRegister } from '../mcp/mcp-tool-register';

/**
 * Регистратор MCP-примитивов домена задач: инструменты `findTask`/`addTask`, ресурсы
 * `tasks://open` и `task://{id}`, промпты `meeting_brief` и `meeting_task_review`.
 * Реализует `McpToolRegister` и предоставляется провайдером с токеном `MCP_TOOL_REGISTER`
 * (`multi: true`) — McpService применяет его к MCP-серверу при каждом HTTP-запросе.
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

  /** Регистрирует все MCP-примитивы домена задач на переданном сервере. */
  register(server: McpServer): void {
    this.registerFindTaskTool(server);
    this.registerAddTaskTool(server);
    this.registerOpenTasksResource(server);
    this.registerTaskByIdResource(server);
    this.registerMeetingBriefPrompt(server);
    this.registerMeetingTaskReviewPrompt(server);
  }

  private readonly findTaskSchema = z.object({
    query: z.string(),
    meeting_id: z.string(),
    user_id: z.string(),
  });

  /**
   * Инструмент `findTask`: поиск задач встречи по текстовому `query` (регистронезависимая
   * подстрока по названию, пустой query — все задачи). Перед возвратом данных проверяет через
   * `MeetingOwner`, что встреча принадлежит `user_id`. Только чтение — `readOnlyHint: true`.
   */
  private registerFindTaskTool(server: McpServer): void {
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
          await this.meetingOwner.findOwnedByUser(params.user_id, params.meeting_id);
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
    user_id: z.string(),
    title: z.string(),
    assignee: z.string().optional(),
    source: z.enum(['manual', 'insights']).optional(),
  });

  /**
   * Инструмент `addTask`: создание задачи встречи через `TasksService.createTask`. Перед
   * созданием проверяет через `MeetingOwner`, что встреча принадлежит `user_id`. Запись —
   * `readOnlyHint: false`.
   */
  private registerAddTaskTool(server: McpServer): void {
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
          await this.meetingOwner.findOwnedByUser(params.user_id, params.meeting_id);
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
   * Статический ресурс `tasks://open`: список открытых задач всех встреч через
   * `TasksService.listOpenTasks`. Авторизация не реализована — данные без ограничений.
   */
  private registerOpenTasksResource(server: McpServer): void {
    server.registerResource(
      'tasks.open',
      'tasks://open',
      {
        title: 'Open tasks',
        description: 'List of open tasks across all meetings',
        mimeType: 'application/json',
      },
      async (uri) => {
        const tasks = await this.tasksService.listOpenTasks();
        return { contents: textResourceContents(uri.toString(), tasks) };
      },
    );
  }

  /**
   * Динамический ресурс `task://{id}`: данные конкретной задачи по её id через
   * `TasksService.getTaskById`. Авторизация не реализована — задача доступна по любому id;
   * несуществующий id даёт ошибку чтения ресурса (`InvalidParams`).
   */
  private registerTaskByIdResource(server: McpServer): void {
    server.registerResource(
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
          const task = await this.tasksService.getTaskById(taskId);
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

  private readonly meetingArgsSchema = z.object({ meeting_id: z.string() });

  /** Единый путь для промптов: найти встречу по id, иначе — ошибка чтения промпта. */
  private async findMeetingForPrompt(meetingId: string): Promise<Meeting> {
    const meeting = await this.meetingsRepository.findById(meetingId);
    if (!meeting) {
      throw new McpError(ErrorCode.InvalidParams, `Meeting with id ${meetingId} not found`);
    }
    return meeting;
  }

  /**
   * Промпт `meeting_brief`: собирает информацию о встрече (название, описание, summary)
   * и формирует готовый бриф для дальнейшей работы.
   */
  private registerMeetingBriefPrompt(server: McpServer): void {
    server.registerPrompt(
      'meeting_brief',
      {
        title: 'Meeting Brief',
        description: 'Collect information about a meeting and prepare a brief',
        argsSchema: this.meetingArgsSchema.shape,
      },
      async (args) => {
        const meeting = await this.findMeetingForPrompt(args.meeting_id);
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
   * `TasksService.listForMeeting` и формирует готовый промпт для ревью задач.
   */
  private registerMeetingTaskReviewPrompt(server: McpServer): void {
    server.registerPrompt(
      'meeting_task_review',
      {
        title: 'Meeting Task Review',
        description: 'Review the tasks associated with a meeting',
        argsSchema: this.meetingArgsSchema.shape,
      },
      async (args) => {
        const meeting = await this.findMeetingForPrompt(args.meeting_id);
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
