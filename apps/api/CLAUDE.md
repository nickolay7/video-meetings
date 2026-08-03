# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Обзор

Бэкенд-приложение на NestJS 10 — пакет `@video-meetings/api`. Входит в npm-монорепозиторий, команды запускаются из его корня.

## Стек

- NestJS 10, TypeScript, `@nestjs/platform-express`
- CORS включён для всех источников; порт по умолчанию — **3001** (`process.env.PORT ?? 3001`)

## Архитектура и точка входа

Разделена фабрика приложения и bootstrap для гибкости тестов:

- `src/app.factory.ts` — `createApp()`: создаёт `INestApplication`, применяет CORS. Логика сборки приложения здесь; переиспользуется main и (в будущем) e2e-тесты.
- `src/main.ts` — `bootstrap()`: читает порт, вызывает `createApp()`, `app.listen()`. Только точка входа.
- `src/app.module.ts` — корневой модуль.
- `src/app.controller.ts` — контроллер `@Controller()` с эндпоинтом `GET /`.
- `src/app.service.ts` — сервис, возвращает `{ status: 'ok', uptime }`.

## Модули

- `src/auth/` — регистрация/логин через CQRS (`CommandBus`), JWT (`@nestjs/jwt`). Плюс `jwt-auth.guard.ts`: `JwtAuthGuard` (CanActivate) — валидирует Bearer-токен через `JwtService`, кладёт `userId` в request; на него опирается `@UseGuards(JwtAuthGuard)` в защищённых контроллерах.
- `src/users/` — in-memory репозиторий `UsersRepository` (Map + счётчик id), сущность `User`. Используется auth; e2e чистит через `clear()`.
- `src/meetings/` — базовый CRUD без бизнес-логики:
  - `MeetingsController` — `POST /meetings`, `GET /meetings`, `GET /meetings/:id` (404 при ненайденной встрече), весь контроллер под `@UseGuards(JwtAuthGuard)` → без токена 401.
  - `meetings.repository.ts` — in-memory (по образцу UsersRepository), `clear()`;
  - `meeting.entity.ts`, `dto/create-meeting.dto.ts` — валидация через class-validator (`name` обязателен, `description` опционален).
  - `MeetingsModule` регистрирует свой `JwtModule` с тем же секретом (`process.env.JWT_SECRET ?? 'default-secret-key'`).

При добавлении нового модуля/контроллера держать инъекцию через стандартный NestDI (`constructor(private readonly service: XService)`), фичи объявлять в `AppModule`/или в подмодуле. Защищённые эндпоинты — через `JwtAuthGuard`.

## Сборка

Nest компилирует TypeScript (`commonjs`, декораторы) через `nest-cli.json` (`sourceRoot: src`, `deleteOutDir: true`). Типы/outDir — в `tsconfig.json`; `tsconfig.build.json` исключает `test` и `*.spec.ts`.

## Полезные команды

Из корня монорепо:

- `npm run dev:api` — dev с watch-режимом (порт 3001)
- `npm run build:api` — сборка в `dist/`
- Запуск собранного билда: `npm start --workspace @video-meetings/api` (или `node apps/api/dist/main`)
