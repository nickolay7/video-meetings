import { test } from 'node:test';
import assert from 'node:assert/strict';
import dotenv from 'dotenv';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Креды поднимаются из корневого `.env` ДО оценки skip-условия.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

const hasClaudeCredentials = Boolean(
  process.env.ANTHROPIC_BASE_URL && process.env.ANTHROPIC_AUTH_TOKEN,
);

// Сервис берём из собранного `dist` (CJS), чтобы протестировать реальный модуль,
// а не дублировать его логику. Скрипт `test:claude` собирает API перед запуском.
const { ClaudeAgentService } = await import('../dist/claude/claude.service.js');

test(
  'Claude Agent SDK: реальный вызов API возвращает текст модели',
  { skip: !hasClaudeCredentials, timeout: 150_000 },
  async () => {
    const claudeAgentService = new ClaudeAgentService();
    const text = await claudeAgentService.run('Reply with exactly: hello world');

    assert.equal(text.trim(), 'hello world');
  },
);
