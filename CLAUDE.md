# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Обзор

NPM-монорепозиторий (npm workspaces) платформы видеоконференций. Два приложения:

- `apps/web` — фронтенд на Next.js (App Router), пакет `@video-meetings/web`
- `apps/api` — бэкенд на NestJS, пакет `@video-meetings/api`

Общие зависимости (ESLint, Prettier, TypeScript, typescript-eslint) бинтятся на корень. Линтинг и форматирование единые для всего монорепо.

## Команды

Все команды запускаются из корня:

- `npm install` — установить зависимости всех воркспейсов (поднимаются в корневой `node_modules`)
- `npm run dev` / `npm run build` — запустить/собрать все приложения
- `npm run dev:web` / `dev:api` — dev-сервер отдельного приложения
- `npm run build:web` / `build:api` — сборка отдельного приложения
- `npm run lint` / `lint:fix` — ESLint всего монорепо (flat config)
- `npm run format` / `format:check` — Prettier (`--write .` / проверка)
- `npm test` — запустить тесты всех воркспейсов (сейчас e2e-набор API)
- `npm run clean` — удалить `node_modules`, `.next`, `dist`

## Экономия токенов

В сессиях Claude Code экономим токены при выводе результатов команд:

- **Тесты** (`npm test`): если нужно лишь подтвердить отсутствие ошибок — запускать с `--silent`; по возможности фильтровать по паттерну, а не гонять весь набор. `npm test --silent` глушит только вывод npm; чтобы пробросить `--silent` в jest (консольный лог внутри тестов) — `npm test -- --silent`.
- **`git diff`**: использовать `--unified=<N>` (например, `--unified=1`) — меньше строк контекста, компактнее вывод.
- **`git log`**: по умолчанию `--oneline -10`; подробный формат — только когда детали нужны.
- **`tsc --noEmit`**: анализировать только «хвост» вывода (ошибки в конце), а не весь результат.

## Git-хуки

Настроен Husky: при коммите запускается `pre-commit` — `lint-staged` (линт и формат только staged-файлов) и `npm test`. Хуки ставятся автоматически через скрипт `prepare` при `npm install`.

## Окружение

- При портировании: **не PNPM** — только npm workspaces. Если тот параметр выносится на обсуждение, выбор всегда — NPM-монорепозиторий.
- Node >= 18.18, npm 10.

## Документация

- [PRD: загрузка файлов встречи](./docs/meeting-file-upload.md) · [План](./docs/meeting-file-upload-plan.md) · [Ресерч реализации](./docs/research-meeting-file-upload.md)
- [PRD: профиль пользователя](./docs/user-profile.md) · [План](./docs/user-profile-plan.md) · [Ресерч реализации](./docs/research-user-profile.md)

## Соглашения

- Пакеты именуются префиксом `@video-meetings/*`.
- Добавление зависимости для конкретного приложения: `npm i <pkg> -w @video-meetings/<name>` (или `--workspace`).
- Линт и формат настроены на корне и применяются ко всем воркспейсам; сгенерированные файлы (`next-env.d.ts`) добавлены в ignore ESLint.
- При изменении архитектуры проекта обновляй `CLAUDE.md` на корне и в затронутых приложениях (`apps/*/CLAUDE.md`), чтобы будущие сессии Claude Code работали с актуальным контекстом.
- **Визуальное тестирование UI**: при любом изменении UI нужно обязательно протестировать изменение визуально через Playwright MCP (инструменты `browser_*` для навигации, снимков и взаимодействия с элементами).
