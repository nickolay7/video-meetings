import { BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { getUploadsDir } from '../files/files.constants';
import { FilesService } from '../files/files.service';
import { InsightsGeneratorService } from '../insights/insights-generator.service';
import { SPEECH_TRANSCRIBER, SpeechTranscriber } from './speech-transcriber.interface';
import { TranscriptionRepository } from './transcription.repository';
import { TranscriptionStatus } from './transcription.entity';
import { isSupportedTranscriptionFormat } from './transcription.constants';

@Injectable()
export class TranscriptionService {
  private readonly logger = new Logger(TranscriptionService.name);

  /**
   * Хвост promise-цепочки очереди: каждый следующий файл транскрибируется только после
   * завершения предыдущего — одновременно обрабатывается ровно один файл.
   */
  private queueTail: Promise<void> = Promise.resolve();
  /** Поколение очереди: инкрементируется в `clear()`, чтобы завершить устаревшие джобы без записи. */
  private generation = 0;

  constructor(
    private readonly transcriptionRepository: TranscriptionRepository,
    private readonly filesService: FilesService,
    @Inject(SPEECH_TRANSCRIBER) private readonly speechTranscriber: SpeechTranscriber,
    private readonly insightsGeneratorService: InsightsGeneratorService,
  ) {}

  async enqueue(meetingId: string, fileId: string): Promise<{ status: 'queued' }> {
    const file = await this.filesService.findForMeeting(meetingId, fileId);

    if (!isSupportedTranscriptionFormat(file)) {
      throw new BadRequestException('Only MP3/MP4 files can be transcribed');
    }

    const existing = await this.transcriptionRepository.findByFileId(fileId);
    if (existing) {
      if (existing.status === 'completed') {
        throw new ConflictException('File is already transcribed');
      }
      if (existing.status === 'queued' || existing.status === 'processing') {
        throw new ConflictException('File is already queued for transcription');
      }
      // Статус 'failed' — повторный запуск разрешён: сбрасываем метаданные ошибки.
      existing.status = 'queued';
      existing.error = undefined;
      existing.text = undefined;
      await this.transcriptionRepository.save(existing);
    } else {
      await this.transcriptionRepository.create(fileId, meetingId);
    }

    const filePath = path.join(getUploadsDir(), meetingId, file.storedName);
    const generation = this.generation;
    this.queueTail = this.queueTail
      .then(() => this.processJob(fileId, filePath, generation))
      .catch((error: unknown) => {
        this.logger.error(`Transcription job for file ${fileId} crashed: ${String(error)}`);
      });

    return { status: 'queued' };
  }

  async getStatus(
    meetingId: string,
    fileId: string,
  ): Promise<{ status: TranscriptionStatus | 'none'; error?: string }> {
    await this.filesService.findForMeeting(meetingId, fileId);
    const transcription = await this.transcriptionRepository.findByFileId(fileId);
    if (!transcription) {
      return { status: 'none' };
    }
    return { status: transcription.status, error: transcription.error };
  }

  async getText(meetingId: string, fileId: string): Promise<{ text: string }> {
    await this.filesService.findForMeeting(meetingId, fileId);
    const transcription = await this.transcriptionRepository.findByFileId(fileId);
    if (!transcription || transcription.status !== 'completed') {
      throw new ConflictException('Transcription is not completed yet');
    }
    return { text: transcription.text ?? '' };
  }

  /**
   * Повторно генерирует инсайты для файла с уже готовой транскрипцией
   * (например, после статуса failed). Текст берётся из готовой транскрипции —
   * повторно Whisper не запускается.
   */
  async regenerateInsights(meetingId: string, fileId: string): Promise<{ status: 'queued' }> {
    await this.filesService.findForMeeting(meetingId, fileId);
    const transcription = await this.transcriptionRepository.findByFileId(fileId);
    if (!transcription || transcription.status !== 'completed') {
      throw new ConflictException('Transcription is not completed yet');
    }
    await this.insightsGeneratorService.generate(fileId, meetingId, transcription.text ?? '');
    return { status: 'queued' };
  }

  /** Сбрасывает очередь и метаданные транскрибаций и инсайтов (используется e2e-тестами). */
  async clear(): Promise<void> {
    this.generation += 1;
    this.queueTail = Promise.resolve();
    await this.transcriptionRepository.clear();
    await this.insightsGeneratorService.clear();
  }

  private async processJob(fileId: string, filePath: string, generation: number): Promise<void> {
    if (generation !== this.generation) {
      return;
    }
    const transcription = await this.transcriptionRepository.findByFileId(fileId);
    if (!transcription) {
      return;
    }

    transcription.status = 'processing';
    transcription.error = undefined;
    await this.transcriptionRepository.save(transcription);

    try {
      const text = await this.speechTranscriber.transcribe(filePath);
      if (generation !== this.generation) {
        return;
      }
      transcription.status = 'completed';
      transcription.text = text;
      await this.transcriptionRepository.save(transcription);
      this.logger.log(`Transcription of file ${fileId} completed`);

      // Запускаем генерацию инсайтов без ожидания (не блокируем очередь транскрибации)
      this.insightsGeneratorService
        .generate(fileId, transcription.meetingId, text)
        .catch((error: unknown) => {
          this.logger.error(`Insights generation for file ${fileId} crashed: ${String(error)}`);
        });
    } catch (error) {
      if (generation !== this.generation) {
        return;
      }
      transcription.status = 'failed';
      transcription.error = this.describeTranscriptionError(error);
      await this.transcriptionRepository.save(transcription);
      this.logger.error(`Transcription of file ${fileId} failed: ${transcription.error}`);
    }
  }

  private describeTranscriptionError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.length > 500 ? `${message.slice(0, 500)}…` : message;
  }
}
