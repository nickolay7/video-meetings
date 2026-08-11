import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { Task } from './task.entity';
import { TasksService } from './tasks.service';

@Controller('meetings/:id/tasks')
@UseGuards(JwtAuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  async list(@Param('id') meetingId: string): Promise<Task[]> {
    return this.tasksService.listForMeeting(meetingId);
  }

  @Patch(':taskId')
  async updateStatus(
    @Param('id') meetingId: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<Task> {
    return this.tasksService.updateStatus(meetingId, taskId, dto.status);
  }
}
