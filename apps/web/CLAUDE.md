# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Обзор

Фронтенд-приложение Next.js (App Router) — пакет `@video-meetings/web`. Входит в npm-монорепозиторий, команды запускаются из его корня.

## Стек и выбранная библиотека UI

- Next.js 15 (App Router, `app/`), React 19, TypeScript
- **UI-библиотека: HeroUI v3** — выбор зафиксирован.
  - Базируется на **Tailwind CSS v4** + React Aria Components.
  - Пакеты: `@heroui/react` и `@heroui/styles` (НЕ ставить v2-архитектуру: `HeroUIProvider`, `@heroui/theme`, `framer-motion` — в v3 провайдер не нужен, анимации CSS).
  - На корне включён `prettier-plugin-tailwindcss`.
- Импорт в `globals.css`: `@import "tailwindcss"` затем `@import "@heroui/styles"`; Tailwind v4 через `@tailwindcss/postcss`.

## Архитектура

- App Router: `app/layout.tsx` — корневой layout (метаданные, `<html lang="ru">`), `app/page.tsx` — главная страница, `app/globals.css` — глобальные стили.
- `next.config.ts` — конфиг Next (`reactStrictMode: true`).
- `next-env.d.ts` — генерируется Next, добавлен в ignore ESLint, руками не редактировать.

## Профиль пользователя (страницы `/profile` и `/profile/edit`)

- `app/profile/page.tsx` — просмотр профиля: аватар (из blob-объекта или инициалы), имя (fallback — email), email, переход на редактирование. Требует JWT — без токена редирект на `/login`.
- `app/profile/edit/page.tsx` — редактирование: смена имени (`PATCH /profile`; пустое имя → при отображении email), загрузка аватара (`POST /profile/avatar`, multipart-поле `file`, лимит 5 МБ, клиентская проверка типа/размера + серверные magic-bytes), смена пароля (`POST /profile/password`; неверный старый → «Неверный текущий пароль», форма не сбрасывается).
- `hooks/use-profile.ts` — общий доступ к профилю и аватару:
  - `useProfile()` — профиль с **модульным кэшем, ключеванным по токену** (профиль переживает клиентскую навигацию без повторного запроса; после logout/входа другого пользователя кэш старого аккаунта не отдаётся). `refresh()` тянет `GET /profile`, `update()` — синхронно из ответа API. Никакого глобального стейт-менеджера.
  - `useAvatar()` — object-URL аватара через `fetch`+`blob`+`URL.createObjectURL` (обычный `<img src={API_URL}/profile/avatar>` не отправил бы Authorization). 404 → null (инициалы). Жизненный цикл URL: `refresh()` — актуальный с сервера; `setPreviewUrl()` — локальный предпросмотр выбранного файла; `resetPreview()` — откат к серверному аватару после ошибки загрузки без round-trip к сети. Старый URL отменяется, при размонтировании — `revokeObjectURL`.
  - Утилиты `displayName()` (имя или email), `getInitials()`, `getAccessToken()`, `ProfileUnauthorizedError` (401 → logout).
- Обработка 401 на всех запросах профиля — logout (`localStorage.removeItem('access_token')` + `router.push('/login')`).
- Форма регистрации (`app/register/page.tsx`) принимает необязательное «Имя»; при пустом поле регистрация проходит без имени.

## Файлы встречи (модальное окно «Файлы»)

- `components/files/files-modal.tsx` — модальное окно «Файлы»: список файлов встречи (загрузка, скачивание через fetch+blob с Authorization, формат/размер/дата) и транскрибация MP3/MP4:
  - У файлов MP3/MP4 (определение по расширению ИЛИ MIME-типу — см. `lib/transcription.ts`, зеркало backend) кнопка «Транскрибировать»; после статуса «Готово» она скрывается, появляется кнопка «Показать транскрипцию».
  - Статусы «В очереди» / «Транскрибация…» / «Готово» / «Ошибка» обновляются в списке без перезагрузки: опрос `GET .../transcription/status` раз в секунду, остановка на терминальном статусе, таймеры чистятся при закрытии модалки и при размонтировании.
  - Текст расшифровки открывается по кнопке (`GET .../transcription`) во вложенной панели с прокруткой.
  - После ошибки повторный клик по кнопке запускает транскрибацию заново; при 409 (уже в очереди/завершено) статус синхронизируется с сервера.
- `lib/transcription.ts` — типы статусов транскрибации и `isTranscribableFile()`: MP3/MP4 по расширению или MIME-типу (как `isSupportedTranscriptionFormat` в backend).

## Полезные команды

Из корня монорепо:

- `npm run dev:web` — dev-сервер (порт 3000)
- `npm run build:web` — продакшн-сборка
- `npm run lint` / `npm run format` — применяют конфиг корня

## Соглашения компонентов HeroUI

- Semantic-варианты (`primary`, `secondary`, `tertiary`, `danger`, `ghost`, `outline`), не сырые цвета.
- Compound-структура (`Card.Header`, `Card.Content`), не плоские пропсы.
- Обработчики — `onPress`, не `onClick`.
- Перед реализацией компонента — подтягивать docs с `heroui.com/docs/react/components/{name}.mdx` (доступно через скилл heroui-react).
