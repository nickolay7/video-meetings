import { Injectable, NotFoundException } from '@nestjs/common';
import { MeetingsRepository } from '../meetings/meetings.repository';
import { Task, TaskStatus } from './task.entity';
import { TasksRepository } from './tasks.repository';

/** Action item, извлечённый генератором инсайтов из транскрипции. */
export interface InsightsActionItem {
  text: string;
  assignee?: string;
}

@Injectable()
export class TasksService {
  constructor(
    private readonly tasksRepository: TasksRepository,
    private readonly meetingsRepository: MeetingsRepository,
  ) {}

  async listForMeeting(meetingId: string): Promise<Task[]> {
    await this.ensureMeetingExists(meetingId);
    return this.tasksRepository.findAllByMeeting(meetingId);
  }

  async updateStatus(meetingId: string, taskId: string, status: TaskStatus): Promise<Task> {
    await this.ensureMeetingExists(meetingId);
    const task = await this.findTaskForMeeting(meetingId, taskId);
    return this.tasksRepository.updateStatus(task, status);
  }

  /**
   * Удаляет задачи встречи, сгенерированные из инсайтов. Вызывается перед стартом
   * генерации, чтобы перегенерация заменяла старые задачи новыми.
   */
  async removeInsightsTasks(meetingId: string): Promise<void> {
    await this.tasksRepository.removeAllForMeetingBySource(meetingId, 'insights');
  }

  /** Создаёт задачи встречи из action items, извлечённых генератором инсайтов. */
  async createInsightsTasks(meetingId: string, actionItems: InsightsActionItem[]): Promise<void> {
    for (const actionItem of actionItems) {
      await this.tasksRepository.create(
        meetingId,
        actionItem.text,
        'insights',
        actionItem.assignee,
      );
    }
  }

  private async ensureMeetingExists(meetingId: string): Promise<void> {
    const meeting = await this.meetingsRepository.findById(meetingId);
    if (!meeting) {
      throw new NotFoundException(`Meeting with id ${meetingId} not found`);
    }
  }

  private async findTaskForMeeting(meetingId: string, taskId: string): Promise<Task> {
    const task = await this.tasksRepository.findById(taskId);
    if (!task || task.meetingId !== meetingId) {
      throw new NotFoundException(`Task with id ${taskId} not found`);
    }
    return task;
  }
}
