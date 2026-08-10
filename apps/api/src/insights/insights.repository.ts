import { Injectable } from '@nestjs/common';
import { MeetingInsights, InsightsStatus } from './meeting-insights.entity';

/**
 * In-memory хранилище метаданных инсайтов: одна запись на файл,
 * ключ — fileId. По образцу TranscriptionRepository.
 */
@Injectable()
export class InsightsRepository {
  private insights: Map<string, MeetingInsights> = new Map();

  async findByFileId(fileId: string): Promise<MeetingInsights | undefined> {
    return this.insights.get(fileId);
  }

  async create(fileId: string, meetingId: string): Promise<MeetingInsights> {
    const insights = new MeetingInsights(fileId, meetingId, 'queued', new Date());
    this.insights.set(fileId, insights);
    return insights;
  }

  /** Сохраняет мутированную сущность (обновление статуса/текста/ошибки). */
  async save(insights: MeetingInsights): Promise<void> {
    this.insights.set(insights.fileId, insights);
  }

  async clear(): Promise<void> {
    this.insights.clear();
  }
}
