# Ресерч: оптимальная техническая реализация профиля пользователя

**План:** [user-profile-plan.md](./user-profile-plan.md)
**PRD:** [user-profile.md](./user-profile.md)
**Дата:** 2026-08-05
**Статус:** исследование выбрано под локальный диск + in-memory метаданные (как в плане), с разделом про миграцию на облачное хранилище и БД.

---

## 1. Резюме и рекомендации (TL;DR)

Фича опирается на уже принятые в проекте паттерны (in-memory репозитории, CQRS-фасад Auth↔Users, `FileInterceptor` для multipart, HeroUI v3 на фронте). Отдельных пакетов почти не требуется. Рекомендации:

| Аспект                      | Рекомендация                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Расположение фичи           | Новый `ProfileModule` (контроллер + аватар), `UpdateUserCommand` в `UsersModule`, хендлер смены пароля — в `AuthModule` (там уже bcrypt + CQRS).                          |
| Поле `name`                 | Необязательное `string \| null` в сущности `User`; пустое → `null`; fallback на email делает фронт. Провести через регистрацию (DTO → Register → CreateUser).             |
| Получение/изменение профиля | `GET /profile` → `{ id, name, email, hasAvatar }`; `PATCH /profile` → изменение имени (пустое = `null`). `userId` берётся из JWT `sub`.                                   |
| Аватар — приём              | `FileInterceptor` (multer, memoryStorage) с `limits: { fileSize: 5 МБ }` → 413 автоматически. `fileFilter` режет не-изображения на ранней стадии.                         |
| Аватар — валидация типа     | **Сниффить magic-bytes** из `file.buffer`, разрешать только растр (PNG/JPEG/WebP/GIF). **Не доверять** `file.mimetype` и расширению. **SVG запрещён** (XSS-вектор).       |
| Аватар — хранение           | `uploads/avatars/<userId>/avatar.<ext>`. Один файл на пользователя, повторная загрузка заменяет (запись через temp + rename). Метаданные — in-memory `AvatarsRepository`. |
| Аватар — выдача             | `GET /profile/avatar`: `Content-Type` из метаданных, `Content-Disposition: inline`, `X-Content-Type-Options: nosniff`, `Cache-Control: no-cache`. 404, если нет.          |
| Смена пароля                | `POST /profile/password` `{ oldPassword, newPassword }`: bcrypt.compare старого, при неверном — **400, а НЕ 401** (иначе фронт разлогинивает пользователя).               |
| Аватар на фронте (`<img>`)  | **Gotcha:** `<img src>` не шлёт `Authorization` → 401. Только `fetch` + `blob` + `URL.createObjectURL` (паттерн уже есть в скачивании файлов встреч).                     |
| Регистрация на фронте       | Необязательное поле «Имя»; при пустом — регистрация без имени.                                                                                                            |
| Тесты                       | `profile.e2e-spec.ts` на supertest: реальный PNG-буфер для аватара, 400/413/401, вход новым паролем после смены.                                                          |
| Новые зависимости           | Только опционально: magic-bytes проверять вручную (пакет `file-type` последних версий ESM-only и конфликтует с CJS-сборкой Nest).                                         |

**Главные риски, которые стоит зафиксировать:**

1. **Смена пароля не должна давать 401.** Фронт в `FilesModal` и на главной обрабатывает 401 как «токен протух» → logout. Неверный старый пароль = `400 BadRequestException` с понятным сообщением.
2. **Аватар нельзя отдавать обычным `<img>`.** JWT живёт в `Authorization`-заголовке, `<img>` его не отправляет. Только fetch+blob. Это же ограничение уже разобрано для скачивания файлов встреч.
3. **SVG-аватар = stored XSS.** Разрешать только растровые форматы по содержимому, а не по `mimetype`/расширению.
4. **Метаданные сбрасываются при перезапуске, аватар на диске остаётся** (осиротевает). Поведение — как у файлов встреч: задокументировать, осиротевший файл игнорируется (404).
5. **При замене аватара формат может смениться** (PNG→JPEG → другой `avatar.<ext>`) → старый файл нужно удалять, иначе осиротевает на диске.

---

## 2. Сравнение вариантов размещения фичи в модулях

План разбивает работу на backend (имя/профиль, аватар, пароль) и frontend. Ключевой вопрос архитектуры — где живёт профиль, учитывая, что Auth взаимодействует с Users только через CQRS, а bcrypt находится в Auth-хендлерах.

### 2.1 Новый `ProfileModule` + `UpdateUserCommand` в Users + смена пароля в Auth (рекомендуется)

```
apps/api/src/
  users/
    commands/update-user.command.ts + handler   # обновление name/password
    users.repository.ts                          # + update(id, patch)
  auth/
    commands/handlers/change-password.handler.ts # bcrypt.compare/hash, вызывает UpdateUserCommand
  profile/
    profile.module.ts       # imports: CqrsModule, JwtModule (для guard)
    profile.controller.ts   # GET /profile, PATCH /profile, POST /profile/avatar, GET /profile/avatar
    avatars.service.ts      # валидация magic-bytes, запись/чтение с диска
    avatars.repository.ts   # in-memory Map<userId, { storedName, mimeType }>
    dto/update-name.dto.ts, change-password.dto.ts
```

- **UsersModule** остаётся единственным владельцем агрегата пользователя (создание → добавление обновления). Auth и Profile общаются с ним только через CQRS — паттерн уже принят.
- **Смена пароля** остаётся в auth-домене: там уже `bcrypt`, `JwtModule`, `QueryBus` (как в `LoginCommandHandler`). Хендлер: `FindUserByIdQuery` (sub из JWT) → `bcrypt.compare(old, user.password)` → `bcrypt.hash(new, 10)` → `UpdateUserCommand(id, { password })`.
- **ProfileController** — только чтение и правка своего профиля + файловые операции (аватар), не трогает хеширование паролей.

### 2.2 Всё в `UsersModule` (альтернатива, проще, но хуже по обязанностям)

Контроллер и хендлер смены пароля в Users. Минусы: в Users появляется bcrypt (дублирование логики auth), `UsersModule` перестаёт быть чистым CQRS-фасадом и начинает принимать HTTP. Для этого проекта, где Auth↔Users строго через CQRS, вариант 2.1 чище.

**Вывод:** 2.1. Новый модуль — маленький, профиль становится самостоятельной фичей, как `files`, и подключается в `AppModule` отдельной строкой.

---

## 3. Фаза 1 — Backend: поле `name`, `GET`/`PATCH /profile`

### 3.1 Поле `name` в сущности и репозитории

`User` сейчас: `id`, `email`, `password`. Добавляем необязательное `name: string | null`.

- Сущность: `constructor(id, email, password, name: string | null = null)`.
- Репозиторий: `create(email, hashedPassword, name?)`; новый метод:

```ts
async update(id: string, patch: { name?: string | null; password?: string }): Promise<User | undefined> {
  const user = await this.findById(id);
  if (!user) return undefined;
  if (patch.name !== undefined) user.name = patch.name ?? null;
  if (patch.password !== undefined) user.password = patch.password;
  return user;
}
```

Репозиторий мапит по email, но `findById` уже проходит по значениям — метод логично дополняет существующий. `name` нормализуем: `trim()`; пустая строка → `null` (fallback на email делает фронт).

### 3.2 Проведение `name` через регистрацию

Цепочка (все DTO/команды необязательные поля):

- `AuthDto` (auth): `@IsOptional() @IsString() @MaxLength(60) name?: string`.
- `RegisterCommand(email, password, name?)` → `CreateUserCommand(email, hashedPassword, name?)` → `usersRepository.create(email, hash, name)`.
- `RegisterCommandHandler` уже хеширует и подписывает токен; изменения минимальны — просто передать `name` дальше.

JWT-токен имя **не** содержит (`{ sub, email }`) — смена имени не требует перевыпуска токена и повторного входа.

### 3.3 `GET /profile`

```ts
@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  @Get()
  async getProfile(@Req() req: ProfileRequest): Promise<ProfileDto> {
    const user = await this.queryBus.execute(new FindUserByIdQuery(req.userId));
    if (!user) throw new NotFoundException('User not found');
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      hasAvatar: await this.avatarsRepository.has(req.userId), // в фазе 2; в фазе 1 — false/заглушка
    };
  }
}
```

- `req.userId` уже кладёт `JwtAuthGuard` (типизирован в `jwt-auth.guard.ts`). Для аккуратности — маленький декоратор `@CurrentUserId()` либо типизированный `@Req()`.
- Ответ — `ProfileDto { id, name, email, hasAvatar }`. `hasAvatar` вместо `avatarUrl`: сам файл всё равно тянем через fetch+blob (см. §6), так что флаг + отдельный эндпоинт проще, чем URL, который нельзя вставить в `<img>`.

### 3.4 `PATCH /profile` — изменение имени

`UpdateNameDto { @IsOptional() @IsString() @MaxLength(60) name?: string }`. Сервис: `user = FindUserByIdQuery`, нормализация (trim, пусто → null), `UpdateUserCommand(id, { name })`. Ответ — обновлённый профиль (или 200 без тела). Пустое имя = `name: null` — фронт показывает email.

**REST:** `PATCH` для частичного обновления имени; смена пароля отдельным `POST /profile/password` (не идемпотентное действие с побочным эффектом — не `PATCH` профиля).

---

## 4. Фаза 2 — Backend: аватар

### 4.1 Приём: FileInterceptor + лимиты + ранний фильтр

По образцу `FilesController`:

```ts
@Post('avatar')
@UseInterceptors(FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: AVATAR_MAX_SIZE },            // 5 МБ
  fileFilter: (_req, file, cb) => {
    if (!/^image\//.test(file.mimetype)) cb(new BadRequestException('Only images allowed'), false);
    else cb(null, true);
  },
}))
async uploadAvatar(@Req() req, @UploadedFile() file?: Express.Multer.File) { ... }
```

- `limits.fileSize` → multer кидает `LIMIT_FILE_SIZE`, NestJS транслирует в **413** `PayloadTooLargeException` (рабочее поведение подтверждено e2e файлов встреч — там уже тест на 413).
- `fileFilter` по `mimetype` — быстрый отсев не-изображений на этапе интерцептора (400). Но это **не источник истины**: `mimetype` берётся из запроса и легко подделывается. Авторитетная проверка — снифф в сервисе (§4.2).
- Отсутствие файла → `BadRequestException('File is required')`, как в Files.

### 4.2 Валидация типа по содержимому (magic-bytes)

PRD требует «валидацию по содержимому, не только по расширению». Разрешаем только растровые форматы:

```ts
// небольшой хелпер в avatars.service.ts, без новых зависимостей
const RASTER: Array<{ ext: string; mime: string; sig: (b: Buffer) => boolean }> = [
  {
    ext: 'png',
    mime: 'image/png',
    sig: (b) =>
      b.length > 8 &&
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    ext: 'jpg',
    mime: 'image/jpeg',
    sig: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    ext: 'gif',
    mime: 'image/gif',
    sig: (b) => b.length > 3 && b.subarray(0, 4).toString('ascii') === 'GIF8',
  },
  {
    ext: 'webp',
    mime: 'image/webp',
    sig: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

function sniffImage(buffer: Buffer): { ext: string; mime: string } | null {
  return RASTER.find(({ sig }) => sig(buffer)) ?? null;
}
```

- **Почему не `file-type`:** свежие версии пакета ESM-only, а NestJS собирается в CommonJS — конфликт модулей без отдельных усилий. Проверка 4 сигнатур — ~15 строк, тестируется отдельно.
- **SVG запрещён явно:** отсутствие в списке растра и есть запрет. SVG-файл с `<script>` — классический stored-XSS, если его отрендерить в `<img>`/inline.
- Если снифф вернул `null` → `BadRequestException('Only image files allowed')` (400).

### 4.3 Хранение и замена

```
uploads/avatars/<userId>/avatar.<ext>
```

- Детерминированное имя (`avatar.<ext>`) — один файл на пользователя, легко читается и чистится; `storedName` не зависит от пользовательского ввода (никаких путей из запроса — закрыт path traversal).
- Порядок замены (важно для консистентности):
  1. `sniffImage(file.buffer)` → `null` → 400.
  2. Запись нового файла **через temp + rename** (атомарно): `writeFile(path + '.tmp')` → `rename(tmp, final)` — пользователь никогда не увидит полузаписанный аватар.
  3. Удалить **предыдущий** `storedName` (может отличаться расширением при смене формата PNG→JPEG), игнорируя ENOENT.
  4. Обновить `AvatarsRepository` (`Map<userId, { storedName, mimeType }>`).

  Метаданные аватара — отдельный in-memory репозиторий (паттерн проекта). После рестарта он пуст → `GET /profile/avatar` даёт 404, файл на диске остаётся осиротевшим (документируется, как у файлов встреч). Физическая чистка — вне скоупа.

### 4.4 Выдача `GET /profile/avatar`

```ts
@Get('avatar')
async getAvatar(@Req() req, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
  const meta = await this.avatarsRepository.get(req.userId);
  if (!meta) throw new NotFoundException('Avatar not found');

  let content: Buffer;
  try {
    content = await readFile(path.join(getUploadsDir(), 'avatars', req.userId, meta.storedName));
  } catch {
    throw new NotFoundException('Avatar not found'); // осиротел на диске после рестарта
  }

  res.set({
    'Content-Type': meta.mimeType,
    'Content-Disposition': 'inline',                       // отображаем, а не скачиваем
    'X-Content-Type-Options': 'nosniff',                   // запрет MIME-снайфинга браузером
    'Cache-Control': 'private, no-cache',                  // после замены аватар виден без «кэш-липучки»
    'Content-Length': String(content.length),
  });
  return new StreamableFile(Readable.from(content));
}
```

- `inline` безопасен именно потому, что разрешён только растр + `nosniff`.
- `no-cache` вместо `immutable`: аватар меняется, и заголовок должен переживать замену. Кэширование с `ETag`/`immutable` по версии — возможное улучшение позже.

---

## 5. Фаза 2 — Backend: смена пароля

`POST /profile/password`, тело `ChangePasswordDto`:

```ts
class ChangePasswordDto {
  @IsString() @IsNotEmpty() oldPassword: string;
  @IsString() @MinLength(6) newPassword: string;
}
```

Хендлер `ChangePasswordCommandHandler` (в Auth, по образцу Login):

```ts
const user = await this.queryBus.execute(new FindUserByIdQuery(userId));
if (!user) throw new NotFoundException('User not found');

const ok = await bcrypt.compare(dto.oldPassword, user.password);
if (!ok) throw new BadRequestException('Неверный текущий пароль'); // 400, НЕ 401!

const hashed = await bcrypt.hash(dto.newPassword, 10);
await this.commandBus.execute(new UpdateUserCommand(userId, { password: hashed }));
```

Ключевые решения:

- **400 вместо 401 для неверного старого пароля.** Фронт трактует 401 как «токен истёк» и делает logout (см. `handleUnauthorized` в `FilesModal`, обработку `res.status === 401` на главной). Смена пароля с опечаткой не должна выбрасывать пользователя из системы. `BadRequestException` → 400 → на фронте показать «Неверный текущий пароль».
- **bcrypt остаётся только в Auth-домене** — compare и hash рядом с register/login, `saltRounds = 10` как в `RegisterCommandHandler`.
- **Токен после смены пароля не аннулируется** — в скоупе PRD этого нет. Отметка на будущее: при желании добавить `tokenVersion`/обязательный re-login. Для MVP оставляем как есть (токен живёт 24ч).
- **Новый пароль = старый** — в PRD не запрещён; можно не проверять (или добавить сравнение с текущим как опциональное ужесточение). Не в скоупе.

---

## 6. Фазы 3–4 — Frontend

### 6.1 Аватар в `<img>` — обязательный обход JWT (ключевой gotcha)

`<img src="${API_URL}/profile/avatar">` не отправляет `Authorization` → 401. Варианты:

1. **fetch → blob → `URL.createObjectURL` (рекомендуется).** Уже реализовано для скачивания файлов встреч (§6.3 ресерча файлов). Для аватара то же самое:

   ```ts
   async function loadAvatar(token: string): Promise<string | null> {
     const res = await fetch(`${API_URL}/profile/avatar`, {
       headers: { Authorization: `Bearer ${token}` },
     });
     if (res.status === 404) return null;
     if (!res.ok) return null;
     const blob = await res.blob();
     return URL.createObjectURL(blob);
   }
   // Avatar src={objectUrl}; при повторной загрузке — revokeObjectURL(prev) перед новым.
   ```

   Объектный URL переживает клиентскую навигацию, но не переживает F5 — и это правильно: на каждый маунт заново тянем актуальный аватар. Для 5 МБ в памяти браузера не проблема.

2. **Cookie-аутентификация + обычный `<img>`** — не вписывается: токен в `localStorage`, JWT-гвард ждёт Bearer-заголовок.
3. **Next API-route-прокси** (`/api/profile/avatar` → берёт токен из localStorage на клиенте и проксирует) — лишний слой; паттерн проекта — прямые fetch к `${API_URL}`.

**Вывод:** вариант 1, переиспользуя паттерн скачивания. Обновление объекта: `hasAvatar` приходит в `GET /profile` — если аватар загрузили/удалили, флаг подсказывает, тянуть ли blob.

### 6.2 Общее состояние профиля (без глобального стейт-менеджера)

В проекте нет Redux/Context для данных — состояние локальное. Чтобы шапка (главная) и страницы профиля не разъезжались, добавить небольшой хук с модульным кэшем:

```ts
// hooks/use-profile.ts
let cache: Profile | null = null;
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(cache);
  const refresh = useCallback(async () => {
    /* fetch GET /profile, cache = data */
  }, []);
  // после PATCH /profile / смены аватара — invalidate() и refresh()
  return { profile, refresh };
}
```

- `GET /profile` кэшируется в модульной переменной; `refresh()` вызывается на маунте главной и после правок на `/profile/edit`. Никакого нового стейт-менеджера.
- Имя: `profile.name ?? profile.email` (fallback из PRD). В шапке главной заменить декодирование email из JWT на данные профиля (декодирование оставить как резерв при ошибке загрузки).

### 6.3 Страницы и компоненты HeroUI v3

- **`/profile`** — просмотр: `Avatar` (src из blob-объекта или инициалы), имя (fallback email), email, кнопка-ссылка «Редактировать» → `/profile/edit`. Если аватара нет (`hasAvatar: false`) — аватар с инициалами.
- **`/profile/edit`**:
  - Форма имени: `TextField` + `Button` → `PATCH /profile`. Очистка поля → `name: null` → отображается email.
  - Загрузка аватара: нативный `<input type="file" accept="image/*">` (HeroUI v3 не даёт готового file-input; в `FilesModal` уже используется скрытый инпут + кнопка). Превью до отправки через `URL.createObjectURL` выбранного файла; после успеха — обновить blob через `loadAvatar`. Ошибки: не-изображение / >5 МБ → сообщение, прежний аватар не теряется.
  - Смена пароля: `TextField` (oldPassword, type=password) + `TextField` (newPassword, min 6) → `POST /profile/password`; `400` → «Неверный текущий пароль», форма не сбрасывается до устранения.
  - Обработка 401 на всех запросах — logout (единый хелпер, как в `FilesModal`).
- Шапка главной: `Avatar` с `src` (или инициалы) + приветствие `Привет, <name|email>` + ссылка на `/profile`.

---

## 7. e2e-тесты (`profile.e2e-spec.ts`)

По образцу `files.e2e-spec.ts`: `Test.createTestingModule([AppModule])`, `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`, `beforeEach` → `clear()` репозиториев (users, avatars), `afterEach` → `rm(getUploadsDir(), { recursive: true, force: true })`. Токен — через `POST /auth/register`.

Кейсы:

1. **Регистрация без имени** → `GET /profile` возвращает `name: null`.
2. **Регистрация с именем** → `GET /profile` возвращает переданное имя.
3. **PATCH /profile** → имя обновилось; пустое имя → `name: null`.
4. **401 без токена** на все 4 эндпоинта профиля.
5. **Загрузка аватара**: `.attach('file', <реальный PNG-буфер>, 'avatar.png')` → 201; `GET /profile/avatar` → 200, `content-type: image/png`, тело совпадает байт-в-байт. PNG-буфер — маленький валидный 1×1 PNG (зашитая base64-строка в тесте), чтобы пройти и `fileFilter`, и снифф.
6. **Не-изображение**: `.attach('file', Buffer.from('hello'), 'a.png')` (текст с расширением .png — снифф не пройдёт) → 400.
7. **>5 МБ**: `Buffer.alloc(5 * 1024 * 1024 + 1)` → 413.
8. **Замена**: загрузить PNG, затем JPEG → `GET /profile/avatar` отдаёт JPEG; на диске старый файл удалён (проверить `readdir`).
9. **Смена пароля с верным старым**: 200 → `POST /auth/login` со старым паролем → 401, с новым → 200.
10. **Смена пароля с неверным старым**: **400** (не 401!); повторный вход старым паролем работает.

---

## 8. Мемо по безопасности

1. **Path traversal**: путь на диске строится только из `userId` (числовой `sub` из JWT) и сгенерированного `avatar.<ext>`; пользовательский ввод (имя файла) на диск **не влияет**.
2. **Тип по содержимому**: `mimetype`/расширение — подделываемы; авторитетна magic-bytes проверка. Растр: PNG/JPEG/WebP/GIF. **SVG запрещён** (script в картинке → XSS при рендере).
3. **Заголовки выдачи**: `X-Content-Type-Options: nosniff` + `Content-Disposition: inline` только для растра; `Cache-Control: no-cache` для актуальности после замены.
4. **Размер**: `fileSize` в multer → 413 (рабочий механизм подтверждён e2e файлов). `fileFilter` — ранний отсев, но не замена сниффу.
5. **Пароли**: bcrypt с `saltRounds = 10` (единый код в Auth); неверный старый пароль → **400**, чтобы не разлогинивать пользователя.
6. **После рестарта**: in-memory метаданные (users, avatars) сброшены → аватар «пропал» (404), файл на диске остался осиротевшим. Документировать, физическую чистку — вне скоупа (как с файлами встреч).

---

## 9. Roadmap / когда что-то менять

| Когда                               | Что меняем                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| MVP (сейчас)                        | `ProfileModule` + `FileInterceptor` + magic-bytes снифф + in-memory `AvatarsRepository` (по плану)                                               |
| Durability пользователей/метаданных | Переезд в БД — в зависимостях уже есть **Prisma** (`@prisma/client`, `prisma` в `package.json`), схема ещё не задействована. Логичный второй шаг |
| Несколько инстансов API / прод      | Аватары на S3/MinIO/R2 через абстракцию хранилища (как `FilesStorageService` в ресерче файлов)                                                   |
| Обработка изображения               | Resize/квадратные превью через `sharp`; тогда «хранить как загружено» уходит, появляется `image/png`-пайплайн                                    |
| Инвалидация токена при смене пароля | `tokenVersion` в JWT-claim + проверка в гварде; либо обязательный re-login                                                                       |
| Мелкие улучшения аватара            | `ETag`/версия для кэша, «удалить аватар», лимит 2 МБ, preview-кроп на клиенте                                                                    |

Ключевое решение, которое стоит заложить сейчас: **вынести файловые операции с аватаром за `AvatarsService` в интерфейс хранилища** (`saveAvatar`, `readAvatar`, `removeAvatar`) — чтобы замена на S3/БД не трогала контроллер и репозиторий метаданных.

---

## Источники и обоснование

- Существующий паттерн проекта: `FilesController`/`FilesService` (multipart, 413, sanitize имени, `StreamableFile`, `Content-Disposition`), `JwtAuthGuard` (кладут `request.userId`), in-memory `UsersRepository`/`MeetingsRepository`/`FilesRepository`, CQRS-фасад Auth↔Users (register/login хендлеры с bcrypt), `files.e2e-spec.ts` (supertest + real-PNG байты для аватара взять по образцу `attach`).
- Ресерч файлов встреч: gotcha `<a href>`/`<img>` без `Authorization`, fetch+blob+`URL.createObjectURL`, поведение после рестарта, `getUploadsDir()` на базе `__dirname`.
- Безопасность загрузок изображений: проверка содержимого (magic-bytes), запрет SVG, `nosniff`, ограничение размера — стандартная практика (OWASP Unrestricted File Upload).
- Наблюдение по коду: `@nestjs/platform-express` + `@types/multer` уже в зависимостях API; `@heroui/react` v3 (Avatar, TextField, Button) на фронте; `file-type` не добавляем из-за ESM-only и конфликта с CJS-сборкой Nest.
