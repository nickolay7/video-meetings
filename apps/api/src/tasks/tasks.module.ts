import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MeetingsModule } from '../meetings/meetings.module';
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
  providers: [JwtAuthGuard, TasksService, TasksRepository],
  exports: [TasksService, TasksRepository],
})
export class TasksModule {}
