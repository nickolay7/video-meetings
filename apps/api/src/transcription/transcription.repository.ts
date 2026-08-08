import { Injectable } from '@nestjs/common';
import { Transcription } from './transcription.entity';

/**
 * In-memory хранилище метаданных транскрибации: одна транскрибация на файл,
 * ключ — fileId. По образцу FilesRepository; e2e чистит через `clear()`.
 */
@Injectable()
export class TranscriptionRepository {
  private transcriptions: Map<string, Transcription> = new Map();

  async findByFileId(fileId: string): Promise<Transcription | undefined> {
    return this.transcriptions.get(fileId);
  }

  async create(fileId: string, meetingId: string): Promise<Transcription> {
    const transcription = new Transcription(fileId, meetingId, 'queued', new Date());
    this.transcriptions.set(fileId, transcription);
    return transcription;
  }

  /** Сохраняет мутированную сущность (обновление статуса/текста/ошибки). */
  async save(transcription: Transcription): Promise<void> {
    this.transcriptions.set(transcription.fileId, transcription);
  }

  async clear(): Promise<void> {
    this.transcriptions.clear();
  }
}
