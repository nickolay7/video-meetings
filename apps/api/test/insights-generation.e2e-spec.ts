import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { FilesRepository } from '../src/files/files.repository';
import { TranscriptionService } from '../src/transcription/transcription.service';
import { InsightsRepository } from '../src/insights/insights.repository';
import { TasksRepository } from '../src/tasks/tasks.repository';
import {
  SPEECH_TRANSCRIBER,
  SpeechTranscriber,
} from '../src/transcription/speech-transcriber.interface';
import { DecisionItem } from '../src/insights/meeting-insights.entity';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Мокаем Claude SDK — ESM-only пакет, который Jest (CJS) не может распарсить.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
  createSdkMcpServer: (options: object) => ({ ...options }),
}));

const mockedQuery = query as jest.MockedFunction<typeof query>;

/** Что «решает» агент в текущем тесте: данные, по которым мок query драйвит инструменты. */
interface SimulatedAgentData {
  summary: string;
  actionItems: { text: string; assignee?: string }[];
  decisions: DecisionItem[];
}

/** Мок хендлера MCP-инструмента (реальный хендлер из meeting-tool.ts). */
type MockToolHandler = (args: Record<string, unknown>) => Promise<CallToolResult>;

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
  let tasksRepository: TasksRepository;
  let transcriptionService: TranscriptionService;

  const password = 'password123';
  let token: string;
  let meetingId: string;
  let fileId: string;

  const fakeTranscriber = new FakeTranscriber();

  /** Параметры имитации агента — задаются в каждом тесте, потребляются моком query. */
  const agent = {
    data: null as SimulatedAgentData | null,
    shouldFail: false,
  };

  /**
   * Мокаем query так, чтобы он имитировал агента: читает MCP-инструменты meeting-сервера
   * из опций запроса и драйвит их по заданным данным — для каждого action item создаёт
   * задачу (updateTask, source `insights`), пишет summary во встречу (updateMeeting) и
   * возвращает финальный JSON { summary, decisions }.
   */
  (mockedQuery as unknown as jest.Mock).mockImplementation(async function* (request: {
    options?: {
      mcpServers?: {
        meeting?: { tools?: { name: string; handler: MockToolHandler }[] };
      };
    };
  }) {
    if (agent.shouldFail) {
      yield { type: 'result', subtype: 'error_during_execution', errors: ['Claude API error'] };
      return;
    }
    if (!agent.data) {
      throw new Error('agent.data is not set');
    }
    const tools = request.options?.mcpServers?.meeting?.tools ?? [];
    const updateTask = tools.find((tool) => tool.name === 'updateTask')?.handler;
    const updateMeeting = tools.find((tool) => tool.name === 'updateMeeting')?.handler;

    for (const actionItem of agent.data.actionItems) {
      await updateTask?.({
        meetingId,
        title: actionItem.text,
        assignee: actionItem.assignee,
        source: 'insights',
      });
    }
    await updateMeeting?.({ meetingId, summary: agent.data.summary });

    yield {
      type: 'result',
      subtype: 'success',
      result: JSON.stringify({ summary: agent.data.summary, decisions: agent.data.decisions }),
    };
  });

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
    tasksRepository = moduleFixture.get<TasksRepository>(TasksRepository);
    transcriptionService = moduleFixture.get<TranscriptionService>(TranscriptionService);
    await app.init();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    agent.data = null;
    agent.shouldFail = false;

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
    await tasksRepository.clear();
    await transcriptionService.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should generate insights after transcription completes', async () => {
    agent.data = {
      summary: 'Team discussed project timeline and budget.',
      actionItems: [{ text: 'Prepare presentation', assignee: 'Alice' }, { text: 'Send minutes' }],
      decisions: [{ text: 'Launch in Q3' }],
    };

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

    // Агент записал summary во встречу через updateMeeting.
    const storedMeeting = await meetingsRepository.findById(meetingId);
    expect(storedMeeting?.summary).toBe('Team discussed project timeline and budget.');
  }, 10000);

  it('should set insights status to failed when Claude returns an error', async () => {
    agent.shouldFail = true;

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
    agent.data = {
      summary: 'First version summary',
      actionItems: [{ text: 'Task 1' }],
      decisions: [{ text: 'Decision 1' }],
    };

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

    // Вторая версия «решений агента»
    agent.data = {
      summary: 'Second version summary',
      actionItems: [{ text: 'Task 2' }],
      decisions: [{ text: 'Decision 2' }],
    };

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

    // Самостоятельные задачи: после регенерации остаётся только новая версия
    const tasksRes2 = await request(app.getHttpServer())
      .get(`/meetings/${meetingId}/tasks`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(tasksRes2.body.map((task: { title: string }) => task.title)).toEqual(['Task 2']);
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
      agent.shouldFail = true;

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

      // Повторная генерация успешна
      agent.shouldFail = false;
      agent.data = {
        summary: 'Regenerated summary',
        actionItems: [{ text: 'Regenerated task', assignee: 'Bob' }],
        decisions: [{ text: 'Regenerated decision' }],
      };

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
