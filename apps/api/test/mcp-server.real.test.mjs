import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Клиентский тест-скрипт: запускает собранный MCP-сервер как подпроцесс (stdio),
// подключается к нему через MCP-клиент и выполняет проверки. Скрипт `test:mcp`
// собирает API перед запуском (нужен dist/mcp/mcp-server.js).

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.resolve(__dirname, '..', 'dist', 'mcp', 'mcp-server.js');

function seedFilePath() {
  const seedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-meeting-tasks-'));
  const seedFile = path.join(seedDir, 'seed.json');
  fs.writeFileSync(
    seedFile,
    JSON.stringify(
      {
        meetings: [
          { id: 'meeting-1', ownerId: 'user-1', name: 'Planning', description: '' },
          { id: 'meeting-2', ownerId: 'user-2', name: 'Other planning', description: '' },
        ],
        tasks: [
          {
            id: 'task-1',
            meetingId: 'meeting-1',
            title: 'Prepare slides',
            source: 'manual',
            status: 'open',
            assignee: 'Alice',
          },
          {
            id: 'task-2',
            meetingId: 'meeting-1',
            title: 'Send summary',
            source: 'manual',
            status: 'open',
          },
          {
            id: 'task-3',
            meetingId: 'meeting-1',
            title: 'Completed task',
            source: 'manual',
            status: 'completed',
          },
        ],
      },
      null,
      2,
    ),
  );
  return { seedDir, seedFile };
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
  'MCP meeting-tasks: подпроцесс + MCP-клиент — инструменты, ресурсы, промпты',
  { timeout: 30_000 },
  async (t) => {
    assert.ok(
      fs.existsSync(SERVER_PATH),
      `Сначала соберите API (npm run build:api): не найден ${SERVER_PATH}`,
    );

    const { seedDir, seedFile } = seedFilePath();

    // StdioClientTransport сам спавнит сервер как подпроцесс и общается по stdin/stdout.
    const client = new Client({ name: 'mcp-client-test', version: '1.0.0' }, { capabilities: {} });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_PATH],
      env: { ...process.env, MCP_SEED_FILE: seedFile },
      stderr: 'pipe',
    });

    let stderrOutput = '';
    transport.stderr?.setEncoding('utf8');
    transport.stderr?.on('data', (chunk) => {
      stderrOutput += chunk;
    });

    try {
      await client.connect(transport);

      // 1. JSON-описание сервера: name/version из конструктора McpServer (SDK).
      assert.deepEqual(client.getServerVersion(), { name: 'meeting-tasks', version: '1.0.0' });

      // 2. Список инструментов: findTask (readOnly) и addTask (запись).
      const { tools } = await client.listTools();
      const findTask = tools.find((tool) => tool.name === 'findTask');
      const addTask = tools.find((tool) => tool.name === 'addTask');
      assert.ok(findTask, 'findTask должен быть зарегистрирован');
      assert.ok(addTask, 'addTask должен быть зарегистрирован');
      assert.match(findTask.description, /Search tasks of a meeting/);
      assert.equal(findTask.annotations.readOnlyHint, true);
      assert.equal(addTask.annotations.readOnlyHint, false);
      assert.deepEqual(Object.keys(findTask.inputSchema.properties ?? {}), [
        'query',
        'meeting_id',
        'user_id',
      ]);

      // 3. Список ресурсов: статический tasks://open и шаблон task://{id}.
      const { resources } = await client.listResources();
      const openTasksResource = resources.find((resource) => resource.uri === 'tasks://open');
      assert.ok(openTasksResource, 'tasks://open должен быть зарегистрирован');
      assert.equal(openTasksResource.name, 'tasks.open');

      const { resourceTemplates } = await client.listResourceTemplates();
      const taskByIdTemplate = resourceTemplates.find(
        (template) => template.uriTemplate === 'task://{id}',
      );
      assert.ok(taskByIdTemplate, 'task://{id} должен быть зарегистрирован');

      // 4. Список промптов: meeting_brief и meeting_task_review.
      const { prompts } = await client.listPrompts();
      assert.ok(
        prompts.find((prompt) => prompt.name === 'meeting_brief'),
        'meeting_brief есть',
      );
      assert.ok(
        prompts.find((prompt) => prompt.name === 'meeting_task_review'),
        'meeting_task_review есть',
      );

      // 5. findTask: своя встреча (user-1 owns meeting-1) → все задачи.
      const ownedResult = await client.callTool({
        name: 'findTask',
        arguments: { query: '', meeting_id: 'meeting-1', user_id: 'user-1' },
      });
      assert.ok(!ownedResult.isError, 'своя встреча не должна давать ошибку');
      assert.deepEqual(taskTitles(ownedResult), [
        'Prepare slides',
        'Send summary',
        'Completed task',
      ]);

      // 6. addTask: создание задачи через единый сервисный слой.
      const addResult = await client.callTool({
        name: 'addTask',
        arguments: {
          meeting_id: 'meeting-1',
          user_id: 'user-1',
          title: 'Book room',
          assignee: 'Bob',
        },
      });
      assert.ok(!addResult.isError, 'создание задачи не должно давать ошибку');
      const createdTask = JSON.parse(addResult.content[0].text);
      assert.equal(createdTask.title, 'Book room');
      assert.equal(createdTask.meetingId, 'meeting-1');
      assert.equal(createdTask.status, 'open');

      // 7. addTask: чужая встреча → ошибка владельца.
      const foreignAddResult = await client.callTool({
        name: 'addTask',
        arguments: { meeting_id: 'meeting-2', user_id: 'user-1', title: 'Sneak' },
      });
      assert.equal(foreignAddResult.isError, true);
      assert.match(JSON.parse(foreignAddResult.content[0].text).error, /does not belong to user/);

      // 8. Динамический ресурс: task://{id} возвращает задачу по id.
      const byId = await client.readResource({ uri: 'task://task-1' });
      const singleTask = JSON.parse(byId.contents[0].text);
      assert.equal(singleTask.title, 'Prepare slides');
      assert.equal(singleTask.assignee, 'Alice');

      // 9. Статический ресурс: tasks://open — только открытые задачи (без task-3 и без новой? нет — новая открытая).
      const openTasks = await client.readResource({ uri: 'tasks://open' });
      const openTitles = taskTitlesFromResource(openTasks);
      assert.ok(openTitles.includes('Prepare slides'), 'открытые задачи включены');
      assert.ok(openTitles.includes('Book room'), 'новая открытая задача включена');
      assert.ok(!openTitles.includes('Completed task'), 'завершённая задача исключена');

      // 10. Промпт meeting_brief: структурированное сообщение с информацией встречи.
      const brief = await client.getPrompt({
        name: 'meeting_brief',
        arguments: { meeting_id: 'meeting-1' },
      });
      assert.match(promptText(brief), /Meeting Brief: Planning/);

      // 11. Промпт meeting_task_review: агрегированные задачи встречи.
      const review = await client.getPrompt({
        name: 'meeting_task_review',
        arguments: { meeting_id: 'meeting-1' },
      });
      const reviewText = promptText(review);
      assert.match(reviewText, /Meeting Task Review: Planning/);
      assert.match(reviewText, /Prepare slides/);
      assert.match(reviewText, /Book room/);

      // 12. Чужая встреча для findTask → ошибка владельца.
      const foreignResult = await client.callTool({
        name: 'findTask',
        arguments: { query: '', meeting_id: 'meeting-2', user_id: 'user-1' },
      });
      assert.equal(foreignResult.isError, true);
      const foreignError = JSON.parse(foreignResult.content[0].text);
      assert.match(foreignError.error, /does not belong to user/);

      // 13. Неизвестная встреча → ошибка.
      const missingResult = await client.callTool({
        name: 'findTask',
        arguments: { query: '', meeting_id: 'missing', user_id: 'user-1' },
      });
      assert.equal(missingResult.isError, true);
      const missingError = JSON.parse(missingResult.content[0].text);
      assert.match(missingError.error, /not found/);
    } finally {
      await client.close();
      fs.rmSync(seedDir, { recursive: true, force: true });
      if (stderrOutput.trim()) {
        t.diagnostic(`stderr сервера:\n${stderrOutput.trim()}`);
      }
    }
  },
);
