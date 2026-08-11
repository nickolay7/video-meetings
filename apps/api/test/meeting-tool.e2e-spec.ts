import { Test, TestingModule } from '@nestjs/testing';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpModule } from '../src/mcp/mcp.module';
import {
  MEETING_MCP_SERVER_FACTORY,
  createMeetingMcpServer,
  findTaskTool,
  updateMeetingTool,
  updateTaskTool,
  type MeetingMcpServerFactory,
} from '../src/mcp/meeting-tool';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { TasksRepository } from '../src/tasks/tasks.repository';

// SDK — ESM-only, jest (CJS) его не грузит. Мокаем на уровне модуля pass-through'ом:
// `tool`/`createSdkMcpServer` возвращают определения инструментов, чтобы хендлеры
// из meeting-tool.ts можно было вызывать напрямую; `query` — пустая jest.fn().
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
  createSdkMcpServer: (options: object) => ({ ...options }),
}));

/** Достаёт JSON из текстового content результата MCP-инструмента. */
function resultText(result: CallToolResult): unknown {
  expect(result.content).toHaveLength(1);
  const content = result.content[0];
  if (content.type !== 'text') {
    throw new Error('Expected text content in tool result');
  }
  return JSON.parse(content.text);
}

/**
 * SDK типизирует аргументы хендлера как `InferShape` (все ключи обязательны),
 * хотя рантайм-парс схемы принимает частичные объекты — кастуем для прямых вызовов.
 */
function callTool(
  toolDef: { handler: (args: never, extra: unknown) => Promise<CallToolResult> },
  args: object,
): Promise<CallToolResult> {
  return toolDef.handler(args as never, undefined);
}

interface TaskJson {
  id: string;
  meetingId: string;
  title: string;
  source: 'insights' | 'manual';
  status: 'open' | 'completed';
  assignee?: string;
}

interface MeetingJson {
  id: string;
  name: string;
  description: string;
  summary?: string;
}

interface MeetingMcpServer {
  name: string;
  tools: { name: string; inputSchema?: Record<string, unknown> }[];
}

describe('Meeting MCP tools', () => {
  let meetingsRepository: MeetingsRepository;
  let tasksRepository: TasksRepository;

  beforeEach(async () => {
    meetingsRepository = new MeetingsRepository();
    tasksRepository = new TasksRepository();
  });

  async function createMeeting(name = 'Planning', description = ''): Promise<MeetingJson> {
    return meetingsRepository.create(name, description);
  }

  async function createTask(
    meetingId: string,
    title: string,
    assignee?: string,
    status: 'open' | 'completed' = 'open',
  ): Promise<TaskJson> {
    const task = await tasksRepository.create(meetingId, title, 'manual', assignee);
    if (status === 'completed') {
      await tasksRepository.updateStatus(task, 'completed');
    }
    return task;
  }

  const deps = () => ({ tasksRepository, meetingsRepository });

  describe('findTask', () => {
    it('returns all tasks of a meeting', async () => {
      const meeting = await createMeeting();
      await createTask(meeting.id, 'Prepare slides');
      await createTask(meeting.id, 'Send summary');

      const result = await callTool(findTaskTool(deps()), { meetingId: meeting.id });

      const tasks = resultText(result) as TaskJson[];
      expect(tasks.map((task) => task.title)).toEqual(['Prepare slides', 'Send summary']);
    });

    it('filters tasks by status and assignee', async () => {
      const meeting = await createMeeting();
      await createTask(meeting.id, 'Open task', 'Alice');
      await createTask(meeting.id, 'Done task', 'Bob', 'completed');

      const openResult = await callTool(findTaskTool(deps()), {
        meetingId: meeting.id,
        status: 'open',
      });
      const openTasks = resultText(openResult) as TaskJson[];
      expect(openTasks.map((task) => task.title)).toEqual(['Open task']);

      const assignedResult = await callTool(findTaskTool(deps()), {
        meetingId: meeting.id,
        assignee: 'Bob',
      });
      const assignedTasks = resultText(assignedResult) as TaskJson[];
      expect(assignedTasks.map((task) => task.title)).toEqual(['Done task']);
    });

    it('filters by task id and returns an empty list when nothing matches', async () => {
      const meeting = await createMeeting();
      const task = await createTask(meeting.id, 'Only task');

      const byIdResult = await callTool(findTaskTool(deps()), {
        meetingId: meeting.id,
        taskId: task.id,
      });
      const byIdTasks = resultText(byIdResult) as TaskJson[];
      expect(byIdTasks.map((task) => task.id)).toEqual([task.id]);

      const emptyResult = await callTool(findTaskTool(deps()), {
        meetingId: meeting.id,
        status: 'completed',
      });
      expect(resultText(emptyResult)).toEqual([]);
    });

    it('returns isError for an unknown meeting', async () => {
      const result = await callTool(findTaskTool(deps()), { meetingId: 'missing' });

      expect(result.isError).toBe(true);
      const error = resultText(result) as { error: string };
      expect(error.error).toContain('not found');
    });
  });

  describe('updateTask', () => {
    it('creates a manual task when no taskId is provided', async () => {
      const meeting = await createMeeting();

      const result = await callTool(updateTaskTool(deps()), {
        meetingId: meeting.id,
        title: 'Prepare slides',
        assignee: 'Alice',
      });

      const task = resultText(result) as TaskJson;
      expect(task.title).toBe('Prepare slides');
      expect(task.source).toBe('manual');
      expect(task.status).toBe('open');
      expect(task.assignee).toBe('Alice');
    });

    it('creates an insights task when source is provided', async () => {
      const meeting = await createMeeting();

      const result = await callTool(updateTaskTool(deps()), {
        meetingId: meeting.id,
        title: 'Prepare slides',
        assignee: 'Alice',
        source: 'insights',
      });

      const task = resultText(result) as TaskJson;
      expect(task.title).toBe('Prepare slides');
      expect(task.source).toBe('insights');
      expect(task.assignee).toBe('Alice');
    });

    it('updates title, assignee and status of an existing task', async () => {
      const meeting = await createMeeting();
      const task = await createTask(meeting.id, 'Old title', 'Alice');

      const result = await callTool(updateTaskTool(deps()), {
        meetingId: meeting.id,
        taskId: task.id,
        title: 'New title',
        status: 'completed',
      });

      const updated = resultText(result) as TaskJson;
      expect(updated.title).toBe('New title');
      expect(updated.status).toBe('completed');

      const stored = (await tasksRepository.findById(task.id)) as TaskJson & { id: string };
      expect(stored.title).toBe('New title');
      expect(stored.status).toBe('completed');
    });

    it('returns isError when creating without title', async () => {
      const meeting = await createMeeting();

      const result = await callTool(updateTaskTool(deps()), { meetingId: meeting.id });

      expect(result.isError).toBe(true);
    });

    it('returns isError for an unknown task', async () => {
      const meeting = await createMeeting();

      const result = await callTool(updateTaskTool(deps()), {
        meetingId: meeting.id,
        taskId: 'missing',
        title: 'Any',
      });

      expect(result.isError).toBe(true);
    });

    it('returns isError for an unknown meeting', async () => {
      const result = await callTool(updateTaskTool(deps()), {
        meetingId: 'missing',
        title: 'Any',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('updateMeeting', () => {
    it('writes the summary to the meeting', async () => {
      const meeting = await createMeeting('Planning');

      const result = await callTool(updateMeetingTool(deps()), {
        meetingId: meeting.id,
        summary: 'Decided on the roadmap',
      });

      const updated = resultText(result) as MeetingJson;
      expect(updated.summary).toBe('Decided on the roadmap');

      const stored = await meetingsRepository.findById(meeting.id);
      expect(stored?.summary).toBe('Decided on the roadmap');
    });

    it('returns isError for an unknown meeting', async () => {
      const result = await callTool(updateMeetingTool(deps()), {
        meetingId: 'missing',
        summary: 'Any',
      });

      expect(result.isError).toBe(true);
    });
  });

  describe('createMeetingMcpServer', () => {
    it('builds the meeting server with the three tools', () => {
      const server = createMeetingMcpServer(deps()) as unknown as MeetingMcpServer;

      expect(server.name).toBe('meeting');
      expect(server.tools.map((tool) => tool.name)).toEqual([
        'findTask',
        'updateTask',
        'updateMeeting',
      ]);
    });
  });

  describe('scoped tools (bound to a meeting) — защита от prompt injection', () => {
    it('exposes no meetingId in the schemas of a scoped server', () => {
      const server = createMeetingMcpServer(deps(), {
        meetingId: 'meeting-1',
      }) as unknown as MeetingMcpServer;

      expect(server.tools.map((tool) => tool.name)).toEqual([
        'findTask',
        'updateTask',
        'updateMeeting',
      ]);
      // Модель не может указать встречу: meetingId убран из схем — его нельзя подменить из транскрипта.
      for (const tool of server.tools) {
        expect(tool.inputSchema).not.toHaveProperty('meetingId');
      }
    });

    it('findTask ignores an injected meetingId and returns only the bound meeting tasks', async () => {
      const bound = await createMeeting('Bound');
      const other = await createMeeting('Other');
      await createTask(bound.id, 'Bound task');
      await createTask(other.id, 'Other task');

      const result = await callTool(findTaskTool(deps(), bound.id), {
        meetingId: other.id, // «инъекция» из транскрипта — должна игнорироваться
      });

      const tasks = resultText(result) as TaskJson[];
      expect(tasks.map((task) => task.title)).toEqual(['Bound task']);
    });

    it('updateTask creates the task in the bound meeting despite an injected meetingId', async () => {
      const bound = await createMeeting('Bound');
      const other = await createMeeting('Other');

      const result = await callTool(updateTaskTool(deps(), bound.id), {
        meetingId: other.id,
        title: 'Scoped task',
        source: 'insights',
      });

      const task = resultText(result) as TaskJson;
      expect(task.meetingId).toBe(bound.id);

      const boundTasks = await tasksRepository.findAllByMeeting(bound.id);
      expect(boundTasks.map((task) => task.title)).toEqual(['Scoped task']);
      const otherTasks = await tasksRepository.findAllByMeeting(other.id);
      expect(otherTasks).toEqual([]);
    });

    it('updateMeeting writes the summary to the bound meeting despite an injected meetingId', async () => {
      const bound = await createMeeting('Bound');
      const other = await createMeeting('Other');

      const result = await callTool(updateMeetingTool(deps(), bound.id), {
        meetingId: other.id,
        summary: 'Bound summary',
      });

      const updated = resultText(result) as MeetingJson;
      expect(updated.id).toBe(bound.id);

      const boundMeeting = await meetingsRepository.findById(bound.id);
      expect(boundMeeting?.summary).toBe('Bound summary');
      const otherMeeting = await meetingsRepository.findById(other.id);
      expect(otherMeeting?.summary).toBeUndefined();
    });
  });

  describe('McpModule', () => {
    it('provides a factory that builds a meeting server scoped to the given meeting', async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [McpModule],
      }).compile();

      const factory = moduleFixture.get<MeetingMcpServerFactory>(MEETING_MCP_SERVER_FACTORY);
      const server = factory('meeting-1') as unknown as MeetingMcpServer;

      expect(server.name).toBe('meeting');
      expect(server.tools.map((tool) => tool.name)).toEqual([
        'findTask',
        'updateTask',
        'updateMeeting',
      ]);
      // Скопированный сервер не отдаёт модели meetingId — его нельзя подменить из транскрипта.
      for (const tool of server.tools) {
        expect(tool.inputSchema).not.toHaveProperty('meetingId');
      }
    });
  });
});
