# Ресерч: оптимальная техническая реализация загрузки файлов встречи

**План:** [meeting-file-upload-plan.md](./meeting-file-upload-plan.md)
**PRD:** [meeting-file-upload.md](./meeting-file-upload.md)
**Дата:** 2026-08-04
**Статус:** исследование выбрано под локальный диск + in-memory метаданные (как в плане), с разделом про миграцию на облачное хранилище.

---

## 1. Резюме и рекомендации (TL;DR)

План предписывает: локальный диск `uploads/<meetingId>/`, метаданные in-memory, лимит 20 МБ, JWT-защита. Это осознанный, минимальный MVP-вариант, полностью согласующийся с уже принятым в проекте паттерном in-memory репозиториев (меeting). Рекомендации по реализации:

| Аспект                   | Рекомендация                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Приём multipart          | `FileInterceptor` из `@nestjs/platform-express` (multer уже в зависимостях). Новых runtime-пакетов не нужно.                    |
| Валидация размера        | `limits: { fileSize: 20 * 1024 * 1024 }` у `FileInterceptor` → NestJS автоматически вернёт **413** `PayloadTooLargeException`.  |
| Безопасность имени       | Использовать **только** `basename` + принудительно сгенерированный `storedName` (UUID). `originalname` на диск **не писать**.   |
| Уникальные имена         | `storedName = uuid() + сохранить исходное расширение`. Никаких перезаписей, в т.ч. при одинаковых `originalName`.               |
| Запись на диск           | `fs.promises.mkdir(..., { recursive: true })` + `fs.promises.writeFile`. Сначала проверить существование встречи → 404.         |
| Скачивание               | `StreamableFile` с `Content-Disposition: attachment; filename="<originalName>"` и `Content-Type` из метаданных.                 |
| Тесты                    | `supertest` уже есть; загрузка через `.attach('file', buffer, name)`, сравнение байтов при скачивании.                          |
| JWT в download на фронте | `<a href>` не шлёт `Authorization`-заголовок → скачивать через `fetch` → `blob` → временная ссылка. **Ключевой gotcha фронта.** |
| Прогресс загрузки        | `fetch` не даёт upload-progress → показывать «загружаем…» (pending). Реальный прогресс — XHR, MVP не нужен.                     |

**Главные риски, которые стоит явно зафиксировать:**

1. Память: multer `memoryStorage` держит файл в RAM. При 20 МБ/файл и конкуренции это приемлемо для MVP, но на продакшн лучше `diskStorage`/поток.
2. Метаданные теряются при перезапуске, а файлы на диске остаются (осиротевают) — поведение уже запланировано и документируется (как у встреч).
3. Скачивание под JWT нельзя сделать обычной ссылкой — на фронте нужен fetch+blob.

---

## 2. Сравнение вариантов хранения

План уже сузил выбор до локального диска. Ниже — что стоит учитывать и когда мигрировать.

### 2.1 Локальный диск сервера (выбранный вариант)

- **Плюсы:** просто, быстро, ничего нового не подключать; подходит для 20 МБ и разработки; супертесты легко пишутся.
- **Минусы:** хранилище привязано к одной инстанции (не масштабируется горизонтально); теряется при удалении контейнера/инстанции; нет жизненного цикла/фолбэков; осиротевшие файлы после перезапуска (метаданные в RAM сброшены).
- **Когда это снимут:** несколько инстансов API, прод-окружение, требование durable-хранения, большие файлы.

### 2.2 Объектное хранилище (S3 / MinIO / R2)

- Плюс: масштабируется, durable, не зависит от инстанции. Минус: новый бэкенд-провайдер, настройка bucket/CORS.
- Для MVP не нужен, но логичный второй шаг (см. §8). Важно: сейчас единственная реальная причина задуматься об S3 — **скачивание под JWT**. В S3 presigned-ссылки решают заголовочный запрос сами, но они же добавляют миграцию хранилища.

### 2.3 Хранение в БД (bytea/Blob)

- Не рекомендуется для файлов: раздувает БД, LOB-данные тяжело стримить. Годится только для крошечных файлов. Пропуская.

**Вывод:** план верен — локальный диск для MVP, интерфейс хранилища стоит вынести за сервис (`FilesStorageService`), чтобы позже без боли заменить на S3.

---

## 3. Стек доступных инструментов (что уже есть)

- Backend — NestJS 10, **`@nestjs/platform-express`** в зависимостях → multer доступен через `FileInterceptor` без новых пакетов. Нужен только тип-пакет `@types/multer` (dev).
- Авторизация — `JwtAuthGuard` уже есть и используется на `MeetingsController`; `FilesController` будет вложенным в `meetings`, гвард наследуется на уровне модуля.
- Метаданные — паттерн in-memory `Map`-репозитория из `MeetingsRepository`; `MeetingFileRepository` делается по той же схеме.
- Тесты — `supertest` уже есть; поддерживает `.attach()` для multipart.
- Frontend — Next.js 15, React 19, **HeroUI v3** (Modal, Button, Spinner, автокэш).

---

## 4. Фаза 1 — Backend: загрузка и хранение

### 4.1 Модуль и структура

Следуем паттерну `MeetingsModule` (прямая DI-инъекция репозитория, вложенный контроллер на `meetings`):

```
apps/api/src/files/
  files.module.ts          # imports: JwtModule, MeetingsModule (для 404-проверки)
  files.controller.ts      # POST /meetings/:id/files
  files.service.ts         # бизнес-логика + запись на диск
  files.repository.ts      # in-memory Map репозиторий метаданных
  meeting-file.entity.ts   # id, meetingId, originalName, storedName, size, mimeType, uploadedAt
  dto/upload-file.dto.ts   # (опционально, для не-multipart валидации)
```

`FilesModule` подключается в `AppModule`. `JwtAuthGuard` регистрируется на контроллере (или через `@UseGuards` на контроллере, как в meetings).

### 4.2 Приём multipart (multer через FileInterceptor)

```ts
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage, memoryStorage } from 'multer';

@Controller('meetings/:id/files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  @Post()
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 20 * 1024 * 1024 },  // 20 МБ
    // memoryStorage — по умолчанию; для MVP достаточно. См. §4.5.
  }))
  async upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) { ... }
}
```

Замечания:

- Имя поля `'file'` согласуем с тестами `.attach('file', ...)`.
- `@UploadedFile()` вернёт `undefined`, если поле не отправлено или файл не выбран → обработать (`400` «файл не приложен»).
- **413**: multer кидает ошибку `LIMIT_FILE_SIZE`, NestJS (на базе multer 2.x, которая в `@nestjs/platform-express` 10) транслирует её в `PayloadTooLargeException` → HTTP 413. В `@types/multer` старый пакет может не быть, проверить при установке. При необходимости добавить `ExceptionFilter` для маппинга `MulterError` → 413. Это надёжнее — замапить в `FilesService`/глобальном фильтре.

### 4.3 Безопасность имени — только basename и сгенерированный storedName

MVP-критично: **не писать `originalname` на диск и не строить путь из него.**

```ts
import { basename, extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

const safeOriginalName = basename(file.originalname); // срезает любые пути ../ и вложенность
const storedName = `${randomUUID()}${extname(safeOriginalName)}`; // UUID + исходное расширение
const uploadDir = join(UPLOADS_ROOT, id); // id = meetingId
await fs.promises.mkdir(uploadDir, { recursive: true });
const storedPath = join(uploadDir, storedName);
await fs.promises.writeFile(storedPath, file.buffer);
```

Почему:

- `basename()` нейтрализует path traversal (`../../etc/passwd`, `..\..\x`). Русские буквы/пробелы в имени безопасны для записи, но для скачивания надо корректно кодировать заголовок (см. §5.2).
- `storedName` = UUID гарантирует **уникальность** (задача 4 плана): два файла с одинаковым `originalName` и не перезаписываются, и могут отличаться только расширением — для повторного имени файла это честное решение: у обоих айдишник-имя на диске, оригинальное имя хранится отдельно в метаданных и показывается пользователю.

> Альтернатива быстрому `randomUUID`: если хочется человекочитаемо различать на диске: `<uuid>-<safeOriginalName>`. Но тогда нужно снова экранировать имя. UUID+расширение — проще и безопаснее.

### 4.4 Проверка существования встречи → 404

Инъекция `MeetingsRepository` в `FilesService`. Если `findById(id)` нет — `NotFoundException`. Это требование задачи 2 плана. Порядок: сначала проверить встречу (до записи файла), потом писать.

### 4.5 Storage: memoryStorage vs diskStorage

- `memoryStorage` (дефолт): файл целиком в `Buffer` в RAM → простая `writeFile`. Для 20 МБ и разработки ок.
- `diskStorage`: multer сразу пишет на диск потоком, память почти не тратится; но `destination` колбэк срабатывает до записи, а путь ещё не проверен на существование встречи — придётся создавать папку в этом колбэке, а 404-проверка смещается до interceptor. Метаданные о размере/типе при `diskStorage` берутся из `file` после interceptor — тоже ок.

**Рекомендация для MVP:** `memoryStorage` + ручная `writeFile` после проверки 404 в сервисе — проще, тестируемо, на 20 МБ память не проблема. В §8 направление замены: потоковая запись / S3.

### 4.6 Ответ загрузки

`201 Created` с телом метаданных `MeetingFile` (короткий `DTO` без `storedName` наружу, чтобы не светить внутренний путь — достаточно отдать список полей из PRD: имя, размер, тип, дата). Идемпотентность: повторная загрузка того же файла — просто второй файл, без перезаписи (это и есть задача 4).

---

## 5. Фаза 2 — список, скачивание, e2e

### 5.1 Список

`GET /meetings/:id/files` — пройтись по `MeetingFileRepository` по ключу `meetingId`, вернуть массив метаданных (порядок: по `uploadedAt`, свежие первые). 404, если встречи нет (консистентно с `findOne`).

### 5.2 Скачивание

`GET /meetings/:id/files/:fileId/download`:

```ts
@Get(':fileId/download')
async download(
  @Param('id') id: string,
  @Param('fileId') fileId: string,
): Promise<StreamableFile> {
  const meta = await this.filesService.getForDownload(id, fileId); // 404 если нет metadata или встречи
  const stream = createReadStream(join(UPLOADS_ROOT, id, meta.storedName));
  this.res.set({
    'Content-Type': meta.mimeType,
    'Content-Disposition': contentDisposition(meta.originalName, { type: 'attachment' }),
    'Content-Length': meta.size,  // отдаём из метаданных, не делая stat
  });
  return new StreamableFile(stream);
}
```

- `StreamableFile` (NestJS) стримит без загрузки файла целиком в память — правильный выбор.
- Заголовок `Content-Disposition` нужно кодировать с учётом юникода (`filename*`), используя `content-disposition` (пакет от Express, уже в дереве) — это решает русские/спецсимволы в `originalName`.
- 404 если `fileId` нет в метаданных **или** файла на диске нет (осиротел после перезапуска) — последний случай проверить `fs.access`/`createReadStream` и кинуть `NotFoundException`.

### 5.3 e2e на supertest

В существующий `meetings.e2e-spec.ts` добавить `files.e2e-spec.ts` (или расширить meetings-спека). Supertest-загрузка multipart:

```ts
import request from 'supertest';

// загрузка
await request(app.getHttpServer())
  .post(`/meetings/${id}/files`)
  .set('Authorization', `Bearer ${token}`)
  .attach('file', Buffer.from('hello world'), 'notes.txt')
  .expect(201);

// лимит: 20 МБ превышен
const big = Buffer.alloc(20 * 1024 * 1024 + 1);
await request(app.getHttpServer())
  .post(`/meetings/${id}/files`)
  .set('Authorization', `Bearer ${token}`)
  .attach('file', big, 'big.bin')
  .expect(413);   // PayloadTooLarge

// одинаковые имена → оба сохраняются
await request(...).attach('file', Buffer.from('A'), 'a.txt').expect(201);
await request(...).attach('file', Buffer.from('B'), 'a.txt').expect(201);
// список должен вернуть ПО 2 записи с originalName === 'a.txt' и РАЗНЫМИ размерами

// скачивание: байты совпадают
const uploaded = await request(...).attach('file', Buffer.from('payload-123'), 'x.txt').expect(201);
const fid = uploaded.body.id;
const dl = await request(...).get(`/meetings/${id}/files/${fid}/download`).expect(200);
expect(dl.body).toEqual(Buffer.from('payload-123'));   // сравнение содержимого

// 401 без токена (загрузка, список, скачивание) — по 3 эндпоинта
await request(...).post(`/meetings/${id}/files`).attach('file', Buffer.from('z'), 'z').expect(401);
```

Чистка в `afterEach`: удалять временные `uploads/` (например, через `fs.rm(UPLOADS_ROOT, {recursive:true, force:true})`), чтобы тесты не копили мусор и не пересекались.

---

## 6. Фаза 3 — Frontend (HeroUI модальное окно)

### 6.1 Компоненты

HeroUI v3: `Modal`, `ModalContent`, `ModalHeader`, `ModalBody`, `ModalFooter`, `Button`, `Spinner`, `Listbox`/табличный список. Кнопка «Файлы» на карточке встречи — с `onPress` открывает модалку и грузит список.

Состояние: `files: MeetingFile[]`, `loading`, `uploading`, `error` (локальный state; глобального стейт-менеджера в проекте нет). Список — имя, размер, тип, дата; клик по строке скачивает.

### 6.2 Загрузка через fetch + FormData

```ts
const form = new FormData();
form.append('file', file, file.name);

const res = await fetch(`/api/.../meetings/${id}/files`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
if (!res.ok) {
  if (res.status === 413) throw new Error('Файл больше 20 МБ');
  throw new Error('Не удалось загрузить файл');
}
const created = await res.json();
setFiles((prev) => [created, ...prev]); // появляется сразу, без перезагрузки
```

- Не выставлять `Content-Type` вручную — браузер сам добавит `multipart/form-data; boundary=...` со всеми частями.
- После успеха — добавить файл в начало списка (задача 3 плана).
- **Прогресс**: `fetch` не отдаёт upload-progress. Поэтому «индикатор состояния» из задачи 3 = `uploading`-спиннер на кнопке / `Spinner` в списке. Честного процента без XHR нет; если понадобится — `XMLHttpRequest` с `xhr.upload.onprogress` (MVP можно отложить).

### 6.3 Скачивание под JWT — ключевой gotcha

`<a href="/meetings/1/files/2/download">` **не отправит** `Authorization`-заголовок → 401. Решения:

1. **fetch → blob → временная ссылка (рекомендовано):**

   ```ts
   const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
   if (!res.ok) {
     /* handle 401/404 */
   }
   const blob = await res.blob();
   const href = URL.createObjectURL(blob);
   const a = document.createElement('a');
   a.href = href;
   a.download = file.originalName; // сюда кладём переданное имя
   a.click();
   URL.revokeObjectURL(href);
   ```

   Плюсы: работает с текущим JWT-guard'ом, имена с юникодом отдаются корректно через атрибут `download`. Минусы: файл целиком в памяти браузера (для 20 МБ ок).

2. **Cookie-аутентификация + обычная ссылка** — требует домен-общего cookie и CSRF-защиты; сейчас JWT в заголовке, так что это не вписывается в MVP.

3. **presigned links** — только при S3 (см. §8).

Для текущей архитектуры берём вариант 1.

### 6.4 Обработка ошибок

- `413` → «Файл больше 20 МБ» (как в задаче 4), список не меняется.
- `401` → редирект на логин.
- Сброс `error` при открытии модалки.

Рефетч списка при открытии, чтобы данные были свежими; после успешной загрузки список обновляется локально (без полного рефетча, хотя можно и рефетчнуть — дешевле).

---

## 7. Мемо по безопасности

1. **Path traversal**: никогда не строить путь на диске из `originalname`. Только `basename` + сгенерированный `storedName`. Это закрывает `../../etc/passwd` и NUL-байты.
2. **Размер**: `fileSize` лимит на multer + возврат 413.
3. **Тип содержимого**: `mimeType` браузерный — это метаданные, не доверять для исполнения. Отдавать как `attachment`, не `inline`, и не полагаться на него как на фильтр. Если нужно белить расширения — `fileFilter` в `FileInterceptor` (в плане не требуется, но опционально).
4. **Права на каталог**: папку `uploads` создать с ограниченными правами если на shared-хостинге; `.gitignore` её исключить.
5. **In-memory сброс**: после рестарта метаданные обнуляются, осиротевшие файлы на диске остаются — нагрузку на диск и утечку решить либо `clear()`-очисткой при старте (не запускать дефолтом, т.к. могут быть нужны) либо фоновой очисткой `storedName` без записей. В MVP задокументировать поведение (как требует план), физическую чистку оставить на потом.

---

## 8. Roadmap / когда что-то менять

| Когда                          | Что меняем                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP (сейчас)                   | Локальный диск + `FileInterceptor` + in-memory метаданные (по плану)                                                                                |
| Несколько инстансов API / прод | Вынести запись за `FilesStorageService`; заменить на S3/MinIO/R2; подписать presigned-ссылки на скачивание (уходит JWT-заголовок в десктоп-ссылках) |
| Большие файлы                  | Потоковая запись (`diskStorage`/pipe) вместо `Buffer`; лимит поднять; фоновые таски обработки                                                       |
| Прогресс загрузки в UI         | `XMLHttpRequest`+`xhr.upload.onprogress` или чанки с PUT (S3 multipart)                                                                             |
| Durability метаданных          | Переезд метаданных из RAM в Postgres/Prisma (в проекте уже есть Prisma)                                                                             |

Ключевое архитектурное решение, которое стоит заложить сейчас и которое сэкономит позже: **абстракция `FilesStorageService`** (методы `save(meetingId, buffer, storedName)`, `createReadStream(...)`, `remove(...)`), чтобы локальная реализация свободно заменилась на облачный провайдер без изменения контроллеров и репозитория метаданных.

---

## Источники и обоснование

- NestJS-документация: file upload / `FileInterceptor` / `StreamableFile` (дефолтная реализация на базе `@nestjs/platform-express` + multer).
- Стандарт безопасности файловых загрузок: только `basename`, сгенерированные имена на диске, лимиты размера, `attachment` вместо `inline`.
- Наблюдение по коду: `@nestjs/platform-express` уже в `apps/api/package.json`; `supertest` в dev-зависимостях; паттерн in-memory репозитория (`MeetingsRepository`), `JwtAuthGuard` на контроллере; HeroUI v3 на фронте.
