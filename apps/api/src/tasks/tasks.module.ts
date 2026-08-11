import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MeetingsModule } from '../meetings/meetings.module';
import { TaskTools } from './task-tools';
import { TasksController } from './tasks.controller';
import { TasksRepository } from './tasks.repository';
import { TasksService } from './tasks.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'default-secret-key',
    }),
    MeetingsModule,
  ],
  controllers: [TasksController],
  providers: [
    JwtAuthGuard,
    TasksService,
    TasksRepository,
    // Регистратор MCP-примитивов задач: McpModule (композиционный корень MCP-слоя)
    // собирает такие регистраторы из доменных модулей в массив `MCP_TOOL_REGISTER`.
    TaskTools,
  ],
  exports: [TasksService, TasksRepository, TaskTools],
})
export class TasksModule {}
