import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TranscriptionService } from './transcription.service';
import { TranscriptionStatus } from './transcription.entity';

export type TranscriptionStatusResponse = { status: TranscriptionStatus | 'none'; error?: string };

@Controller('meetings/:id/files/:fileId')
@UseGuards(JwtAuthGuard)
export class TranscriptionController {
  constructor(private readonly transcriptionService: TranscriptionService) {}

  @Post('transcribe')
  async enqueue(
    @Param('id') meetingId: string,
    @Param('fileId') fileId: string,
  ): Promise<{ status: 'queued' }> {
    return this.transcriptionService.enqueue(meetingId, fileId);
  }

  @Get('transcription/status')
  async getStatus(
    @Param('id') meetingId: string,
    @Param('fileId') fileId: string,
  ): Promise<TranscriptionStatusResponse> {
    return this.transcriptionService.getStatus(meetingId, fileId);
  }

  @Get('transcription')
  async getText(
    @Param('id') meetingId: string,
    @Param('fileId') fileId: string,
  ): Promise<{ text: string }> {
    return this.transcriptionService.getText(meetingId, fileId);
  }
}
