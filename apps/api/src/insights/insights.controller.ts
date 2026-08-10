import { Controller, Get, Param, UseGuards, ConflictException } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { InsightData } from './insights.service';
import { InsightsRepository } from './insights.repository';
import { InsightsStatus } from './meeting-insights.entity';
import { FilesService } from '../files/files.service';

export type InsightsStatusResponse = { status: InsightsStatus | 'none'; error?: string };

@Controller('meetings/:id/files/:fileId')
@UseGuards(JwtAuthGuard)
export class InsightsController {
  constructor(
    private readonly insightsRepository: InsightsRepository,
    private readonly filesService: FilesService,
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
    return {
      summary: insights.summary ?? '',
      actionItems: insights.actionItems ?? [],
      decisions: insights.decisions ?? [],
    };
  }
}
