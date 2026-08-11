import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Клиентский тест-скрипт: поднимает собранное API (`node dist/main.js`) на эфемерном порту,
// регистрирует пользователей и создаёт встречу через обычные HTTP-эндпоинты, затем
// подключает MCP-клиентов к /mcp (StreamableHTTPClientTransport) с Bearer-токенами в
// Authorization и проверяет инструменты, ресурсы и промпты. Скрипт `test:mcp` собирает API
// перед запуском (нужен dist/main.js).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MAIN_PATH = path.resolve(__dirname, '..', 'dist', 'main.js');

/** Свободный TCP-порт, на котором будет слушать API (слушаем, читаем, закрываем). */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Поллит GET /, пока API не ответит { status: 'ok' } (или не выйдет таймаут). */
async function waitForApi(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const attempt = async (resolve, reject) => {
    if (Date.now() > deadline) {
      return reject(new Error(`API не поднялся за ${timeoutMs}мс: ${baseUrl}`));
    }
    try {
      const res = await fetch(`${baseUrl}/`);
      const body = await res.json();
      if (body.status === 'ok') return resolve();
    } catch {
      // ещё не готов — повторяем
    }
    setTimeout(() => attempt(resolve, reject), 200);
  };
  return new Promise((resolve, reject) => attempt(resolve, reject));
}

/** Декодирует JWT-payload (без проверки подписи) — достаём `sub` = id пользователя. */
function jwtSub(accessToken) {
  const payload = accessToken.split('.')[1];
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  return decoded.sub;
}

/** Подключает MCP-клиента к /mcp с Bearer-токеном в Authorization. */
async function connectClient(baseUrl, token) {
  const client = new Client({ name: 'mcp-client-test', version: '1.0.0' }, { capabilities: {} });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function taskTitles(result) {
  assert.ok(result.content[0].type === 'text', 'ожидается текстовый content');
  return JSON.parse(result.content[0].text).map((task) => task.title);
}

function taskTitlesFromResource(result) {
  assert.ok(typeof result.contents[0].text === 'string', 'ожидается текстовый content ресурса');
  return JSON.parse(result.contents[0].text).map((task) => task.title);
}

function promptText(result) {
  assert.equal(result.messages.length, 1, 'ожидается одно сообщение промпта');
  const content = result.messages[0].content;
  assert.equal(content.type, 'text', 'ожидается текстовый content');
  return content.text;
}

test(
  'MCP meeting-tasks: API (HTTP) + MCP-клиент — аутентификация, инструменты, ресурсы, промпты',
  { timeout: 60_000 },
  async (t) => {
    assert.ok(
      fs.existsSync(MAIN_PATH),
      `Сначала соберите API (npm run build:api): не найден ${MAIN_PATH}`,
    );

    // 1. Поднимаем API на свободном порту.
    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [MAIN_PATH], {
      env: { ...process.env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let apiOutput = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      apiOutput += chunk;
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      apiOutput += chunk;
    });

    let clientUser1;
    let clientUser2;
    try {
      await waitForApi(baseUrl, 20_000);

      // 2. Регистрируем двух пользователей через HTTP, создаём встречу для user-1.
      async function register(email, name) {
        const res = await fetch(`${baseUrl}/auth/register`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: 'password123', name }),
        });
        assert.equal(res.status, 201, `register ${email} должен вернуть 201`);
        const { access_token } = await res.json();
        return { access_token, userId: jwtSub(access_token) };
      }

      const user1 = await register('mcp-user-1@example.com', 'MCP Tester 1');
      const user2 = await register('mcp-user-2@example.com', 'MCP Tester 2');

      const meetingRes = await fetch(`${baseUrl}/meetings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${user1.access_token}`,
        },
        body: JSON.stringify({ name: 'Planning', description: 'Sprint planning' }),
      });
      assert.equal(meetingRes.status, 201, 'создание встречи должно вернуть 201');
      const meeting = await meetingRes.json();
      assert.equal(meeting.ownerId, user1.userId, 'встреча принадлежит user-1');

      // 3. Аутентификация на HTTP-уровне: без токена — 401, с токеном — JSON-RPC работает.
      const noAuthRes = await fetch(`${baseUrl}/mcp`, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 'raw', version: '1.0.0' },
          },
        }),
      });
      assert.equal(noAuthRes.status, 401, 'MCP-запрос без токена должен дать 401');

      // 4. Подключаем MCP-клиентов под токенами user-1 и user-2.
      clientUser1 = await connectClient(baseUrl, user1.access_token);
      clientUser2 = await connectClient(baseUrl, user2.access_token);

      // 5. JSON-описание сервера: name/version из McpServer.
      assert.deepEqual(clientUser1.getServerVersion(), { name: 'meeting-tasks', version: '1.0.0' });

      // 6. Список инструментов: findTask (readOnly) и addTask (запись). Личность из JWT,
      //    поэтому в схемах нет user_id — только meeting_id (и прочие доменные поля).
      const { tools } = await clientUser1.listTools();
      const findTask = tools.find((tool) => tool.name === 'findTask');
      const addTask = tools.find((tool) => tool.name === 'addTask');
      assert.ok(findTask, 'findTask должен быть зарегистрирован');
      assert.ok(addTask, 'addTask должен быть зарегистрирован');
      assert.match(findTask.description, /Search tasks of a meeting/);
      assert.equal(findTask.annotations.readOnlyHint, true);
      assert.equal(addTask.annotations.readOnlyHint, false);
      assert.deepEqual(Object.keys(findTask.inputSchema.properties ?? {}), ['query', 'meeting_id']);
      assert.deepEqual(Object.keys(addTask.inputSchema.properties ?? {}).sort(), [
        'assignee',
        'meeting_id',
        'source',
        'title',
      ]);

      // 7. Список ресурсов: статический tasks://open и шаблон task://{id}.
      const { resources } = await clientUser1.listResources();
      const openTasksResource = resources.find((resource) => resource.uri === 'tasks://open');
      assert.ok(openTasksResource, 'tasks://open должен быть зарегистрирован');
      assert.equal(openTasksResource.name, 'tasks.open');

      const { resourceTemplates } = await clientUser1.listResourceTemplates();
      const taskByIdTemplate = resourceTemplates.find(
        (template) => template.uriTemplate === 'task://{id}',
      );
      assert.ok(taskByIdTemplate, 'task://{id} должен быть зарегистрирован');

      // 8. Список промптов: meeting_brief и meeting_task_review.
      const { prompts } = await clientUser1.listPrompts();
      assert.ok(
        prompts.find((prompt) => prompt.name === 'meeting_brief'),
        'meeting_brief есть',
      );
      assert.ok(
        prompts.find((prompt) => prompt.name === 'meeting_task_review'),
        'meeting_task_review есть',
      );

      // 9. addTask: создание двух задач на встрече user-1.
      const addResult = await clientUser1.callTool({
        name: 'addTask',
        arguments: { meeting_id: meeting.id, title: 'Prepare slides', assignee: 'Alice' },
      });
      assert.ok(!addResult.isError, 'создание задачи не должно давать ошибку');
      const createdTask = JSON.parse(addResult.content[0].text);
      assert.equal(createdTask.title, 'Prepare slides');
      assert.equal(createdTask.meetingId, meeting.id);
      assert.equal(createdTask.status, 'open');

      await clientUser1.callTool({
        name: 'addTask',
        arguments: { meeting_id: meeting.id, title: 'Book room' },
      });

      // 10. findTask: своя встреча → все задачи встречи.
      const ownedResult = await clientUser1.callTool({
        name: 'findTask',
        arguments: { query: '', meeting_id: meeting.id },
      });
      assert.ok(!ownedResult.isError, 'своя встреча не должна давать ошибку');
      assert.deepEqual(taskTitles(ownedResult), ['Prepare slides', 'Book room']);

      // 11. addTask: чужой пользователь (свой токен) → ошибка владельца.
      const foreignAddResult = await clientUser2.callTool({
        name: 'addTask',
        arguments: { meeting_id: meeting.id, title: 'Sneak' },
      });
      assert.equal(foreignAddResult.isError, true);
      assert.match(JSON.parse(foreignAddResult.content[0].text).error, /does not belong to user/);

      // 12. Динамический ресурс: task://{id} возвращает задачу по id (своя встреча).
      const byId = await clientUser1.readResource({ uri: `task://${createdTask.id}` });
      const singleTask = JSON.parse(byId.contents[0].text);
      assert.equal(singleTask.title, 'Prepare slides');
      assert.equal(singleTask.assignee, 'Alice');

      // 13. Динамический ресурс: чужой пользователь не видит задачу (как «не найдена»).
      await assert.rejects(
        clientUser2.readResource({ uri: `task://${createdTask.id}` }),
        /not found/,
        'чужая задача должна читаться как «не найдена»',
      );

      // 14. Статический ресурс: tasks://open — только открытые задачи своих встреч.
      const openTasks = await clientUser1.readResource({ uri: 'tasks://open' });
      const openTitles = taskTitlesFromResource(openTasks);
      assert.ok(openTitles.includes('Prepare slides'), 'открытые задачи включены');
      assert.ok(openTitles.includes('Book room'), 'новая открытая задача включена');

      const openTasksUser2 = await clientUser2.readResource({ uri: 'tasks://open' });
      assert.deepEqual(
        taskTitlesFromResource(openTasksUser2),
        [],
        'у user-2 без своих встреч открытых задач нет',
      );

      // 15. Промпт meeting_brief: структурированное сообщение с информацией встречи.
      const brief = await clientUser1.getPrompt({
        name: 'meeting_brief',
        arguments: { meeting_id: meeting.id },
      });
      const briefText = promptText(brief);
      assert.match(briefText, /Meeting Brief: Planning/);
      assert.match(briefText, /Sprint planning/);

      // 16. Промпт meeting_brief: чужая встреча — ошибка владельца.
      await assert.rejects(
        clientUser2.getPrompt({ name: 'meeting_brief', arguments: { meeting_id: meeting.id } }),
        /does not belong to user/,
        'чужой пользователь не получает бриф встречи',
      );

      // 17. Промпт meeting_task_review: агрегированные задачи встречи.
      const review = await clientUser1.getPrompt({
        name: 'meeting_task_review',
        arguments: { meeting_id: meeting.id },
      });
      const reviewText = promptText(review);
      assert.match(reviewText, /Meeting Task Review: Planning/);
      assert.match(reviewText, /Prepare slides/);
      assert.match(reviewText, /Book room/);

      // 18. findTask: чужой пользователь → ошибка владельца.
      const foreignResult = await clientUser2.callTool({
        name: 'findTask',
        arguments: { query: '', meeting_id: meeting.id },
      });
      assert.equal(foreignResult.isError, true);
      const foreignError = JSON.parse(foreignResult.content[0].text);
      assert.match(foreignError.error, /does not belong to user/);

      // 19. Неизвестная встреча → ошибка.
      const missingResult = await clientUser1.callTool({
        name: 'findTask',
        arguments: { query: '', meeting_id: 'missing' },
      });
      assert.equal(missingResult.isError, true);
      const missingError = JSON.parse(missingResult.content[0].text);
      assert.match(missingError.error, /not found/);
    } finally {
      await clientUser1?.close();
      await clientUser2?.close();
      child.kill('SIGTERM');
      if (apiOutput.trim()) {
        t.diagnostic(`вывод API:\n${apiOutput.trim()}`);
      }
    }
  },
);
