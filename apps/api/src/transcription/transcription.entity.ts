/** Статусы транскрибации файла встречи. */
export type TranscriptionStatus = 'queued' | 'processing' | 'completed' | 'failed';

export class Transcription {
  constructor(
    public readonly fileId: string,
    public readonly meetingId: string,
    public status: TranscriptionStatus,
    public readonly createdAt: Date,
    public error?: string,
    public text?: string,
  ) {}
}
