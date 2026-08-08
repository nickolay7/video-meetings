import * as path from 'path';
import { MeetingFile } from '../files/meeting-file.entity';

/** MIME-типы, разрешённые для транскрибации (MP3/MP4). */
export const SUPPORTED_TRANSCRIPTION_MIME_TYPES = [
  'audio/mpeg',
  'audio/mp3',
  'video/mp4',
  'audio/mp4',
];

/** Расширения, разрешённые для транскрибации. */
export const SUPPORTED_TRANSCRIPTION_EXTENSIONS = ['.mp3', '.mp4'];

/**
 * Модель Whisper (лёгкая base/low): задаётся через env `WHISPER_MODEL`, default — `base`.
 */
export function getWhisperModel(): string {
  return process.env.WHISPER_MODEL ?? 'base';
}

/**
 * Команда локального Whisper-CLI: по умолчанию `whisper` (openai-whisper),
 * переопределяется через env `WHISPER_COMMAND` (например, для whisper.cpp `main`).
 */
export function getWhisperCommand(): string {
  return process.env.WHISPER_COMMAND ?? 'whisper';
}

/** Таймаут выполнения команды Whisper по умолчанию (мс): защита от зависшего процесса. */
export const DEFAULT_WHISPER_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Таймаут выполнения команды Whisper (мс): задаётся через env `WHISPER_TIMEOUT_MS`,
 * default — `DEFAULT_WHISPER_TIMEOUT_MS`. Не даёт зависшему CLI-процессу навсегда
 * заблокировать очередь транскрибаций (promise-цепочка `queueTail`).
 */
export function getWhisperTimeoutMs(): number {
  const raw = process.env.WHISPER_TIMEOUT_MS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WHISPER_TIMEOUT_MS;
}

/**
 * Формат разрешён для транскрибации, если подходит расширение ИЛИ MIME-тип файла:
 * оба способа определения работают вместе, чтобы не отказывать файлам, у которых
 * браузер указал нестандартный MIME при корректном расширении (и наоборот).
 */
export function isSupportedTranscriptionFormat(file: MeetingFile): boolean {
  const extension = path.extname(file.originalName).toLowerCase();
  return (
    SUPPORTED_TRANSCRIPTION_EXTENSIONS.includes(extension) ||
    SUPPORTED_TRANSCRIPTION_MIME_TYPES.includes(file.mimeType)
  );
}
