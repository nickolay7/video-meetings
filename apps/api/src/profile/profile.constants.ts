import * as path from 'path';
import { getUploadsDir } from '../files/files.constants';

/** Максимальный размер аватара — 5 МБ. */
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024;

/**
 * Фиксированное контролируемое имя файла аватара внутри каталога пользователя.
 * Не зависит от пользовательского имени; повторная загрузка перезаписывает прежний файл.
 */
export const AVATAR_STORED_NAME = 'avatar';

/** Каталог аватаров: apps/api/uploads/avatars/<userId>/<AVATAR_STORED_NAME>. */
export function getAvatarsDir(): string {
  return path.join(getUploadsDir(), 'avatars');
}
