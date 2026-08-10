import { Injectable, Logger } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import {
  getClaudeAuthToken,
  getClaudeBaseUrl,
  getClaudeModel,
  getClaudePermissionMode,
  getClaudeTimeoutMs,
} from './claude.constants';

/** Опциональные параметры запроса к Claude. */
export interface ClaudeQueryOptions {
  /** Системный промпт, направляющий поведение модели. */
  systemPrompt?: string;
  /** Максимальное число итераций агента (защита от бесконечного цикла). */
  maxTurns?: number;
}

/**
 * Обёртка над Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`): выполняет
 * текстовый запрос через локальный гейтвей и возвращает финальный текст.
 *
 * SDK при каждом вызове спавнит CLI Claude Code (платформенный бинарь из
 * optionalDependencies) как дочерний процесс; аутентификация — через
 * `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` из корневого `.env`,
 * проброшенные в окружение дочернего процесса через `options.env`.
 *
 * Модуль рассчитан на Node ≥ 22.12 (там `require(esm)` загружает ESM-only SDK
 * из CommonJS-сборки Nest). Таймаут (`CLAUDE_TIMEOUT_MS`) прерывает зависшую
 * сессию через `AbortController`, чтобы не заблокировать вызывающий код навсегда.
 */
@Injectable()
export class ClaudeAgentService {
  private readonly logger = new Logger(ClaudeAgentService.name);

  /** Выполняет запрос и возвращает текст ответа модели. */
  async run(prompt: string, options: ClaudeQueryOptions = {}): Promise<string> {
    const timeoutMs = getClaudeTimeoutMs();
    const abortController = new AbortController();
    const timer = setTimeout(() => abortController.abort(), timeoutMs);

    const result = query({
      prompt,
      options: {
        abortController,
        cwd: process.cwd(),
        env: {
          ...process.env,
          ANTHROPIC_BASE_URL: getClaudeBaseUrl(),
          ANTHROPIC_AUTH_TOKEN: getClaudeAuthToken(),
        },
        permissionMode: getClaudePermissionMode(),
        ...(getClaudeModel() ? { model: getClaudeModel() } : {}),
        ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
        ...(options.maxTurns ? { maxTurns: options.maxTurns } : {}),
      },
    });

    try {
      for await (const message of result) {
        if (message.type !== 'result') continue;
        if (message.subtype === 'success') {
          return message.result;
        }
        throw new Error(`Claude query failed: ${message.errors.join(', ')}`);
      }
      throw new Error('Claude query finished without a result');
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new Error(`Claude query timed out after ${timeoutMs} ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
      this.logger.log(`Claude query finished (timeout ${timeoutMs} ms)`);
    }
  }
}
