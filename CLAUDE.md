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

## Git-хуки

Настроен Husky: при коммите запускается `pre-commit` — `lint-staged` (линт и формат только staged-файлов) и `npm test`. Хуки ставятся автоматически через скрипт `prepare` при `npm install`.

## Окружение

- При портировании: **не PNPM** — только npm workspaces. Если тот параметр выносится на обсуждение, выбор всегда — NPM-монорепозиторий.
- Node >= 18.18, npm 10.

## Структура

```
apps/
  web/   # Next.js — см. apps/web/CLAUDE.md
  api/   # NestJS — см. apps/api/CLAUDE.md
eslint.config.mjs   # единый flat-конфиг ESLint
.prettierrc         # единый Prettier (+ prettier-plugin-tailwindcss)
```

Каждое приложение имеет собственный `CLAUDE.md` с деталями своей архитектуры.

## Соглашения

- Пакеты именуются префиксом `@video-meetings/*`.
- Добавление зависимости для конкретного приложения: `npm i <pkg> -w @video-meetings/<name>` (или `--workspace`).
- Линт и формат настроены на корне и применяются ко всем воркспейсам; сгенерированные файлы (`next-env.d.ts`) добавлены в ignore ESLint.
- При изменении архитектуры проекта обновляй `CLAUDE.md` на корне и в затронутых приложениях (`apps/*/CLAUDE.md`), чтобы будущие сессии Claude Code работали с актуальным контекстом.
- **Визуальное тестирование UI**: при любом изменении UI нужно обязательно протестировать изменение визуально через Playwright MCP (инструменты `browser_*` для навигации, снимков и взаимодействия с элементами).
