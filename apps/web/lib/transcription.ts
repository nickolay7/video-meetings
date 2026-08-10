/** Статусы транскрибации файла встречи (совпадают со статусами backend). */
export type TranscriptionStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** Ответ GET .../transcription/status: `none` — файл ещё не транскрибировался. */
export type TranscriptionStatusResponse = {
  status: 'none' | TranscriptionStatus;
  error?: string;
};

/** Информация о транскрибации файла в интерфейсе (без статуса `none`). */
export interface TranscriptionInfo {
  status: TranscriptionStatus;
  error?: string;
}

/** MIME-типы, разрешённые для транскрибации (MP3/MP4) — как в backend. */
const SUPPORTED_TRANSCRIPTION_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'video/mp4', 'audio/mp4'];

/** Расширения, разрешённые для транскрибации. */
const SUPPORTED_TRANSCRIPTION_EXTENSIONS = ['.mp3', '.mp4'];

/**
 * Файл транскрибируется, если подходит расширение ИЛИ MIME-тип — как в backend
 * (`isSupportedTranscriptionFormat`), чтобы не отказывать файлам с нестандартным MIME.
 */
export function isTranscribableFile(file: { originalName: string; mimeType: string }): boolean {
  const dotIndex = file.originalName.lastIndexOf('.');
  const extension = dotIndex >= 0 ? file.originalName.slice(dotIndex).toLowerCase() : '';
  return (
    SUPPORTED_TRANSCRIPTION_EXTENSIONS.includes(extension) ||
    SUPPORTED_TRANSCRIPTION_MIME_TYPES.includes(file.mimeType)
  );
}

/** Статусы генерации инсайтов (совпадают со статусами backend). */
export type InsightsStatus = 'queued' | 'processing' | 'completed' | 'failed';

/** Ответ GET .../insights/status. */
export type InsightsStatusResponse = {
  status: 'none' | InsightsStatus;
  error?: string;
};

/** Данные инсайтов (GET .../insights). */
export interface InsightsData {
  summary: string;
  actionItems: { text: string; assignee?: string }[];
  decisions: { text: string }[];
}
