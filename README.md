# Video Meetings

A video conferencing platform built as an NPM workspace monorepo. It consists of a Next.js frontend and a NestJS backend, sharing unified tooling for linting, formatting, and type checking.

> **[RU]** Этот проект документирован на английском языке для широкой аудитории. Для вопросов обращайтесь к [`CLAUDE.md`](./CLAUDE.md).

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development](#development)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Database](#database)
- [Testing](#testing)
- [Code Quality](#code-quality)
- [Documentation](#documentation)

## Features

- **User Authentication** — registration (optional name field) and login via email/password with JWT
- **User Profile** — view and edit profile (name, avatar), change password
- **Meetings** — create and manage video meetings (CRUD)
- **File Sharing** — upload, list, and download meeting files (20 MB limit) with sanitized filenames
- **Avatar Upload** — image validation by magic bytes (PNG/JPEG/GIF/WebP), 5 MB limit, stored per user

## Architecture

The project follows a monorepo architecture using NPM workspaces. Both applications share common development tooling (ESLint, Prettier, TypeScript) configured at the repository root.

```
video-meetings/
├── apps/
│   ├── api/          # NestJS backend
│   └── web/          # Next.js frontend
├── docs/             # Project documentation, PRDs, research
├── docker-compose.yml
├── package.json
└── CLAUDE.md
```

### Backend (`@video-meetings/api`)

- **Framework**: NestJS 10 with CQRS pattern (`@nestjs/cqrs`)
- **Auth**: JWT-based authentication with `@nestjs/jwt` and `passport-jwt`
- **Validation**: `class-validator` and `class-transformer`
- **ORM**: Prisma client (currently in-memory repositories for development)
- **Password Hashing**: bcrypt (10 rounds)
- **File Handling**: Multer for multipart uploads, `StreamableFile` for downloads
- **Pattern**: App factory (`app.factory.ts`) separated from bootstrap (`main.ts`) for testability

### Frontend (`@video-meetings/web`)

- **Framework**: Next.js 15 (App Router) with React 19
- **UI Library**: HeroUI v3 (Tailwind CSS v4 + React Aria)
- **State Management**: No global state manager — profile data cached modularly by token via hooks
- **Routing**: Client-side navigation with `next/navigation`; JWT-based auth guard on protected routes

## Prerequisites

- **Node.js** >= 18.18
- **npm** 10+
- **Docker** & **Docker Compose** (for the PostgreSQL database)

## Quick Start

### 1. Clone and Install

```bash
git clone <repository-url>
cd video-meetings
npm install
```

### 2. Set Up Environment

Ensure a `.env` file exists at the project root with the required variables (see [Configuration](#configuration)). An existing `.env` is present in this repository; adjust values as needed.

### 3. Start PostgreSQL

```bash
docker compose up -d postgres
```

### 4. Start Development Servers

```bash
npm run dev
```

This runs both apps concurrently:

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

To run a single app:

```bash
npm run dev:web   # Frontend only
npm run dev:api   # Backend only
```

## Development

All commands are run from the repository root.

### Commands

| Command                | Description                                                     |
| ---------------------- | --------------------------------------------------------------- |
| `npm run dev`          | Start both frontend and backend dev servers concurrently        |
| `npm run dev:web`      | Start the Next.js frontend dev server (port 3000)               |
| `npm run dev:api`      | Start the NestJS backend dev server with watch mode (port 3001) |
| `npm run build`        | Build all workspaces                                            |
| `npm run build:web`    | Build the Next.js frontend for production                       |
| `npm run build:api`    | Build the NestJS backend (outputs to `dist/`)                   |
| `npm test`             | Run all workspace tests (currently API e2e tests)               |
| `npm run lint`         | Run ESLint across the entire monorepo                           |
| `npm run lint:fix`     | Run ESLint with auto-fix across the entire monorepo             |
| `npm run format`       | Format all files with Prettier                                  |
| `npm run format:check` | Check formatting without writing changes                        |
| `npm run clean`        | Remove `node_modules`, `.next`, and `dist` directories          |

### Running the API in Production Mode

```bash
npm run build:api
npm start --workspace @video-meetings/api
```

## Project Structure

```
video-meetings/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── auth/           # Authentication (register, login, JWT guard)
│   │   │   ├── users/          # User module with CQRS commands/queries
│   │   │   ├── meetings/       # Meetings CRUD module
│   │   │   ├── files/          # Meeting file upload/list/download
│   │   │   ├── profile/        # User profile, avatar, password change
│   │   │   ├── app.module.ts   # Root module
│   │   │   ├── app.controller.ts
│   │   │   ├── app.service.ts
│   │   │   ├── app.factory.ts  # App factory for testability
│   │   │   └── main.ts         # Bootstrap entry point
│   │   ├── test/
│   │   │   ├── auth.e2e-spec.ts
│   │   │   ├── files.e2e-spec.ts
│   │   │   ├── meetings.e2e-spec.ts
│   │   │   ├── profile.e2e-spec.ts
│   │   │   └── jest-e2e.json
│   │   └── package.json
│   ├── web/
│   │   ├── app/
│   │   │   ├── layout.tsx      # Root layout
│   │   │   ├── page.tsx        # Home page
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── profile/        # Profile view and edit pages
│   │   ├── components/
│   │   │   └── files/
│   │   ├── hooks/
│   │   │   └── use-profile.ts   # Profile and avatar hooks
│   │   ├── lib/
│   │   │   └── format.ts
│   │   └── package.json
├── docs/
│   ├── meeting-file-upload.md
│   ├── meeting-file-upload-plan.md
│   ├── research-meeting-file-upload.md
│   ├── user-profile.md
│   ├── user-profile-plan.md
│   └── research-user-profile.md
├── .env.example
├── docker-compose.yml
├── package.json
└── CLAUDE.md
```

## Configuration

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# AI (Claude Code)
ANTHROPIC_BASE_URL=http://localhost:20128
ANTHROPIC_AUTH_TOKEN=sk-...

# PostgreSQL
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=video_meetings
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/video_meetings

# Backend
PORT=3001
JWT_SECRET=your-jwt-secret-key
JWT_EXPIRES_IN=7d
```

### Docker

The `docker-compose.yml` file starts a PostgreSQL 16 instance:

```bash
docker compose up -d
```

| Service    | Port | Purpose             |
| ---------- | ---- | ------------------- |
| `postgres` | 5432 | PostgreSQL database |

## Testing

The backend uses **Jest** with **SuperTest** for end-to-end testing. Tests run against in-memory repositories (no database required).

```bash
# Run all tests
npm test

# Run tests for a specific workspace
npm run test --workspace @video-meetings/api

# Run backend e2e tests only
npm run test:e2e --workspace @video-meetings/api

# Run backend tests silently (just check for errors)
npm test --silent
```

## Code Quality

This monorepo uses unified code quality tooling:

- **ESLint** (flat config) — `npm run lint` / `npm run lint:fix`
- **Prettier** — `npm run format` / `npm run format:check`
- **Husky** — pre-commit hooks run `lint-staged` (lint + format on staged files) and tests

> **Note:** The backend uses in-memory repositories for development and testing. Data does not persist across server restarts. Files stored on disk will not be cleaned up automatically.

## Documentation

- [CLAUDE.md](./CLAUDE.md) — Development guide for Claude Code
- [Meeting File Upload PRD](./docs/meeting-file-upload.md)
- [Meeting File Upload Plan](./docs/meeting-file-upload-plan.md)
- [Meeting File Upload Research](./docs/research-meeting-file-upload.md)
- [User Profile PRD](./docs/user-profile.md)
- [User Profile Plan](./docs/user-profile-plan.md)
- [User Profile Research](./docs/research-user-profile.md)

## License

This project is private and proprietary.
