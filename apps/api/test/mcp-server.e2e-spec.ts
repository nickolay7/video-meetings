import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpModule } from '../src/mcp/mcp.module';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { TasksRepository } from '../src/tasks/tasks.repository';

// SDK — ESM-only, jest (CJS) его не грузит. Мокаем на уровне модуля pass-through'ом:
// `tool`/`createSdkMcpServer` возвращают определения инструментов (meeting-tool.ts тянется
// через McpModule для MEETING_MCP_SERVER_FACTORY), `query` — пустая jest.fn().
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

// Тест гоняет настоящий MCP-протокол поверх HTTP-эндпоинта /mcp: поднимает Nest-приложение
// (McpModule + регистраторы доменов), слушает эфемерный порт и подключается через
// StreamableHTTPClientTransport. SDK (@modelcontextprotocol/sdk) — CJS-совместим, мок не нужен.
// Сервер работает в stateless-режиме (sessionIdGenerator: undefined) с JSON-ответами
// (enableJsonResponse: true): сессии нет, каждый запрос обрабатывается свежим MCP-сервером.

/** JSON-разобранный результат инструмента из текстового content. */
function resultJson(result: CallToolResult): unknown {
  const content = result.content[0];
  if (content.type !== 'text') {
    throw new Error('Expected text content in tool result');
  }
  return JSON.parse(content.text);
}

/** Сообщение ошибки из isError-результата: либо JSON `{ error: ... }`, либо сырой текст. */
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

/** JSON из текстового содержимого ресурса. */
function resourceJson(result: { contents: unknown[] }): unknown {
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

describe('MCP HTTP server (/mcp)', () => {
  let app: INestApplication;
  let client: Client;
  let meetingsRepository: MeetingsRepository;
  let tasksRepository: TasksRepository;

  /** Поднимает приложение и подключает MCP-клиент к /mcp на эфемерном порту. */
  async function startApp(): Promise<INestApplication> {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [McpModule],
    }).compile();

    const nestApp = moduleFixture.createNestApplication();
    await nestApp.init();
    await nestApp.listen(0);
    meetingsRepository = moduleFixture.get(MeetingsRepository);
    tasksRepository = moduleFixture.get(TasksRepository);
    return nestApp;
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    // Без resultSchema возвращается union с вариантом task-инструмента — сужаем до CallToolResult.
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
  }

  /** Seed-данные: встреча владельца user-1 с открытыми/завершённой задачами и встреча user-2. */
  async function seed() {
    await meetingsRepository.create('user-1', 'Planning', 'Sprint planning');
    await meetingsRepository.create('user-2', 'Other planning', '');
    await tasksRepository.create('1', 'Prepare slides', 'manual', 'Alice');
    await tasksRepository.create('1', 'Send summary', 'manual');
    const completed = await tasksRepository.create('1', 'Completed task', 'manual');
    await tasksRepository.updateStatus(completed, 'completed');
  }

  beforeAll(async () => {
    app = await startApp();
    const port = (app.getHttpServer().address() as AddressInfo).port;
    client = new Client({ name: 'e2e-client', version: '1.0.0' }, { capabilities: {} });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)),
    );
  });

  beforeEach(async () => {
    await meetingsRepository.clear();
    await tasksRepository.clear();
    await seed();
  });

  afterAll(async () => {
    await client.close();
    await app.close();
  });

  describe('JSON-описание сервера и инструментов', () => {
    it('передаёт имя и версию сервера в serverInfo', async () => {
      expect(client.getServerVersion()).toEqual({ name: 'meeting-tasks', version: '1.0.0' });
    });

    it('регистрирует инструменты findTask и addTask с ожидаемыми схемами', async () => {
      const { tools } = await client.listTools();
      const findTask = tools.find((tool) => tool.name === 'findTask');
      const addTask = tools.find((tool) => tool.name === 'addTask');
      expect(findTask).toBeDefined();
      expect(findTask!.annotations?.readOnlyHint).toBe(true);
      expect(addTask).toBeDefined();
      expect(addTask!.annotations?.readOnlyHint).toBe(false);
      const addArgs = addTask!.inputSchema?.properties;
      expect(addArgs).toMatchObject({
        meeting_id: { type: 'string' },
        user_id: { type: 'string' },
        title: { type: 'string' },
      });
    });
  });

  describe('Инструменты', () => {
    it('addTask создаёт задачу встречи владельца (source по умолчанию manual)', async () => {
      const result = await callTool('addTask', {
        meeting_id: '1',
        user_id: 'user-1',
        title: 'New task',
        assignee: 'Bob',
      });
      expect(result.isError).not.toBe(true);
      const task = resultJson(result) as TaskJson;
      expect(task.meetingId).toBe('1');
      expect(task.title).toBe('New task');
      expect(task.assignee).toBe('Bob');
      expect(task.source).toBe('manual');
      expect(task.status).toBe('open');

      const found = await tasksRepository.findById(task.id);
      expect(found?.title).toBe('New task');
    });

    it('addTask отклоняет запрос не-владельца встречи (isError)', async () => {
      const result = await callTool('addTask', {
        meeting_id: '1',
        user_id: 'user-2', // встреча принадлежит user-1
        title: 'Nope',
      });
      expect(result.isError).toBe(true);
      expect(errorMessage(result)).toContain('does not belong to user');
    });

    it('addTask отклоняет несуществующую встречу (isError)', async () => {
      const result = await callTool('addTask', {
        meeting_id: 'missing',
        user_id: 'user-1',
        title: 'Nope',
      });
      expect(result.isError).toBe(true);
      expect(errorMessage(result)).toContain('not found');
    });

    it('findTask ищет задачи по подстроке и игнорирует регистр', async () => {
      const result = await callTool('findTask', {
        query: 'slides',
        meeting_id: '1',
        user_id: 'user-1',
      });
      expect(result.isError).not.toBe(true);
      const tasks = resultJson(result) as TaskJson[];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Prepare slides');
    });

    it('findTask с пустым query возвращает все задачи встречи', async () => {
      const result = await callTool('findTask', { query: '', meeting_id: '1', user_id: 'user-1' });
      const tasks = resultJson(result) as TaskJson[];
      expect(tasks).toHaveLength(3);
    });

    it('findTask не показывает задачи чужой встречи (ownership)', async () => {
      const result = await callTool('findTask', { query: '', meeting_id: '1', user_id: 'user-2' });
      expect(result.isError).toBe(true);
      expect(errorMessage(result)).toContain('does not belong to user');
    });
  });

  describe('Ресурсы', () => {
    it('регистрирует статический ресурс tasks://open и шаблон task://{id}', async () => {
      const { resources } = await client.listResources();
      expect(resources.some((resource) => resource.uri === 'tasks://open')).toBe(true);

      const { resourceTemplates } = await client.listResourceTemplates();
      expect(resourceTemplates.some((template) => template.uriTemplate === 'task://{id}')).toBe(
        true,
      );
    });

    it('tasks://open возвращает только открытые задачи всех встреч', async () => {
      const result = await client.readResource({ uri: 'tasks://open' });
      const tasks = resourceJson(result) as TaskJson[];
      expect(tasks).toHaveLength(2);
      expect(tasks.every((task) => task.status === 'open')).toBe(true);
    });

    it('task://{id} возвращает задачу по id', async () => {
      const result = await client.readResource({ uri: 'task://1' });
      const task = resourceJson(result) as TaskJson;
      expect(task.title).toBe('Prepare slides');
    });

    it('task://{id} для несуществующей задачи даёт ошибку чтения', async () => {
      await expect(client.readResource({ uri: 'task://missing' })).rejects.toThrow(/not found/);
    });
  });

  describe('Промпты', () => {
    it('регистрирует meeting_brief и meeting_task_review с аргументом meeting_id', async () => {
      const { prompts } = await client.listPrompts();
      const brief = prompts.find((prompt) => prompt.name === 'meeting_brief');
      const review = prompts.find((prompt) => prompt.name === 'meeting_task_review');
      expect(brief).toBeDefined();
      expect(brief!.title).toBe('Meeting Brief');
      expect(brief!.arguments).toEqual([{ name: 'meeting_id', required: true }]);
      expect(review).toBeDefined();
      expect(review!.title).toBe('Meeting Task Review');
      expect(review!.arguments).toEqual([{ name: 'meeting_id', required: true }]);
    });

    it('meeting_brief возвращает структурированное сообщение с информацией встречи', async () => {
      const result = await client.getPrompt({
        name: 'meeting_brief',
        arguments: { meeting_id: '1' },
      });
      expect(result.messages).toHaveLength(1);
      const message = result.messages[0];
      expect(message.role).toBe('user');
      expect(message.content.type).toBe('text');
      const text = message.content.type === 'text' ? message.content.text : '';
      expect(text).toContain('Meeting Brief: Planning');
      expect(text).toContain('Sprint planning');
    });

    it('meeting_task_review агрегирует задачи встречи в сообщении', async () => {
      const result = await client.getPrompt({
        name: 'meeting_task_review',
        arguments: { meeting_id: '1' },
      });
      const message = result.messages[0];
      const text = message.content.type === 'text' ? message.content.text : '';
      expect(text).toContain('Meeting Task Review: Planning');
      expect(text).toContain('[open] Prepare slides');
      expect(text).toContain('[completed] Completed task');
    });
  });

  describe('HTTP-уровень (stateless + JSON-ответы)', () => {
    const server = () => app.getHttpServer();
    const jsonRpc = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'supertest', version: '1.0.0' },
      },
    };

    it('initialize отвечает JSON с serverInfo и без Mcp-Session-Id (stateless)', async () => {
      const res = await request(server())
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(jsonRpc);
      expect(res.status).toBe(200);
      expect(res.headers['mcp-session-id']).toBeUndefined();
      expect(res.body.result.serverInfo).toEqual({ name: 'meeting-tasks', version: '1.0.0' });
      expect(res.body.result.protocolVersion).toBe('2025-06-18');
    });

    it('отдаёт 406 без Accept-заголовка (transport validation)', async () => {
      const res = await request(server())
        .post('/mcp')
        .set('Content-Type', 'application/json')
        .send(jsonRpc);
      expect(res.status).toBe(406);
    });

    it('отдаёт 415 при не-JSON Content-Type', async () => {
      const res = await request(server())
        .post('/mcp')
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'text/plain')
        .send('not json');
      expect(res.status).toBe(415);
    });
  });
});
