import { Module } from '@nestjs/common';
import { ClaudeAgentService } from './claude.service';

/**
 * Модуль работы с Claude Agent SDK. Интеграционный слой без HTTP-контроллеров:
 * экспортирует `ClaudeAgentService`, чтобы другие модули выполняли текстовые
 * запросы к Claude. Аутентификация — через `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`
 * из корневого `.env` (поднимается `loadEnvConfig()` из `main.ts`).
 */
@Module({
  providers: [ClaudeAgentService],
  exports: [ClaudeAgentService],
})
export class ClaudeModule {}
