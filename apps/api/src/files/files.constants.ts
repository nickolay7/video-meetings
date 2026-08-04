import * as path from 'path';

/** Максимальный размер одного файла — 20 МБ. */
export const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Базовая папка для хранения загруженных файлов.
 * `__dirname` при компиляции (`dist/`) и при запуске тестов через ts-jest (`src/`)
 * — это `apps/api/src` / `apps/api/dist`, поэтому `..` ведёт в `apps/api`.
 */
export function getUploadsDir(): string {
  return path.resolve(__dirname, '..', 'uploads');
}
