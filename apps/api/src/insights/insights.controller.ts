import { Controller, Get, Param, UseGuards, ConflictException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InsightData } from './insights-generator.service';
import { InsightsRepository } from './insights.repository';
import { InsightsStatus } from './meeting-insights.entity';
import { FilesService } from '../files/files.service';
import { TasksService } from '../tasks/tasks.service';

export type InsightsStatusResponse = { status: InsightsStatus | 'none'; error?: string };

@Controller('meetings/:id/files/:fileId')
@UseGuards(JwtAuthGuard)
export class InsightsController {
  constructor(
    private readonly insightsRepository: InsightsRepository,
    private readonly filesService: FilesService,
    private readonly tasksService: TasksService,
  ) {}

  @Get('insights/status')
  async getStatus(
    @Param('id') meetingId: string,
    @Param('fileId') fileId: string,
  ): Promise<InsightsStatusResponse> {
    await this.filesService.findForMeeting(meetingId, fileId);
    const insights = await this.insightsRepository.findByFileId(fileId);
    if (!insights) {
      return { status: 'none' };
    }
    return { status: insights.status, error: insights.error };
  }

  @Get('insights')
  async getInsights(
    @Param('id') meetingId: string,
    @Param('fileId') fileId: string,
  ): Promise<InsightData> {
    await this.filesService.findForMeeting(meetingId, fileId);
    const insights = await this.insightsRepository.findByFileId(fileId);
    if (!insights || insights.status !== 'completed') {
      throw new ConflictException('Insights are not ready yet');
    }
    // Action items теперь живут как отдельные записи Task (источник истины),
    // а в ответе инсайтов отдаются проекцией для обратной совместимости с фронтендом.
    const tasks = await this.tasksService.listForMeeting(meetingId);
    return {
      summary: insights.summary ?? '',
      actionItems: tasks.map((task) => ({ text: task.title, assignee: task.assignee })),
      decisions: insights.decisions ?? [],
    };
  }
}
