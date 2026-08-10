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
- `src/main.ts` — `bootstrap()`: сначала `loadEnvConfig()` (поднимает корневой `.env` монорепо в `process.env`), затем читает порт, вызывает `createApp()`, `app.listen()`. Только точка входа.
- `src/env.ts` — `loadEnvConfig()`: идемпотентно загружает корневой `.env` через `dotenv` (путь считается от `__dirname`, одинаково работает в `src/` и `dist/`). Вызывается в `main.ts`; Node-тест реального вызова тоже вызывает её.
- `src/app.module.ts` — корневой модуль.
- `src/app.controller.ts` — контроллер `@Controller()` с эндпоинтом `GET /`.
- `src/app.service.ts` — сервис, возвращает `{ status: 'ok', uptime }`.

## Модули

- `src/auth/` — регистрация/логин через CQRS (`CommandBus`), JWT (`@nestjs/jwt`). С модулем `Users` взаимодействует только через CQRS: хендлеры `RegisterCommand`/`LoginCommand` инжектят `QueryBus`/`CommandBus` и выполняют `FindUserByEmailQuery` и `CreateUserCommand` (без прямого доступа к `UsersRepository`). Плюс `jwt-auth.guard.ts`: `JwtAuthGuard` (CanActivate) — валидирует Bearer-токен через `JwtService`, кладёт `userId` в request; на него опирается `@UseGuards(JwtAuthGuard)` в защищённых контроллерах.
- `src/users/` — модуль пользователей с CQRS-фасадом для межмодульного взаимодействия:
  - `commands/create-user.command.ts` + handler — создание пользователя;
  - `queries/find-user-by-email.query.ts` + handler — поиск по e-mail;
  - `queries/find-user-by-id.query.ts` + handler — поиск по id (используется модулем `profile`);
  - `users.repository.ts` — in-memory (Map по e-mail + счётчик id), сущность `User`; e2e чистит через `clear()`.
  - Хендлеры регистрируются в общем `CommandBus`/`QueryBus` (модуль импортирует `CqrsModule`), поэтому Auth выполняет команды/запросы Users без прямой зависимости от репозитория.
- `src/meetings/` — базовый CRUD без бизнес-логики:
  - `MeetingsController` — `POST /meetings`, `GET /meetings`, `GET /meetings/:id` (404 при ненайденной встрече), весь контроллер под `@UseGuards(JwtAuthGuard)` → без токена 401.
  - `meetings.repository.ts` — in-memory (по образцу UsersRepository), `create`, `findAll`, `findById`, `updateSummary`, `clear()`;
  - `meeting.entity.ts` — сущность `Meeting` (id, name, description, createdAt, summary?); `dto/create-meeting.dto.ts` — валидация через class-validator (`name` обязателен, `description` опционален).
  - `MeetingsModule` регистрирует свой `JwtModule` с тем же секретом (`process.env.JWT_SECRET ?? 'default-secret-key'`).
- `src/files/` — файлы встречи (загрузка, список, скачивание):
  - `FilesController` — `POST /meetings/:id/files` (multipart-поле `file`), `GET /meetings/:id/files` (список метаданных), `GET /meetings/:id/files/:fileId/download` (скачивание через `StreamableFile` с заголовком `Content-Disposition`). Весь контроллер под `@UseGuards(JwtAuthGuard)` → без токена 401.
  - `FilesService` — проверяет существование встречи (404), лимит **20 МБ** (413), «санирует» имя файла (берёт только имя без путей) и пишет файл на диск в `apps/api/uploads/<meetingId>/<storedName>`. `list()` возвращает метаданные встречи; `download()` читает файл с диска и даёт 404, если файл не найден, принадлежит другой встрече или отсутствует на диске (осиротел).
  - `files.repository.ts` — `findById`, `findByMeetingId` (в порядке загрузки, Map сохраняет порядок), `create`, `clear()`.
  - `meeting-file.entity.ts` — `MeetingFile` (id, meetingId, originalName, storedName, size, mimeType, uploadedAt).
  - `files.constants.ts` — `MAX_FILE_SIZE` и `getUploadsDir()` (путь зависит от `__dirname`, корректно и в `src/`, и в `dist/`).
  - Уникальные имена на диске: `storedName = <uuid>-<originalName>` — файлы с одинаковым именем не перезаписывают друг друга.
  - `FilesModule` импортирует `MeetingsModule` (для проверки существования встречи).

  **Поведение после перезапуска:** метаданные форм хранятся in-memory и сбрасываются вместе с репозиториями (как у встреч); файлы, ранее записанные на диск, остаются, но при перезапуске игнорируются как «осиротевшие» — API их не знает. Очистка диска при перезапуске не выполняется намеренно.

- `src/transcription/` — транскрибация файлов встречи (MP4/MP3) локальным Whisper:
  - `TranscriptionController` — под `@UseGuards(JwtAuthGuard)` (без токена 401). Эндпоинты:
    - `POST /meetings/:id/files/:fileId/transcribe` — постановка файла в очередь → 201 `{ status: 'queued' }`; 404, если встреча/файл не существуют или файл принадлежит другой встрече; 400 для не-MP4/MP3; 409 при повторном запуске завершённого файла или повторной постановке файла, уже стоящего в очереди/обрабатываемого. После статуса `failed` повторный запуск разрешён.
    - `GET /meetings/:id/files/:fileId/transcription/status` → 200 `{ status: 'none'|'queued'|'processing'|'completed'|'failed', error? }` (`none` — файл ещё не транскрибировался).
    - `GET /meetings/:id/files/:fileId/transcription` → 200 `{ text }` при `completed`; 409 с понятным сообщением до завершения.
  - `TranscriptionService` — очередь с последовательной обработкой: promise-цепочка (`queueTail`) гарантирует, что одновременно транскрибируется ровно один файл; статусы проходят `queued → processing → completed`/`failed`. При сбое Whisper — `failed` с сообщением в `error`, файл можно поставить заново. Существование встречи/файла проверяется через `FilesService.findForMeeting` (логика не дублируется). `clear()` сбрасывает очередь и метаданные (используется e2e).
  - `SpeechTranscriber` — интерфейс `transcribe(inputPath): Promise<string>` с DI-токеном `SPEECH_TRANSCRIBER`; реальная реализация `WhisperTranscriber` — обёртка над CLI Whisper через `child_process` (`execFile`). Способ интеграции: по умолчанию команда `whisper` (openai-whisper CLI), аргументы настроены под неё (`--output_format txt`, `--fp16 False`); команда переопределяется через env `WHISPER_COMMAND` (например, `main` от whisper.cpp). Модель задаётся через env `WHISPER_MODEL` (default `base`, лёгкие base/low) и загружается **лениво при первом транскрибировании** (CLI сам скачивает/кеширует модель), а не в `onModuleInit` — поэтому e2e с замоканным транскрибатором модель не тянут. Таймаут выполнения задаётся через env `WHISPER_TIMEOUT_MS` (default 30 минут) — зависший CLI-процесс убивается и не блокирует очередь навсегда.
  - `TranscriptionRepository` — in-memory (Map по `fileId`, одна транскрибация на файл), `create`, `findByFileId`, `save`, `clear()`; сущность `Transcription` (fileId, meetingId, status, error, text, createdAt).
  - Ограничение форматов: транскрибируются только **MP3/MP4** — файл принимается, если подходит расширение ИЛИ MIME-тип (`SUPPORTED_TRANSCRIPTION_EXTENSIONS`/`SUPPORTED_TRANSCRIPTION_MIME_TYPES` в `transcription.constants.ts`); остальные форматы отклоняются 400.
  - `TranscriptionModule` импортирует `FilesModule` (переиспользует `FilesService`) и регистрирует свой `JwtModule` с тем же секретом.

  **Поведение после перезапуска:** метаданные транскрибации (статусы, текст, ошибки) хранятся in-memory и сбрасываются при перезапуске; файл на диске остаётся, кнопка «Транскрибировать» снова доступна (как у Files). Очистка диска при перезапуске не выполняется.

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

- `src/claude/` — интеграционный слой с Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) без HTTP-контроллеров:
  - `ClaudeAgentService` — `run(prompt, { systemPrompt?, maxTurns?, mcpServers? }): Promise<string>`: спавнит CLI Claude Code (платформенный бинарь из optionalDependencies SDK) и возвращает текст ответа через локальный гейтвей. Аутентификация — `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` из корневого `.env` (пробрасываются в окружение CLI через `options.env`); режим разрешений headless — `CLAUDE_PERMISSION_MODE` (default `bypassPermissions`); модель — `CLAUDE_MODEL` (default — дефолт CLI); таймаут — `CLAUDE_TIMEOUT_MS` (default 120 с) через `AbortController`. Опция `mcpServers` (тип `Record<string, McpServerConfig>`) пробрасывается в `query({ mcpServers })` — модель получает доступ к переданным MCP-инструментам.
  - `claude.constants.ts` — конфиг-геттеры по образцу `transcription.constants.ts`.
  - **ESM-зависимость:** SDK — ESM-only, поэтому CommonJS-сборка Nest требует **Node ≥ 22.12** (`require(esm)`). Jest (CJS) SDK не загружает: логика сервиса покрыта тестом с замоканным SDK (`claude.e2e-spec.ts`), реальный вызов — отдельным Node-тестом `test:claude` (`node --test`, собирает API и прогоняет `test/claude.real.test.mjs`; пропускается без кредов в `.env`).
  - `ClaudeModule` экспортирует `ClaudeAgentService` для других модулей; зарегистрирован в `AppModule`.

- `src/insights/` — генерация инсайтов встречи (summary, задачи, решения) через Claude Agent SDK после завершения транскрибации:
  - `InsightsController` — под `@UseGuards(JwtAuthGuard)` (без токена 401). Эндпоинты:
    - `GET /meetings/:id/files/:fileId/insights/status` → 200 `{ status: 'none'|'queued'|'processing'|'completed'|'failed', error? }`;
    - `GET /meetings/:id/files/:fileId/insights` → 200 `{ summary, actionItems, decisions }` при `completed`; 409 с понятным сообщением до завершения.
  - `InsightsGeneratorService` — очередь с последовательной генерацией (promise-цепочка `queueTail`, как у транскрибации): статусы `queued → processing → completed/failed`. Существование файла/встречи проверяется через `FilesService.findForMeeting`. Генерация агентная: systemPrompt + `maxTurns: 20` направляют агента итеративно вызывать MCP-инструменты встречи (см. `src/mcp/`) — для каждого action item `findTask` → при совпадении `updateTask` по `taskId`, иначе создание новой задачи (source `insights`); итоговый summary пишется во встречу через `updateMeeting`. Финальный JSON-ответ `{ summary, decisions }` разбирается (`parseResult`) и сохраняется в блоб инсайтов.
  - **Защита от prompt injection:** MCP-сервер для каждой генерации создаётся фабрикой `MEETING_MCP_SERVER_FACTORY`, скопированный под встречу генерации (`meetingId` убран из схем инструментов). `meetingId` в userPrompt не попадает, модель его не задаёт — поэтому текст транскрипции (untrusted-контент) не может переключить агента на чужую встречу. Дополнительно в systemPrompt указано игнорировать инструкции из транскрипта, пытающиеся менять встречу/инструменты/формат ответа.
  - **Action items вынесены в самостоятельные записи `Task`** (`src/tasks/`): на успехе генерации их создаёт сам агент через `updateTask` (source `insights`), сервис задачи напрямую не создаёт, блоб `MeetingInsights.actionItems` не заполняется. При старте генерации старые задачи встречи удаляются (`TasksService.removeInsightsTasks`) — перегенерация заменяет их новыми. В `onApplicationBootstrap()` выполняется идемпотентная миграция: legacy action items из поля `actionItems` переносятся в записи Task, после чего блоб очищается.
  - Ответ `GET .../insights`: поле `actionItems` — проекция из записей Task встречи (`{ text: task.title, assignee }`), а не из блоба, — для обратной совместимости с текущим фронтендом.
  - `insights.repository.ts` — in-memory (Map по `fileId`, одна запись на файл), `create`, `findByFileId`, `findAll`, `save`, `clear()`; сущность `MeetingInsights` (fileId, meetingId, status, summary, actionItems, decisions, error, createdAt).
  - `InsightsModule` импортирует `FilesModule`, `ClaudeModule`, `TasksModule`, `McpModule` (фабрика MCP-серверов) и регистрирует свой `JwtModule` с тем же секретом.

  **Поведение после перезапуска:** инсайты и задачи хранятся in-memory и сбрасываются вместе с репозиториями; файлы на диске остаются.

- `src/tasks/` — самостоятельные задачи встречи (выделены из action items инсайтов):
  - `TasksController` — под `@UseGuards(JwtAuthGuard)` (без токена 401). Эндпоинты:
    - `GET /meetings/:id/tasks` — список задач встречи (в порядке создания); 404 при ненайденной встрече;
    - `PATCH /meetings/:id/tasks/:taskId` — смена статуса `{ status: 'open' | 'completed' }` (валидация через class-validator, `@IsIn`); 404 при ненайденной задаче или задаче другой встречи.
  - `TasksService` — поиск и обновление задач: `listForMeeting`, `updateStatus` (принадлежность по `meetingId`, иначе 404); служебные `removeInsightsTasks` (очистка перед перегенерацией) и `createInsightsTasks` (миграция legacy action items из блоба). Существование встречи проверяется через `MeetingsRepository` (404).
  - `tasks.repository.ts` — in-memory (Map по id, агрегация по `meetingId`), `create`, `findAllByMeeting`, `findById`, `updateStatus`, `updateTask`, `removeAllForMeetingBySource`, `clear()`.
  - `task.entity.ts` — `Task` (id, meetingId, title, source, status, createdAt, assignee?) + типы `TaskStatus = 'open' | 'completed'`, `TaskSource = 'insights' | 'manual'`. `title`/`assignee`/`status` мутабельны — обновляются MCP-инструментом `updateTask` и `TasksRepository.updateTask`.
  - `TasksModule` импортирует `MeetingsModule` (проверка существования встречи) и регистрирует свой `JwtModule` с тем же секретом; экспортирует `TasksService`.

  **Поведение после перезапуска:** задачи хранятся in-memory и сбрасываются вместе с репозиториями.

- `src/mcp/` — переиспользуемые MCP-инструменты встречи поверх Task/Meeting (готовы к выносу в отдельный MCP-сервер):
  - `meeting-tool.ts` — три инструмента через `tool()` из Claude Agent SDK: `findTaskTool` (поиск задач встречи по `meetingId` + фильтры `status`/`assignee`/`taskId`), `updateTaskTool` (без `taskId` — создание задачи, source по умолчанию `manual`, агент инсайтов передаёт `insights`; с `taskId` — обновление `title`/`assignee`/`status`), `updateMeetingTool` (запись `Meeting.summary`). Каждый инструмент принимает `scopedMeetingId`: когда он задан, `meetingId` убирается из схемы (`.omit({ meetingId: true })`), и хендлер работает только с этой встречей — модель не может её подменить (защита от prompt injection); без scopedMeetingId `meetingId` передаёт модель (только доверенный контекст). Каждый — функция, возвращающая определение `tool()`: схемы — `zod/v4`, в `tool()` передаётся `.shape` схемы (тип `AnyZodRawShape`), в хендлере аргументы парсятся полной схемой. Хендлер возвращает `CallToolResult` (`{ content: [{ type: 'text', text: JSON }] }`); ошибки (ненайденная встреча/задача, невалидные аргументы) — `isError: true`, а не HTTP-исключения.
  - `createMeetingMcpServer(deps, options?)` — собирает MCP-сервер `name: 'meeting'` через `createSdkMcpServer` с набором инструментов; опция `options.meetingId` скопирует сервер под конкретную встречу. Конфиг пригоден для `query({ mcpServers: { meeting: server } })` и переиспользуется вне NestJS (инструменты зависят только от репозиториев).
  - `mcp.module.ts` — провайдер `MEETING_MCP_SERVER_FACTORY` (тип `MeetingMcpServerFactory`): useFactory инжектит `TasksRepository`/`MeetingsRepository` и возвращает `(meetingId) => createMeetingMcpServer(deps, { meetingId })`. `InsightsModule` инжектит фабрику и передаёт скопированный сервер в `ClaudeAgentService.run({ mcpServers: { meeting: server } })` — при генерации инсайтов агент итеративно вызывает инструменты встречи (findTask/updateTask/updateMeeting), будучи привязан к одной встрече.

  **ESM-зависимость:** `meeting-tool.ts` импортирует ESM-only SDK (`tool`, `createSdkMcpServer`) — работает через `require(esm)` на Node ≥ 22.12, как и `ClaudeAgentService`. В jest SDK мокается pass-through'ом (`tool`/`createSdkMcpServer` возвращают определения, чтобы тестировать хендлеры напрямую).

При добавлении нового модуля/контроллера держать инъекцию через стандартный NestDI (`constructor(private readonly service: XService)`), фичи объявлять в `AppModule`/или в подмодуле. Защищённые эндпоинты — через `JwtAuthGuard`.

## Сборка

Nest компилирует TypeScript (`commonjs`, декораторы) через `nest-cli.json` (`sourceRoot: src`, `deleteOutDir: true`). Типы/outDir — в `tsconfig.json`; `tsconfig.build.json` исключает `test` и `*.spec.ts`.

## Правила кода (CLAUDE.md)

При написании/рефакторинге кода API соблюдать следующие правила. При противоречиях с текущим кодом — правила CLAUDE.md важнее, старый код приводится в соответствие.

- **Строгая типизация параметров и возвращаемых значений**: каждый параметр метода сервиса/хендлера имеет явный TypeScript-тип; возвращаемый тип указывается через `Promise<...>` (даже если `async` уже подразумевает Promise).
- **Логгер вместо `console.log`**: использовать инжектированный `Logger` (`@nestjs/common`), методы `log`, `warn`, `error`, `debug`. Прямые `console.*` запрещены.
- **`NotFoundException` при отсутствии сущности**: если запрашиваемая запись не найдена (в репозитории/БД) — бросать `NotFoundException` (`@nestjs/common`), а не возвращать `null`/`undefined` или 404 вручную.
- **Смысловые имена переменных**: никаких `data`, `res`, `item`, `temp` — имя отражает доменную сущность (`meeting`, `userProfile`, `uploadedFile`, `avatarBuffer` и т.п.).
- **Перед изменением кода — перечитать этот CLAUDE.md**.

## Полезные команды

Из корня монорепо:

- `npm run dev:api` — dev с watch-режимом (порт 3001)
- `npm run build:api` — сборка в `dist/`
- `npm test` (алиас `npm run test:e2e`) — e2e-тесты (супертест, in-memory репозитории, БД не нужна)
- `npm run test:claude --workspace @video-meetings/api` — реальный вызов Claude через `.env` (Node `node --test`; предварительно собирает API; пропускается без кредов)
- Запуск собранного билда: `npm start --workspace @video-meetings/api` (или `node apps/api/dist/main`)
