import { config as loadEnv } from 'dotenv';
import * as path from 'path';

let loaded = false;

/**
 * Поднимает корневой `.env` монорепо в `process.env` (идемпотентно).
 *
 * `dotenv` объявлен в зависимостях API, но нигде не загружается; Nest CLI не читает
 * `.env` сам. Корневой `.env` лежит на три уровня выше `src/` (и `dist/`), поэтому
 * путь считается от `__dirname` — одинаково работает и при ts-jest (тесты), и в
 * собранном билде. Вызов безопасен и при отсутствии файла (dotenv молча пропускает).
 */
export function loadEnvConfig(): void {
  if (loaded) return;
  loadEnv({ path: path.resolve(__dirname, '..', '..', '..', '.env') });
  loaded = true;
}
