import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { rm } from 'fs/promises';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { FilesRepository } from '../src/files/files.repository';
import { TranscriptionService } from '../src/transcription/transcription.service';
import {
  SPEECH_TRANSCRIBER,
  SpeechTranscriber,
} from '../src/transcription/speech-transcriber.interface';
import { getUploadsDir } from '../src/files/files.constants';

// ClaudeModule зарегистрирован в AppModule и тянет ESM-only SDK (@anthropic-ai/claude-agent-sdk),
// который Jest (CJS) не может распарсить. Мокаем на уровне модуля.
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

describe('Transcription (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;
  let meetingsRepository: MeetingsRepository;
  let filesRepository: FilesRepository;
  let transcriptionService: TranscriptionService;

  const auth = { email: 'transcription-user@example.com', password: 'password123' };
  let token: string;

  let activeCalls = 0;
  let maxActiveCalls = 0;
  let fakeDelayMs = 40;
  let failNextCall = false;

  // Замоканный транскрибатор: возвращает текст по имени входного файла, с задержкой,
  // позволяющей проверять последовательность обработки и провал по требованию.
  const fakeTranscriber: SpeechTranscriber = {
    transcribe: jest.fn(async (inputPath: string) => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, fakeDelayMs));
      activeCalls -= 1;
      if (failNextCall) {
        failNextCall = false;
        throw new Error('mock whisper failure');
      }
      return `text for ${path.basename(inputPath)}`;
    }),
  };

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
    transcriptionService = moduleFixture.get<TranscriptionService>(TranscriptionService);
    await app.init();
  });

  beforeEach(async () => {
    usersRepository.clear();
    meetingsRepository.clear();
    filesRepository.clear();
    await transcriptionService.clear();
    activeCalls = 0;
    maxActiveCalls = 0;
    fakeDelayMs = 40;
    failNextCall = false;
  });

  afterEach(async () => {
    await rm(getUploadsDir(), { recursive: true, force: true });
  });

  afterAll(async () => {
    await app.close();
  });

  async function authToken(): Promise<string> {
    if (!token) {
      const res = await request(app.getHttpServer()).post('/auth/register').send(auth).expect(201);
      token = res.body.access_token as string;
    }
    return token;
  }

  async function createMeeting(name = 'Transcription meeting'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${await authToken()}`)
      .send({ name })
      .expect(201);
    return res.body.id as string;
  }

  async function uploadAudio(
    meetingId: string,
    name = 'sample.mp3',
    contentType = 'audio/mpeg',
  ): Promise<string> {
    const res = await request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files`)
      .set('Authorization', `Bearer ${await authToken()}`)
      .attach('file', Buffer.from('fake audio bytes'), { filename: name, contentType })
      .expect(201);
    return res.body.id as string;
  }

  async function transcribe(meetingId: string, fileId: string, expectedStatus = 201) {
    return request(app.getHttpServer())
      .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
      .set('Authorization', `Bearer ${await authToken()}`)
      .expect(expectedStatus);
  }

  async function getStatus(meetingId: string, fileId: string, expectedStatus = 200) {
    return request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/transcription/status`)
      .set('Authorization', `Bearer ${await authToken()}`)
      .expect(expectedStatus);
  }

  async function getText(meetingId: string, fileId: string, expectedStatus = 200) {
    return request(app.getHttpServer())
      .get(`/meetings/${meetingId}/files/${fileId}/transcription`)
      .set('Authorization', `Bearer ${await authToken()}`)
      .expect(expectedStatus);
  }

  async function waitForStatus(
    meetingId: string,
    fileId: string,
    expected: string,
    timeoutMs = 3000,
  ): Promise<{ status: string; error?: string }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const statusResponse = await getStatus(meetingId, fileId);
      if (statusResponse.body.status === expected) {
        return statusResponse.body as { status: string; error?: string };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    throw new Error(`Timed out waiting for transcription status "${expected}"`);
  }

  describe('POST /meetings/:id/files/:fileId/transcribe', () => {
    it('should reject a request without a token (401)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId);
      return request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files/${fileId}/transcribe`)
        .expect(401);
    });

    it('should enqueue an MP3 file and return queued status (201)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'talk.mp3');

      const res = await transcribe(meetingId, fileId);
      expect(res.body).toEqual({ status: 'queued' });

      await waitForStatus(meetingId, fileId, 'completed');
    });

    it('should return 404 for a non-existent meeting', async () => {
      await transcribe('999999', '999999', 404);
    });

    it('should return 404 for a non-existent file', async () => {
      const meetingId = await createMeeting();
      await transcribe(meetingId, '999999', 404);
    });

    it('should return 404 for a file that belongs to another meeting', async () => {
      const firstMeetingId = await createMeeting('First meeting');
      const secondMeetingId = await createMeeting('Second meeting');
      const fileId = await uploadAudio(firstMeetingId, 'own.mp3');

      await transcribe(secondMeetingId, fileId, 404);
    });

    it('should reject a non-MP3/MP4 file (400)', async () => {
      const meetingId = await createMeeting();
      const notes = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('plain text'), 'notes.txt')
        .expect(201);

      await transcribe(meetingId, notes.body.id as string, 400);
    });

    it('should reject re-running a completed file (409)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'done.mp3');

      await transcribe(meetingId, fileId);
      await waitForStatus(meetingId, fileId, 'completed');

      await transcribe(meetingId, fileId, 409);
    });

    it('should reject re-queueing a file that is already queued/processing (409)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'busy.mp3');
      fakeDelayMs = 250;

      await transcribe(meetingId, fileId);
      await transcribe(meetingId, fileId, 409);

      await waitForStatus(meetingId, fileId, 'completed');
    });

    it('should allow retrying after a failure', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'retry.mp3');
      failNextCall = true;

      await transcribe(meetingId, fileId);
      const failed = await waitForStatus(meetingId, fileId, 'failed');
      expect(failed.error).toBeDefined();

      await transcribe(meetingId, fileId);
      await waitForStatus(meetingId, fileId, 'completed');

      const textResponse = await getText(meetingId, fileId);
      expect(textResponse.body.text).toContain('retry.mp3');
    });
  });

  describe('GET /meetings/:id/files/:fileId/transcription/status', () => {
    it('should reject a request without a token (401)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId);
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/transcription/status`)
        .expect(401);
    });

    it('should return "none" for a file that was never transcribed', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId);

      const res = await getStatus(meetingId, fileId);
      expect(res.body).toEqual({ status: 'none' });
    });

    it('should go through processing and end completed', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'lifecycle.mp3');
      fakeDelayMs = 150;

      await transcribe(meetingId, fileId);

      const processing = await getStatus(meetingId, fileId);
      expect(processing.body.status).toBe('processing');

      const finalStatus = await waitForStatus(meetingId, fileId, 'completed');
      expect(finalStatus.status).toBe('completed');
    });
  });

  describe('GET /meetings/:id/files/:fileId/transcription', () => {
    it('should reject a request without a token (401)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId);
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${fileId}/transcription`)
        .expect(401);
    });

    it('should return the transcript text when completed (200)', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'final.mp3');

      await transcribe(meetingId, fileId);
      await waitForStatus(meetingId, fileId, 'completed');

      const res = await getText(meetingId, fileId);
      expect(res.body.text).toContain('final.mp3');
    });

    it('should return 409 before the transcription is completed', async () => {
      const meetingId = await createMeeting();
      const fileId = await uploadAudio(meetingId, 'pending.mp3');
      fakeDelayMs = 250;

      await transcribe(meetingId, fileId);
      await getText(meetingId, fileId, 409);

      await waitForStatus(meetingId, fileId, 'completed');
    });
  });

  describe('queue order', () => {
    it('should transcribe files one at a time without mixing results', async () => {
      const meetingId = await createMeeting();
      const firstFileId = await uploadAudio(meetingId, 'first.mp3');
      const secondFileId = await uploadAudio(meetingId, 'second.mp3');
      fakeDelayMs = 60;

      await transcribe(meetingId, firstFileId);
      await transcribe(meetingId, secondFileId);

      await waitForStatus(meetingId, firstFileId, 'completed');
      await waitForStatus(meetingId, secondFileId, 'completed');

      const firstText = await getText(meetingId, firstFileId);
      const secondText = await getText(meetingId, secondFileId);

      expect(firstText.body.text).toContain('first.mp3');
      expect(firstText.body.text).not.toContain('second.mp3');
      expect(secondText.body.text).toContain('second.mp3');
      expect(secondText.body.text).not.toContain('first.mp3');
      expect(maxActiveCalls).toBe(1);
    });
  });
});
