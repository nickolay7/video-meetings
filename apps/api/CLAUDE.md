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

- `src/auth/` — регистрация/логин через CQRS (`CommandBus`), JWT (`@nestjs/jwt`). С модулем `Users` взаимодействует только через CQRS: хендлеры `RegisterCommand`/`LoginCommand` инжектят `QueryBus`/`CommandBus` и выполняют `FindUserByEmailQuery` и `CreateUserCommand` (без прямого доступа к `UsersRepository`). Плюс `jwt-auth.guard.ts`: `JwtAuthGuard` (CanActivate) — валидирует Bearer-токен через `JwtService`, кладёт `userId` в request; на него опирается `@UseGuards(JwtAuthGuard)` в защищённых контроллерах.
- `src/users/` — модуль пользователей с CQRS-фасадом для межмодульного взаимодействия:
  - `commands/create-user.command.ts` + handler — создание пользователя;
  - `queries/find-user-by-email.query.ts` + handler — поиск по e-mail;
  - `queries/find-user-by-id.query.ts` + handler — поиск по id (для будущего «профиля»);
  - `users.repository.ts` — in-memory (Map по e-mail + счётчик id), сущность `User`; e2e чистит через `clear()`.
  - Хендлеры регистрируются в общем `CommandBus`/`QueryBus` (модуль импортирует `CqrsModule`), поэтому Auth выполняет команды/запросы Users без прямой зависимости от репозитория.
- `src/meetings/` — базовый CRUD без бизнес-логики:
  - `MeetingsController` — `POST /meetings`, `GET /meetings`, `GET /meetings/:id` (404 при ненайденной встрече), весь контроллер под `@UseGuards(JwtAuthGuard)` → без токена 401.
  - `meetings.repository.ts` — in-memory (по образцу UsersRepository), `clear()`;
  - `meeting.entity.ts`, `dto/create-meeting.dto.ts` — валидация через class-validator (`name` обязателен, `description` опционален).
  - `MeetingsModule` регистрирует свой `JwtModule` с тем же секретом (`process.env.JWT_SECRET ?? 'default-secret-key'`).
- `src/files/` — файлы встречи (загрузка, список, скачивание):
  - `FilesController` — `POST /meetings/:id/files` (multipart-поле `file`), `GET /meetings/:id/files` (список метаданных), `GET /meetings/:id/files/:fileId/download` (скачивание через `StreamableFile` с заголовком `Content-Disposition`). Весь контроллер под `@UseGuards(JwtAuthGuard)` → без токена 401.
  - `FilesService` — проверяет существование встречи (404), лимит **20 МБ** (413), «санирует» имя файла (берёт только имя без путей) и пишет файл на диск в `apps/api/uploads/<meetingId>/<storedName>`. `list()` возвращает метаданные встречи; `download()` читает файл с диска и даёт 404, если файл не найден, принадлежит другой встрече или отсутствует на диске (осиротел).
  - `files.repository.ts` — `findById`, `findByMeetingId` (в порядке загрузки, Map сохраняет порядок), `create`, `clear()`.
  - `meeting-file.entity.ts` — `MeetingFile` (id, meetingId, originalName, storedName, size, mimeType, uploadedAt).
  - `files.repository.ts` — метаданные in-memory (по образцу MeetingsRepository), `clear()` для e2e.
  - `files.constants.ts` — `MAX_FILE_SIZE` и `getUploadsDir()` (путь зависит от `__dirname`, корректно и в `src/`, и в `dist/`).
  - Уникальные имена на диске: `storedName = <uuid>-<originalName>` — файлы с одинаковым именем не перезаписывают друг друга.
  - `FilesModule` импортирует `MeetingsModule` (для проверки существования встречи).

  **Поведение после перезапуска:** метаданные форм хранятся in-memory и сбрасываются вместе с репозиториями (как у встреч); файлы, ранее записанные на диск, остаются, но при перезапуске игнорируются как «осиротевшие» — API их не знает. Очистка диска при перезапуске не выполняется намеренно.

- `src/profile/` — профиль авторизованного пользователя:
  - `ProfileController` — под `@UseGuards(JwtAuthGuard)` (без токена 401, при отсутствии пользователя — 404). Эндпоинты:
    - `GET /profile` — возвращает `{ id, email, name }` текущего пользователя через `FindUserByIdQuery`;
    - `PATCH /profile` — обновляет имя через `UpdateUserNameCommand` (имя тримится, пустое/whitespace-only имя очищается);
    - `POST /profile/avatar` — multipart-поле `file` через `FileInterceptor` (memoryStorage, лимит 5 МБ → 413 автоматически). `ProfileService.saveAvatar` проверяет тип **по магическим байтам содержимого** (PNG/JPEG/GIF/WebP), а не по расширению/заголовку — не-изображение даёт 400; записывает файл на диск и выполняет `UpdateUserAvatarCommand`. Повторная загрузка перезаписывает прежний файл (фиксированное имя `avatar`);
    - `GET /profile/avatar` — отдаёт аватар через `StreamableFile` с сохранённым `Content-Type`; 404, если аватар не загружен, пользователь не найден или файл на диске отсутствует (осиротел);
    - `POST /profile/password` — смена пароля: `ChangePasswordDto` (`oldPassword`, `newPassword` ≥ 8 символов), старый проверяется через `bcrypt.compare` (неверный — 400 «Old password is incorrect»), новый хешируется (10 раундов) и сохраняется через `UpdateUserPasswordCommand`.
  - `ProfileService` — диск и валидация; с `Users` взаимодействует только через `QueryBus`/`CommandBus` (те же `FindUserByIdQuery`/`UpdateUser*Command`), без прямого доступа к репозиторию.
  - `profile.constants.ts` — `MAX_AVATAR_SIZE`, `AVATAR_STORED_NAME`, `getAvatarsDir()` (`uploads/avatars`; `getUploadsDir` из `files.constants`).
  - `profile.module.ts` — регистрирует свой `JwtModule` с тем же секретом; пароль из ответа исключается (маппинг в контроллере).

  **Поведение после перезапуска:** как и у встреч — пользователи (включая `avatarPath`/`avatarMimeType`) хранятся in-memory и сбрасываются при перезапуске; аватары на диске в `uploads/avatars/<userId>/avatar` остаются, но после перезапуска игнорируются как «осиротевшие». Очистка диска при перезапуске не выполняется намеренно.

При добавлении нового модуля/контроллера держать инъекцию через стандартный NestDI (`constructor(private readonly service: XService)`), фичи объявлять в `AppModule`/или в подмодуле. Защищённые эндпоинты — через `JwtAuthGuard`.

## Сборка

Nest компилирует TypeScript (`commonjs`, декораторы) через `nest-cli.json` (`sourceRoot: src`, `deleteOutDir: true`). Типы/outDir — в `tsconfig.json`; `tsconfig.build.json` исключает `test` и `*.spec.ts`.

## Полезные команды

Из корня монорепо:

- `npm run dev:api` — dev с watch-режимом (порт 3001)
- `npm run build:api` — сборка в `dist/`
- `npm test` (алиас `npm run test:e2e`) — e2e-тесты (супертест, in-memory репозитории, БД не нужна)
- Запуск собранного билда: `npm start --workspace @video-meetings/api` (или `node apps/api/dist/main`)
