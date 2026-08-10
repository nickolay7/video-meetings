import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { rm } from 'fs/promises';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { FilesRepository } from '../src/files/files.repository';
import { TasksRepository } from '../src/tasks/tasks.repository';
import { InsightsRepository } from '../src/insights/insights.repository';
import { TranscriptionService } from '../src/transcription/transcription.service';
import { getUploadsDir } from '../src/files/files.constants';
import {
  SPEECH_TRANSCRIBER,
  SpeechTranscriber,
} from '../src/transcription/speech-transcriber.interface';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DecisionItem } from '../src/insights/meeting-insights.entity';
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
    return 'Alice discussed the project timeline. Bob agreed to prepare the presentation.';
  }
}

describe('Tasks (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;
  let meetingsRepository: MeetingsRepository;
  let filesRepository: FilesRepository;
  let tasksRepository: TasksRepository;
  let insightsRepository: InsightsRepository;
  let transcriptionService: TranscriptionService;

  const password = 'password123';
  let token: string;
  let meetingId: string;

  const fakeTranscriber = new FakeTranscriber();

  /** Параметры имитации агента — задаются в каждом тесте, потребляются моком query. */
  const agent = {
    data: null as SimulatedAgentData | null,
  };

  /**
   * Мокаем query так, чтобы он имитировал агента: читает MCP-инструменты meeting-сервера
   * из опций запроса и драйвит их по заданным данным — для каждого action item создаёт
   * задачу (updateTask, source `insights`) и возвращает финальный JSON { summary, decisions }.
   */
  (mockedQuery as unknown as jest.Mock).mockImplementation(async function* (request: {
    options?: {
      mcpServers?: {
        meeting?: { tools?: { name: string; handler: MockToolHandler }[] };
      };
    };
  }) {
    if (!agent.data) {
      throw new Error('agent.data is not set');
    }
    const tools = request.options?.mcpServers?.meeting?.tools ?? [];
    const updateTask = tools.find((tool) => tool.name === 'updateTask')?.handler;

    for (const actionItem of agent.data.actionItems) {
      await updateTask?.({
        meetingId,
        title: actionItem.text,
        assignee: actionItem.assignee,
        source: 'insights',
      });
    }

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
    tasksRepository = moduleFixture.get<TasksRepository>(TasksRepository);
    insightsRepository = moduleFixture.get<InsightsRepository>(InsightsRepository);
    transcriptionService = moduleFixture.get<TranscriptionService>(TranscriptionService);
    await app.init();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    agent.data = null;

    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'tasks-test@example.com', password })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'tasks-test@example.com', password })
      .expect(200);

    token = loginRes.body.access_token;

    const meetingRes = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Meeting' })
      .expect(201);

    meetingId = meetingRes.body.id;
  });

  afterEach(async () => {
    await usersRepository.clear();
    await meetingsRepository.clear();
    await filesRepository.clear();
    await tasksRepository.clear();
    await insightsRepository.clear();
    await transcriptionService.clear();
    await rm(getUploadsDir(), { recursive: true, force: true });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /meetings/:id/tasks', () => {
    it('should reject a request without a token (401)', async () => {
      return request(app.getHttpServer()).get(`/meetings/${meetingId}/tasks`).expect(401);
    });

    it('should return an empty list for a meeting without tasks', async () => {
      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .get('/meetings/nonexistent/tasks')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return tasks created via the repository in creation order', async () => {
      await tasksRepository.create(meetingId, 'Prepare presentation', 'insights', 'Alice');
      await tasksRepository.create(meetingId, 'Send minutes', 'insights');

      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toHaveLength(2);
      expect(res.body[0]).toMatchObject({
        title: 'Prepare presentation',
        source: 'insights',
        status: 'open',
        assignee: 'Alice',
      });
      expect(res.body[0].meetingId).toBe(meetingId);
      expect(res.body[1].title).toBe('Send minutes');
    });
  });

  describe('PATCH /meetings/:id/tasks/:taskId', () => {
    it('should reject a request without a token (401)', async () => {
      return request(app.getHttpServer())
        .patch(`/meetings/${meetingId}/tasks/1`)
        .send({ status: 'completed' })
        .expect(401);
    });

    it('should update a task status', async () => {
      const task = await tasksRepository.create(meetingId, 'Prepare presentation', 'insights');

      const res = await request(app.getHttpServer())
        .patch(`/meetings/${meetingId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'completed' })
        .expect(200);

      expect(res.body.status).toBe('completed');

      const listRes = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(listRes.body[0].status).toBe('completed');
    });

    it('should reject an invalid status (400)', async () => {
      const task = await tasksRepository.create(meetingId, 'Prepare presentation', 'insights');

      return request(app.getHttpServer())
        .patch(`/meetings/${meetingId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'done' })
        .expect(400);
    });

    it('should return 404 for a non-existent task', async () => {
      return request(app.getHttpServer())
        .patch(`/meetings/${meetingId}/tasks/nonexistent`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'completed' })
        .expect(404);
    });

    it('should return 404 for a task that belongs to another meeting', async () => {
      const task = await tasksRepository.create(meetingId, 'Prepare presentation', 'insights');

      const otherMeetingRes = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Another Meeting' })
        .expect(201);

      const otherMeetingId = otherMeetingRes.body.id;

      return request(app.getHttpServer())
        .patch(`/meetings/${otherMeetingId}/tasks/${task.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'completed' })
        .expect(404);
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .patch('/meetings/nonexistent/tasks/1')
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'completed' })
        .expect(404);
    });
  });

  describe('integration: tasks are created from insights generation', () => {
    it('should create tasks after transcription completes and replace them on regeneration', async () => {
      // Загружаем MP3-файл
      const fileRes = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('fake audio'), 'test.mp3')
        .expect(201);

      const fileId = fileRes.body.id;

      agent.data = {
        summary: 'Team discussed project timeline.',
        actionItems: [
          { text: 'Prepare presentation', assignee: 'Alice' },
          { text: 'Send minutes' },
        ],
        decisions: [{ text: 'Launch in Q3' }],
      };

      // Транскрибация запускает генерацию инсайтов автоматически
      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      await new Promise((resolve) => setTimeout(resolve, 100));

      const tasksRes = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(tasksRes.body).toHaveLength(2);
      expect(tasksRes.body[0]).toMatchObject({
        title: 'Prepare presentation',
        assignee: 'Alice',
        source: 'insights',
        status: 'open',
      });
      expect(tasksRes.body[1].title).toBe('Send minutes');

      // Регенерация: старая версия задач заменяется новой
      agent.data = {
        summary: 'Second version summary',
        actionItems: [{ text: 'Updated task' }],
        decisions: [{ text: 'Decision 2' }],
      };

      const regenerateRes = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/insights/regenerate`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);

      expect(regenerateRes.body).toEqual({ status: 'queued' });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const tasksAfterRegen = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/tasks`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(tasksAfterRegen.body.map((task: { title: string }) => task.title)).toEqual([
        'Updated task',
      ]);
    }, 10000);
  });
});
