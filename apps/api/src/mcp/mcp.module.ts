import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TasksModule } from '../tasks/tasks.module';
import { TasksRepository } from '../tasks/tasks.repository';
import { createMeetingMcpServer, MEETING_MCP_SERVER } from './meeting-tool';

/**
 * Модуль MCP-инструментов встречи. Собирает из `meeting-tool.ts` MCP-сервер `meeting`
 * поверх репозиториев Task/Meeting и экспортирует его токен, чтобы запросы к Claude
 * могли передавать инструменты через `mcpServers`.
 */
@Module({
  imports: [TasksModule, MeetingsModule],
  providers: [
    {
      provide: MEETING_MCP_SERVER,
      inject: [TasksRepository, MeetingsRepository],
      useFactory: (tasksRepository: TasksRepository, meetingsRepository: MeetingsRepository) =>
        createMeetingMcpServer({ tasksRepository, meetingsRepository }),
    },
  ],
  exports: [MEETING_MCP_SERVER],
})
export class McpModule {}
