import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  SERVER_NAME,
  SERVER_VERSION,
  createMeetingTasksMcpServer,
  type MeetingTasksMcpServerDeps,
} from '../src/mcp/mcp-server';
import { MeetingNotFoundError, MeetingNotOwnedError, MeetingOwner } from '../src/mcp/meeting-owner';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { TasksRepository } from '../src/tasks/tasks.repository';
import { TasksService } from '../src/tasks/tasks.service';

// SDK (@modelcontextprotocol/sdk) — CJS-совместим, мок не нужен (в отличие от ESM-only
// @anthropic-ai/claude-agent-sdk). Тест гоняет настоящий протокол через in-memory транспорт.

/** Подключает клиент к серверу через пару InMemoryTransport (полный MCP-протокол). */
async function connectClient(deps: MeetingTasksMcpServerDeps): Promise<Client> {
  const server = createMeetingTasksMcpServer(deps);
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Достаёт JSON из текстового content результата MCP-инструмента. */
function resultText(result: CallToolResult): unknown {
  const content = result.content[0];
  if (content.type !== 'text') {
    throw new Error('Expected text content in tool result');
  }
  return JSON.parse(content.text);
}

/**
 * Сообщение ошибки из isError-результата: либо JSON `{ error: ... }` (наш errorResult),
 * либо сырой текст валидации аргументов SDK (`createToolError`).
 */
function errorMessage(result: CallToolResult): string {
  const content = result.content[0];
  if (content.type !== 'text') {
    throw new Error('Expected text content in tool result');
  }
  try {
    const parsed = JSON.parse(content.text) as { error?: string };
    return parsed.error ?? content.text;
  } catch {
    return content.text;
  }
}

/** Достаёт JSON из текстового содержимого ресурса (contents может быть text- или blob-вариантом). */
function resourceText(result: { contents: unknown[] }): unknown {
  const content = result.contents[0] as { text?: string };
  if (content.text === undefined) {
    throw new Error('Expected text content in resource result');
  }
  return JSON.parse(content.text);
}

interface TaskJson {
  id: string;
  meetingId: string;
  title: string;
  status: string;
  source: string;
  assignee?: string;
}

describe('MCP server meeting-tasks (stdio-совместимый)', () => {
  let meetingsRepository: MeetingsRepository;
  let tasksRepository: TasksRepository;
  let tasksService: TasksService;

  beforeEach(() => {
    meetingsRepository = new MeetingsRepository();
    tasksRepository = new TasksRepository();
    tasksService = new TasksService(tasksRepository, meetingsRepository);
  });

  const deps = (): MeetingTasksMcpServerDeps => ({ meetingsRepository, tasksService });

  async function callTool(
    client: Client,
    name: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    // Без resultSchema возвращается union с вариантом task-инструмента — сужаем до CallToolResult.
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  describe('JSON-описание сервера и инструментов', () => {
    it('передаёт имя и версию сервера в serverInfo (из конструктора McpServer из SDK)', async () => {
      const client = await connectClient(deps());
      try {
        expect(client.getServerVersion()).toEqual({ name: SERVER_NAME, version: SERVER_VERSION });
      } finally {
        await client.close();
      }
    });

    it('регистрирует findTask с описанием, аннотациями и схемой query/meeting_id/user_id', async () => {
      const client = await connectClient(deps());
      try {
        const { tools } = await client.listTools();
        const findTask = tools.find((tool) => tool.name === 'findTask');
        expect(findTask).toBeDefined();
        expect(findTask!.description).toContain('Search tasks of a meeting');

        expect(findTask!.annotations).toEqual({
          title: 'Search meeting tasks',
          readOnlyHint: true,
          idempotentHint: true,
        });

        const properties = findTask!.inputSchema.properties ?? {};
        expect(Object.keys(properties)).toEqual(['query', 'meeting_id', 'user_id']);
        expect([...(findTask!.inputSchema.required ?? [])].sort()).toEqual([
          'meeting_id',
          'query',
          'user_id',
        ]);
      } finally {
        await client.close();
      }
    });

    it('регистрирует addTask с readOnlyHint: false и схемой title/meeting_id/user_id', async () => {
      const client = await connectClient(deps());
      try {
        const { tools } = await client.listTools();
        const addTask = tools.find((tool) => tool.name === 'addTask');
        expect(addTask).toBeDefined();
        expect(addTask!.description).toContain('Create a new task');

        expect(addTask!.annotations).toEqual({
          title: 'Add a meeting task',
          readOnlyHint: false,
        });

        const properties = addTask!.inputSchema.properties ?? {};
        expect(Object.keys(properties).sort()).toEqual([
          'assignee',
          'meeting_id',
          'source',
          'title',
          'user_id',
        ]);
        expect([...(addTask!.inputSchema.required ?? [])].sort()).toEqual([
          'meeting_id',
          'title',
          'user_id',
        ]);
      } finally {
        await client.close();
      }
    });
  });

  describe('addTask — создание задачи', () => {
    it('создаёт задачу встречи через TasksService и возвращает её', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'addTask', {
          meeting_id: meeting.id,
          user_id: 'user-1',
          title: 'Prepare slides',
          assignee: 'Alice',
        });
        expect(result.isError).not.toBe(true);
        const task = resultText(result) as TaskJson;
        expect(task.title).toBe('Prepare slides');
        expect(task.meetingId).toBe(meeting.id);
        expect(task.status).toBe('open');

        // Данные прошли через единый сервисный слой — задача видна в репозитории.
        const stored = await tasksRepository.findById(task.id);
        expect(stored?.title).toBe('Prepare slides');
        expect(stored?.source).toBe('manual');
        expect(stored?.assignee).toBe('Alice');
      } finally {
        await client.close();
      }
    });

    it('создаёт задачу с source insights, когда он передан', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'addTask', {
          meeting_id: meeting.id,
          user_id: 'user-1',
          title: 'Send minutes',
          source: 'insights',
        });
        expect(result.isError).not.toBe(true);
        const task = resultText(result) as TaskJson;
        expect(task.source).toBe('insights');
      } finally {
        await client.close();
      }
    });

    it('отказывает в создании задачи для встречи, принадлежащей другому пользователю', async () => {
      const meeting = await meetingsRepository.create('user-2', 'Other planning', '');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'addTask', {
          meeting_id: meeting.id,
          user_id: 'user-1',
          title: 'Prepare slides',
        });
        expect(result.isError).toBe(true);
        expect(errorMessage(result)).toContain('does not belong to user');
      } finally {
        await client.close();
      }
    });

    it('возвращает isError для неизвестной встречи', async () => {
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'addTask', {
          meeting_id: 'missing',
          user_id: 'user-1',
          title: 'Prepare slides',
        });
        expect(result.isError).toBe(true);
        expect(errorMessage(result)).toContain('not found');
      } finally {
        await client.close();
      }
    });

    it('возвращает isError, если не передан title', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'addTask', {
          meeting_id: meeting.id,
          user_id: 'user-1',
        });
        expect(result.isError).toBe(true);
        expect(errorMessage(result)).toContain('title');
      } finally {
        await client.close();
      }
    });
  });

  describe('MeetingOwner — проверка владельца перед возвратом данных', () => {
    it('возвращает isError для неизвестной встречи', async () => {
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'findTask', {
          query: '',
          meeting_id: 'missing',
          user_id: 'user-1',
        });
        expect(result.isError).toBe(true);
        expect(errorMessage(result)).toContain('not found');
      } finally {
        await client.close();
      }
    });

    it('отказывает в доступе к встрече, принадлежащей другому пользователю', async () => {
      const otherMeeting = await meetingsRepository.create('user-2', 'Other planning', '');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'findTask', {
          query: '',
          meeting_id: otherMeeting.id,
          user_id: 'user-1',
        });
        expect(result.isError).toBe(true);
        expect(errorMessage(result)).toContain('does not belong to user');
      } finally {
        await client.close();
      }
    });

    it('возвращает задачи только своей встречи', async () => {
      const ownedMeeting = await meetingsRepository.create('user-1', 'Planning', '');
      const otherMeeting = await meetingsRepository.create('user-1', 'Other', '');
      await tasksRepository.create(ownedMeeting.id, 'Prepare slides', 'manual', 'Alice');
      await tasksRepository.create(otherMeeting.id, 'Book room', 'manual');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'findTask', {
          query: '',
          meeting_id: ownedMeeting.id,
          user_id: 'user-1',
        });
        expect(result.isError).not.toBe(true);
        const tasks = resultText(result) as TaskJson[];
        expect(tasks.map((task) => task.title)).toEqual(['Prepare slides']);
      } finally {
        await client.close();
      }
    });
  });

  describe('query-фильтр', () => {
    it('ищет по подстроке в названии задачи (регистронезависимо)', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      await tasksRepository.create(meeting.id, 'Prepare slides', 'manual');
      await tasksRepository.create(meeting.id, 'Send summary', 'manual');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'findTask', {
          query: 'SLIDES',
          meeting_id: meeting.id,
          user_id: 'user-1',
        });
        const tasks = resultText(result) as TaskJson[];
        expect(tasks.map((task) => task.title)).toEqual(['Prepare slides']);
      } finally {
        await client.close();
      }
    });

    it('пустой query возвращает все задачи встречи', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      await tasksRepository.create(meeting.id, 'Prepare slides', 'manual');
      await tasksRepository.create(meeting.id, 'Send summary', 'manual');
      const client = await connectClient(deps());
      try {
        const result = await callTool(client, 'findTask', {
          query: '',
          meeting_id: meeting.id,
          user_id: 'user-1',
        });
        const tasks = resultText(result) as TaskJson[];
        expect(tasks.map((task) => task.title)).toEqual(['Prepare slides', 'Send summary']);
      } finally {
        await client.close();
      }
    });
  });

  describe('Ресурсы', () => {
    it('регистрирует статический ресурс tasks://open в списке ресурсов', async () => {
      const client = await connectClient(deps());
      try {
        const { resources } = await client.listResources();
        const openTasks = resources.find((resource) => resource.uri === 'tasks://open');
        expect(openTasks).toBeDefined();
        expect(openTasks!.name).toBe('tasks.open');
        expect(openTasks!.description).toContain('open tasks');
        expect(openTasks!.mimeType).toBe('application/json');
      } finally {
        await client.close();
      }
    });

    it('регистрирует динамический ресурс task://{id} в списке шаблонов', async () => {
      const client = await connectClient(deps());
      try {
        const { resourceTemplates } = await client.listResourceTemplates();
        const taskById = resourceTemplates.find(
          (template) => template.uriTemplate === 'task://{id}',
        );
        expect(taskById).toBeDefined();
        expect(taskById!.name).toBe('task');
        expect(taskById!.description).toContain('task');
      } finally {
        await client.close();
      }
    });

    it('читает статический ресурс tasks://open — только открытые задачи всех встреч', async () => {
      const meeting1 = await meetingsRepository.create('user-1', 'Planning', '');
      const meeting2 = await meetingsRepository.create('user-1', 'Other', '');
      await tasksRepository.create(meeting1.id, 'Open task A', 'manual');
      const completedTask = await tasksRepository.create(meeting1.id, 'Completed task', 'manual');
      await tasksRepository.create(meeting2.id, 'Open task B', 'manual');
      await tasksRepository.updateStatus(completedTask, 'completed');

      const client = await connectClient(deps());
      try {
        const result = await client.readResource({ uri: 'tasks://open' });
        const tasks = resourceText(result) as TaskJson[];
        expect(tasks.map((task) => task.title).sort()).toEqual(['Open task A', 'Open task B']);
        for (const task of tasks) {
          expect(task.status).toBe('open');
        }
      } finally {
        await client.close();
      }
    });

    it('читает динамический ресурс task://{id} — конкретная задача по её id', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      const task = await tasksRepository.create(meeting.id, 'Prepare slides', 'manual', 'Alice');
      const client = await connectClient(deps());
      try {
        const result = await client.readResource({ uri: `task://${task.id}` });
        const data = resourceText(result) as TaskJson;
        expect(data.id).toBe(task.id);
        expect(data.title).toBe('Prepare slides');
        expect(data.assignee).toBe('Alice');
      } finally {
        await client.close();
      }
    });

    it('даёт ошибку чтения для неизвестного id задачи', async () => {
      const client = await connectClient(deps());
      try {
        await expect(client.readResource({ uri: 'task://missing' })).rejects.toThrow(
          /Task with id missing not found/,
        );
      } finally {
        await client.close();
      }
    });
  });

  describe('Промпты', () => {
    it('регистрирует meeting_brief и meeting_task_review с аргументом meeting_id', async () => {
      const client = await connectClient(deps());
      try {
        const { prompts } = await client.listPrompts();
        const brief = prompts.find((prompt) => prompt.name === 'meeting_brief');
        const review = prompts.find((prompt) => prompt.name === 'meeting_task_review');
        expect(brief).toBeDefined();
        expect(brief!.title).toBe('Meeting Brief');
        expect(brief!.description).toContain('brief');
        expect(brief!.arguments).toEqual([{ name: 'meeting_id', required: true }]);
        expect(review).toBeDefined();
        expect(review!.title).toBe('Meeting Task Review');
        expect(review!.description).toContain('tasks');
        expect(review!.arguments).toEqual([{ name: 'meeting_id', required: true }]);
      } finally {
        await client.close();
      }
    });

    it('meeting_brief возвращает структурированное сообщение с информацией встречи', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', 'Sprint planning');
      const client = await connectClient(deps());
      try {
        const result = await client.getPrompt({
          name: 'meeting_brief',
          arguments: { meeting_id: meeting.id },
        });
        expect(result.messages).toHaveLength(1);
        const message = result.messages[0];
        expect(message.role).toBe('user');
        expect(message.content.type).toBe('text');
        const text = message.content.type === 'text' ? message.content.text : '';
        expect(text).toContain('Meeting Brief: Planning');
        expect(text).toContain('Sprint planning');
      } finally {
        await client.close();
      }
    });

    it('meeting_task_review агрегирует задачи встречи в готовый промпт', async () => {
      const meeting = await meetingsRepository.create('user-1', 'Planning', '');
      await tasksRepository.create(meeting.id, 'Prepare slides', 'manual', 'Alice');
      await tasksRepository.create(meeting.id, 'Send minutes', 'manual');
      const client = await connectClient(deps());
      try {
        const result = await client.getPrompt({
          name: 'meeting_task_review',
          arguments: { meeting_id: meeting.id },
        });
        expect(result.messages).toHaveLength(1);
        const content = result.messages[0].content;
        expect(content.type).toBe('text');
        const text = content.type === 'text' ? content.text : '';
        expect(text).toContain('Meeting Task Review: Planning');
        expect(text).toContain('1. [open] Prepare slides (assignee: Alice)');
        expect(text).toContain('2. [open] Send minutes');
      } finally {
        await client.close();
      }
    });

    it('возвращает ошибку для неизвестной встречи', async () => {
      const client = await connectClient(deps());
      try {
        await expect(
          client.getPrompt({ name: 'meeting_brief', arguments: { meeting_id: 'missing' } }),
        ).rejects.toThrow(/Meeting with id missing not found/);
      } finally {
        await client.close();
      }
    });
  });
});

describe('MeetingOwner (unit)', () => {
  let meetingsRepository: MeetingsRepository;

  beforeEach(() => {
    meetingsRepository = new MeetingsRepository();
  });

  it('возвращает встречу её владельцу', async () => {
    const meeting = await meetingsRepository.create('user-1', 'Planning', '');
    const owner = new MeetingOwner(meetingsRepository);

    const found = await owner.findOwnedByUser('user-1', meeting.id);

    expect(found.id).toBe(meeting.id);
  });

  it('бросает MeetingNotFoundError для неизвестной встречи', async () => {
    const owner = new MeetingOwner(meetingsRepository);

    await expect(owner.findOwnedByUser('user-1', 'missing')).rejects.toBeInstanceOf(
      MeetingNotFoundError,
    );
  });

  it('бросает MeetingNotOwnedError для встречи другого пользователя', async () => {
    const meeting = await meetingsRepository.create('user-2', 'Planning', '');
    const owner = new MeetingOwner(meetingsRepository);

    await expect(owner.findOwnedByUser('user-1', meeting.id)).rejects.toBeInstanceOf(
      MeetingNotOwnedError,
    );
  });
});
