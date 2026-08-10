import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { FilesRepository } from '../src/files/files.repository';
import { InsightsRepository } from '../src/insights/insights.repository';
import { ActionItem, DecisionItem } from '../src/insights/meeting-insights.entity';

// ClaudeModule зарегистрирован в AppModule и тянет ESM-only SDK (@anthropic-ai/claude-agent-sdk),
// который Jest (CJS) не может распарсить. Мокаем на уровне модуля.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

describe('Insights (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;
  let meetingsRepository: MeetingsRepository;
  let filesRepository: FilesRepository;
  let insightsRepository: InsightsRepository;

  const password = 'password123';
  let token: string;
  let meetingId: string;
  let fileId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    usersRepository = moduleFixture.get<UsersRepository>(UsersRepository);
    meetingsRepository = moduleFixture.get<MeetingsRepository>(MeetingsRepository);
    filesRepository = moduleFixture.get<FilesRepository>(FilesRepository);
    insightsRepository = moduleFixture.get<InsightsRepository>(InsightsRepository);
    await app.init();
  });

  beforeEach(async () => {
    // Регистрируем пользователя и создаём встречу с файлом
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: 'insights-test@example.com', password })
      .expect(201);

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'insights-test@example.com', password })
      .expect(200);

    token = loginRes.body.access_token;

    const meetingRes = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Meeting' })
      .expect(201);

    meetingId = meetingRes.body.id;

    // Загружаем MP3-файл (достаточно буфера, не настоящий аудио)
    const fileRes = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake audio content'), 'test.mp3')
      .expect(201);

    fileId = fileRes.body.id;
  });

  afterEach(async () => {
    await usersRepository.clear();
    await meetingsRepository.clear();
    await filesRepository.clear();
    await insightsRepository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /meetings/:id/files/:fileId/insights/status', () => {
    it('should reject a request without a token (401)', async () => {
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .expect(401);
    });

    it('should return "none" for a file without insights', async () => {
      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ status: 'none' });
    });

    it('should return the status after insights are written to the repository', async () => {
      await insightsRepository.create(fileId, meetingId);

      let res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ status: 'queued' });

      // Simulate completion
      const insights = await insightsRepository.findByFileId(fileId);
      insights!.status = 'completed';
      insights!.summary = 'Test summary';
      insights!.actionItems = [{ text: 'Do something', assignee: 'Alice' }];
      insights!.decisions = [{ text: 'Decided X' }];
      await insightsRepository.save(insights!);

      res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ status: 'completed' });
    });

    it('should return error message when status is failed', async () => {
      await insightsRepository.create(fileId, meetingId);
      const insights = await insightsRepository.findByFileId(fileId);
      insights!.status = 'failed';
      insights!.error = 'Something went wrong';
      await insightsRepository.save(insights!);

      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({ status: 'failed', error: 'Something went wrong' });
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .get(`/meetings/nonexistent/files/${fileId}/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 404 for a non-existent file', async () => {
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/nonexistent/insights/status`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('GET /meetings/:id/files/:fileId/insights', () => {
    it('should reject a request without a token (401)', async () => {
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights`)
        .expect(401);
    });

    it('should return 409 when insights do not exist', async () => {
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('should return 409 when insights are not completed yet', async () => {
      await insightsRepository.create(fileId, meetingId);

      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights`)
        .set('Authorization', `Bearer ${token}`)
        .expect(409);
    });

    it('should return insights data when completed', async () => {
      const actionItems: ActionItem[] = [
        { text: 'Prepare presentation', assignee: 'Alice' },
        { text: 'Send minutes' },
      ];
      const decisions: DecisionItem[] = [
        { text: 'Launch date set to Q3' },
        { text: 'Budget approved' },
      ];

      await insightsRepository.create(fileId, meetingId);
      const insights = await insightsRepository.findByFileId(fileId);
      insights!.status = 'completed';
      insights!.summary = 'Meeting discussed project timeline and budget allocation.';
      insights!.actionItems = actionItems;
      insights!.decisions = decisions;
      await insightsRepository.save(insights!);

      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/insights`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(res.body).toEqual({
        summary: 'Meeting discussed project timeline and budget allocation.',
        actionItems: [
          { text: 'Prepare presentation', assignee: 'Alice' },
          { text: 'Send minutes' },
        ],
        decisions: [{ text: 'Launch date set to Q3' }, { text: 'Budget approved' }],
      });
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .get(`/meetings/nonexistent/files/${fileId}/insights`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 404 for a file that belongs to another meeting', async () => {
      // Create another meeting
      const meetingRes = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Another Meeting' })
        .expect(201);

      const otherMeetingId = meetingRes.body.id;

      return request(app.getHttpServer())
        .get(`/meetings/${otherMeetingId}/files/${fileId}/insights`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });
});
