import { Logger } from '@nestjs/common';
import type {
  HookCallbackMatcher,
  HookEvent,
  HookInput,
  PreToolUseHookInput,
  PostToolUseHookInput,
  PreToolUseHookSpecificOutput,
  SyncHookJSONOutput,
} from '@anthropic-ai/claude-agent-sdk';

/**
 * PreToolUse-хук: валидация входных данных для инструмента создания/обновления задачи
 * (`updateTask` — аналог `absurd_task` из ТЗ). Срабатывает перед выполнением инструмента.
 * Возвращает пустой объект {} для разрешения, или hookSpecificOutput с permissionDecision: 'deny' для блокировки.
 */
export function createPreToolUseGuardHook(): HookCallbackMatcher {
  return {
    matcher: 'updateTask',
    hooks: [
      async (input: HookInput): Promise<SyncHookJSONOutput> => {
        const preInput = input as PreToolUseHookInput;
        const toolInput = preInput.tool_input as Record<string, unknown> | undefined;

        // Если это не updateTask — пропускаем (пустой объект = разрешить).
        // matcher: 'updateTask' уже сужает вызовы на уровне SDK; проверка внутри —
        // страховка от случайного расширения matcher.
        if (preInput.tool_name !== 'updateTask') {
          return {};
        }

        const title = toolInput?.title as string | undefined;

        // title не может быть пустым
        if (!title || title.trim() === '') {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'title обязателен',
            } as PreToolUseHookSpecificOutput,
          };
        }

        // title должен содержать более трёх символов
        if (title.trim().length <= 3) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: 'title слишком короткий (минимум 4 символа)',
            } as PreToolUseHookSpecificOutput,
          };
        }

        // Разрешаем выполнение (пустой объект = continue)
        return {};
      },
    ],
  };
}

/**
 * PostToolUse-хук: аудит-лог операций.
 * Логирует название инструмента, входные аргументы и результат.
 * Возвращает пустой объект {} для прохождения без изменений.
 */
export function createAuditLogHook(logger: Logger): HookCallbackMatcher {
  return {
    hooks: [
      async (input: HookInput): Promise<SyncHookJSONOutput> => {
        const postInput = input as PostToolUseHookInput;

        const toolName = postInput.tool_name;
        const toolInput = postInput.tool_input;
        const toolResponse = postInput.tool_response;

        logger.log(
          `[Audit] Tool: ${toolName} | Input: ${JSON.stringify(toolInput)} | Result: ${JSON.stringify(toolResponse)}`,
        );

        // Проходим без изменений (пустой объект = разрешить/продолжить)
        return {};
      },
    ],
  };
}

/**
 * Хук ограничения бюджета вызовов (call budget).
 * Реализован как замыкание с внутренним счётчиком.
 * При превышении лимита блокирует дальнейшие вызовы через PreToolUse deny.
 */
export function createCallBudgetHook(maxCalls = 20): HookCallbackMatcher {
  let callCount = 0;

  return {
    hooks: [
      async (_input: HookInput): Promise<SyncHookJSONOutput> => {
        callCount += 1;

        if (callCount > maxCalls) {
          return {
            hookSpecificOutput: {
              hookEventName: 'PreToolUse',
              permissionDecision: 'deny',
              permissionDecisionReason: `Превышен лимит вызовов инструментов (${maxCalls}). Генерация прервана.`,
            } as PreToolUseHookSpecificOutput,
          };
        }

        // Разрешаем выполнение (пустой объект = continue)
        return {};
      },
    ],
  };
}

/**
 * Сборка всех хуков для сервиса генерации инсайтов.
 * Вызывается при инициализации MeetingProcessorService (InsightsGeneratorService)
 * и передаётся через опцию hooks в конфигурацию агента.
 *
 * Возвращает карту событий → матчеры (формат опции `hooks` SDK):
 * PreToolUse — guard (валидация входов updateTask) и call budget (лимит вызовов),
 * PostToolUse — аудит-лог каждой операции.
 *
 * @param logger - Nest Logger для аудит-лога
 * @param maxToolCalls - лимит вызовов инструментов (по умолчанию 20)
 */
export function buildMeetingHooks(
  logger: Logger,
  maxToolCalls = 20,
): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [createPreToolUseGuardHook(), createCallBudgetHook(maxToolCalls)],
    PostToolUse: [createAuditLogHook(logger)],
  };
}
