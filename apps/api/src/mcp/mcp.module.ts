import { Module } from '@nestjs/common';
import { MeetingsModule } from '../meetings/meetings.module';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { TasksModule } from '../tasks/tasks.module';
import { TasksRepository } from '../tasks/tasks.repository';
import {
  createMeetingMcpServer,
  MEETING_MCP_SERVER_FACTORY,
  type MeetingMcpServerFactory,
} from './meeting-tool';

/**
 * Модуль MCP-инструментов встречи. Экспортирует фабрику `(meetingId) => server`, которая
 * из `meeting-tool.ts` собирает MCP-сервер `meeting`, скопированный под конкретную встречу.
 * Скопирование обязательно: `meetingId` модель не передаёт, поэтому untrusted-текст
 * транскрипции в промпте не может переключить инструменты на чужую встречу.
 */
@Module({
  imports: [TasksModule, MeetingsModule],
  providers: [
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
