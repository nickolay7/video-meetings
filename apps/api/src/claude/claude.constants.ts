/**
 * Режимы разрешений для headless-сессии Claude Code. `bypassPermissions` — дефолт:
 * неинтерактивный вызов не зависает на запросах разрешений на использование инструментов.
 */
export type ClaudePermissionMode =
  'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto';

const CLAUDE_PERMISSION_MODES: readonly ClaudePermissionMode[] = [
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
  'dontAsk',
  'auto',
];

/** Таймаут выполнения запроса к Claude по умолчанию (мс): защита от зависшей сессии CLI. */
export const DEFAULT_CLAUDE_TIMEOUT_MS = 120_000;

/**
 * Базовый URL Anthropic-совместимого API: берётся из env `ANTHROPIC_BASE_URL`
 * (в корневом `.env` — локальный гейтвей). Пустая строка → undefined.
 */
export function getClaudeBaseUrl(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  return baseUrl && baseUrl.trim() !== '' ? baseUrl.trim() : undefined;
}

/**
 * Bearer-токен для аутентификации на гейтвее: env `ANTHROPIC_AUTH_TOKEN`
 * (в корневом `.env`). Пустая строка → undefined.
 */
export function getClaudeAuthToken(): string | undefined {
  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  return token && token.trim() !== '' ? token.trim() : undefined;
}

/**
 * Модель для запросов: env `CLAUDE_MODEL` или `ANTHROPIC_MODEL`.
 * Если не задана — модель не передаём, применяется дефолт CLI (в этом репо —
 * `auto/best-free` из `.claude/settings.json`).
 */
export function getClaudeModel(): string | undefined {
  const model = process.env.CLAUDE_MODEL ?? process.env.ANTHROPIC_MODEL;
  return model && model.trim() !== '' ? model.trim() : undefined;
}

/**
 * Режим разрешений headless-сессии: env `CLAUDE_PERMISSION_MODE`,
 * default — `bypassPermissions`.
 */
export function getClaudePermissionMode(): ClaudePermissionMode {
  const raw = process.env.CLAUDE_PERMISSION_MODE;
  return (CLAUDE_PERMISSION_MODES as readonly string[]).includes(raw ?? '')
    ? (raw as ClaudePermissionMode)
    : 'bypassPermissions';
}

/**
 * Таймаут выполнения запроса к Claude (мс): env `CLAUDE_TIMEOUT_MS`,
 * default — `DEFAULT_CLAUDE_TIMEOUT_MS`. По образцу `getWhisperTimeoutMs`.
 */
export function getClaudeTimeoutMs(): number {
  const raw = process.env.CLAUDE_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CLAUDE_TIMEOUT_MS;
}
