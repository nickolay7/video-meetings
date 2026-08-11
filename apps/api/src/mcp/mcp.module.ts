import { Module } from '@nestjs/common';
import { McpAuthGuard } from '../guards/mcp-auth.guard';
import { MeetingsModule } from '../meetings/meetings.module';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TaskTools } from '../tasks/task-tools';
import { TasksModule } from '../tasks/tasks.module';
import { TasksRepository } from '../tasks/tasks.repository';
import { MCP_TOOL_REGISTER } from './mcp.constants';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';
import type { McpToolRegister } from './mcp-tool-register';
import {
  createMeetingMcpServer,
  MEETING_MCP_SERVER_FACTORY,
  type MeetingMcpServerFactory,
} from './meeting-tool';

/**
 * Модуль MCP-слоя приложения. Две независимые части:
 *
 * 1. HTTP-endpoint `/mcp` (McpController + McpService): единый MCP-сервер поверх
 *    `StreamableHTTPServerTransport` (stateless + JSON-ответы). Аутентификация —
 *    `McpAuthGuard` (Bearer-JWT), авторизация — на уровне данных инструментов через
 *    `Requester` из токена + `MeetingOwner`. Инструменты/ресурсы/промпты собираются из
 *    регистраторов доменов. Доменный модуль предоставляет и экспортирует свой регистратор
 *    (например, `TaskTools` из `TasksModule`); McpModule — композиционный корень — инжектит
 *    их и собирает в массив под токеном `MCP_TOOL_REGISTER` (NestJS не поддерживает
 *    `multi: true`, поэтому массив строится `useFactory`). Новый домен = добавить его
 *    регистратор в `inject`/массив этой фабрики. McpService применяет массив к MCP-серверу
 *    при каждом HTTP-запросе.
 *
 * 2. Фабрика MCP-сервера встречи `MEETING_MCP_SERVER_FACTORY`: собирает из `meeting-tool.ts`
 *    MCP-сервер `meeting`, скопированный под конкретную встречу (для генерации инсайтов).
 *    Скопирование обязательно: `meetingId` модель не передаёт, поэтому untrusted-текст
 *    транскрипции в промпте не может переключить инструменты на чужую встречу.
 */
@Module({
  imports: [TasksModule, MeetingsModule],
  controllers: [McpController],
  providers: [
    McpService,
    McpAuthGuard,
    {
      provide: MCP_TOOL_REGISTER,
      inject: [TaskTools],
      useFactory: (taskTools: TaskTools): McpToolRegister[] => [taskTools],
    },
    {
      provide: MEETING_MCP_SERVER_FACTORY,
      inject: [TasksRepository, MeetingsRepository],
      useFactory:
        (
          tasksRepository: TasksRepository,
          meetingsRepository: MeetingsRepository,
        ): MeetingMcpServerFactory =>
        (meetingId: string) =>
          createMeetingMcpServer({ tasksRepository, meetingsRepository }, { meetingId }),
    },
  ],
  exports: [MEETING_MCP_SERVER_FACTORY],
})
export class McpModule {}
