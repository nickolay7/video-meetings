import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { FilesRepository } from '../src/files/files.repository';
import { TranscriptionService } from '../src/transcription/transcription.service';
import { InsightsRepository } from '../src/insights/insights.repository';
import {
  SPEECH_TRANSCRIBER,
  SpeechTranscriber,
} from '../src/transcription/speech-transcriber.interface';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Мокаем Claude SDK — возвращаем валидный JSON с инсайтами
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

/** Имитация потока сообщений SDK (AsyncGenerator) с JSON-результатом. */
function resultStream(data: unknown) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'result', subtype: 'success', result: JSON.stringify(data) };
    },
  };
}

/** Имитация потока с ошибкой. */
function errorStream(errors: string[]) {
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: 'result', subtype: 'error_during_execution', errors };
    },
  };
}

/** Фейковый SpeechTranscriber: возвращает заданный текст без реального Whisper. */
class FakeTranscriber implements SpeechTranscriber {
  async transcribe(_inputPath: string): Promise<string> {
    return 'Alice discussed the project timeline. Bob agreed to prepare the presentation. Decision: launch in Q3.';
  }
}

describe('Insights generation (e2e) — integration with TranscriptionService', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;
  let meetingsRepository: MeetingsRepository;
  let filesRepository: FilesRepository;
  let insightsRepository: InsightsRepository;
  let transcriptionService: TranscriptionService;

  const password = 'password123';
  let token: string;
  let meetingId: string;
  let fileId: string;

  const fakeTranscriber = new FakeTranscriber();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(SPEECH_TRANSCRIBER)
      .useValue(fakeTranscriber)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    usersRepository = moduleFixture.get<UsersRepository>(UsersRepository);
    meetingsRepository = moduleFixture.get<MeetingsRepository>(MeetingsRepository);
    filesRepository = moduleFixture.get<FilesRepository>(FilesRepository);
    insightsRepository = moduleFixture.get<InsightsRepository>(InsightsRepository);
    transcriptionService = moduleFixture.get<TranscriptionService>(TranscriptionService);
    await app.init();
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'insights-gen-test@example.com', password })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'insights-gen-test@example.com', password })
      .expect(200);

    token = loginRes.body.access_token;

    const meetingRes = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Meeting' })
      .expect(201);

    meetingId = meetingRes.body.id;

    const fileRes = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake audio'), 'test.mp3')
      .expect(201);

    fileId = fileRes.body.id;
  });

  afterEach(async () => {
    await usersRepository.clear();
    await meetingsRepository.clear();
    await filesRepository.clear();
    await insightsRepository.clear();
    await transcriptionService.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should generate insights after transcription completes', async () => {
    mockedQuery.mockReturnValue(
      resultStream({
        summary: 'Team discussed project timeline and budget.',
        actionItems: [
          { text: 'Prepare presentation', assignee: 'Alice' },
          { text: 'Send minutes' },
        ],
        decisions: [{ text: 'Launch in Q3' }],
      }) as unknown as ReturnType<typeof query>,
    );

    // Запускаем транскрибацию
    await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Ждём завершения транскрибации (она синхронная, т.к. FakeTranscriber не ждёт)
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Проверяем инсайты
    const statusRes = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(statusRes.body.status).toBe('completed');

    const dataRes = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/insights`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(dataRes.body).toEqual({
      summary: 'Team discussed project timeline and budget.',
      actionItems: [{ text: 'Prepare presentation', assignee: 'Alice' }, { text: 'Send minutes' }],
      decisions: [{ text: 'Launch in Q3' }],
    });
  }, 10000);

  it('should set insights status to failed when Claude returns an error', async () => {
    mockedQuery.mockReturnValue(
      errorStream(['Claude API error']) as unknown as ReturnType<typeof query>,
    );

    // Запускаем транскрибацию
    await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    // Ждём завершения
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Проверяем статус инсайтов — должен быть failed
    const statusRes = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(statusRes.body.status).toBe('failed');
    expect(statusRes.body.error).toContain('Claude query failed');
  }, 10000);

  it('should reset and regenerate insights on re-transcription', async () => {
    const v1 = resultStream({
      summary: 'First version summary',
      actionItems: [{ text: 'Task 1' }],
      decisions: [{ text: 'Decision 1' }],
    });

    const v2 = resultStream({
      summary: 'Second version summary',
      actionItems: [{ text: 'Task 2' }],
      decisions: [{ text: 'Decision 2' }],
    });

    mockedQuery
      .mockReturnValueOnce(v1 as unknown as ReturnType<typeof query>)
      .mockReturnValueOnce(v2 as unknown as ReturnType<typeof query>);

    // Первая транскрибация
    await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Проверяем первую версию
    const dataRes1 = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/insights`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(dataRes1.body.summary).toBe('First version summary');

    // Перезапускаем транскрибацию (меняем текст через FakeTranscriber — но он статичный,
    // поэтому проверяем, что InsightsGeneratorService перезапускается)
    // Сначала сбрасываем статус транскрипции до failed (чтобы можно было перезапустить)
    const transcriptionService = app.get(TranscriptionService);
    await transcriptionService.clear();

    // Перезапускаем
    await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Проверяем вторую версию
    const dataRes2 = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/insights`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(dataRes2.body.summary).toBe('Second version summary');
    expect(dataRes2.body.actionItems).toEqual([{ text: 'Task 2' }]);
  }, 10000);

  describe('POST /meetings/:id/files/:fileId/insights/regenerate', () => {
    it('should reject a request without a token (401)', async () => {
      return request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/insights/regenerate`)
        .expect(401);
    });

    it('should return 409 when the transcription is not completed yet', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/insights/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('should return 404 for a non-existent file', async () => {
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/nonexistent/insights/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should regenerate insights from a completed transcription after a failure', async () => {
      // Первая генерация падает (например, Claude недоступен)
      mockedQuery.mockReturnValueOnce(
        errorStream(['Claude API error']) as unknown as ReturnType<typeof query>,
      );
      // Повторная генерация успешна
      mockedQuery.mockReturnValueOnce(
        resultStream({
          summary: 'Regenerated summary',
          actionItems: [{ text: 'Regenerated task', assignee: 'Bob' }],
          decisions: [{ text: 'Regenerated decision' }],
        }) as unknown as ReturnType<typeof query>,
      );

      // Транскрибация запускает первую (неудачную) генерацию
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));

      let statusRes = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(statusRes.body.status).toBe('failed');

      // Повторяем генерацию из готовой транскрипции (Whisper не перезапускается)
      const retryRes = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/insights/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(retryRes.body).toEqual({ status: 'queued' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      statusRes = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(statusRes.body.status).toBe('completed');

      const dataRes = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(dataRes.body).toEqual({
        summary: 'Regenerated summary',
        actionItems: [{ text: 'Regenerated task', assignee: 'Bob' }],
        decisions: [{ text: 'Regenerated decision' }],
      });
    }, 10000);
  });
});
