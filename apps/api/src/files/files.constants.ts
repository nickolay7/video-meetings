import * as path from 'path';

/** Максимальный размер одного файла — 20 МБ. */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Базовая папка для хранения загруженных файлов.
 * Файл лежит в `src/files` (при запуске через ts-jest/dev) или `dist/files` (в продакшен-сборке),
 * а `uploads` должен быть общим — `apps/api/uploads`. Поэтому поднимаемся на два уровня вверх.
 */
export function getUploadsDir(): string {
  return path.resolve(__dirname, '..', '..', 'uploads');
}
