import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { rm, readdir, readFile } from 'fs/promises';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';
import { FilesRepository } from '../src/files/files.repository';
import { getUploadsDir, MAX_FILE_SIZE } from '../src/files/files.constants';

describe('Files (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;
  let meetingsRepository: MeetingsRepository;
  let filesRepository: FilesRepository;

  const auth = { email: 'files-user@example.com', password: 'password123' };
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    usersRepository = moduleFixture.get<UsersRepository>(UsersRepository);
    meetingsRepository = moduleFixture.get<MeetingsRepository>(MeetingsRepository);
    filesRepository = moduleFixture.get<FilesRepository>(FilesRepository);
    await app.init();
  });

  beforeEach(async () => {
    usersRepository.clear();
    meetingsRepository.clear();
    filesRepository.clear();
  });

  afterEach(async () => {
    // Удаляем файлы, записанные на диск во время теста.
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

  async function createMeeting(name = 'Upload meeting'): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/meetings')
      .set('Authorization', `Bearer ${await authToken()}`)
      .send({ name })
      .expect(201);
    return res.body.id as string;
  }

  describe('POST /meetings/:id/files', () => {
    it('should reject a request without a token (401)', async () => {
      const meetingId = await createMeeting();
      return request(app.getHttpServer()).post(`/meetings/${meetingId}/files`).expect(401);
    });

    it('should save a file to disk and return metadata (201)', async () => {
      const meetingId = await createMeeting();
      const body = Buffer.from('hello file content', 'utf8');

      const res = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', body, 'notes.txt')
        .expect(201);

      expect(res.body.meetingId).toBe(meetingId);
      expect(res.body.originalName).toBe('notes.txt');
      expect(res.body.size).toBe(body.length);
      expect(res.body.mimeType).toBeDefined();
      expect(res.body.storedName).toContain('notes.txt');
      expect(res.body).toHaveProperty('id');

      const storedBody = await readFile(path.join(getUploadsDir(), meetingId, res.body.storedName));
      expect(storedBody.equals(body)).toBe(true);
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .post('/meetings/999999/files')
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('x'), 'x.txt')
        .expect(404);
    });

    it('should reject a file larger than 20 MB (413)', async () => {
      const meetingId = await createMeeting();
      const big = Buffer.alloc(MAX_FILE_SIZE + 1); // 20 МБ + 1 байт
      big.write('x', MAX_FILE_SIZE);

      await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', big, 'big.bin')
        .expect(413);
    });

    it('should keep both files when uploading two with the same name', async () => {
      const meetingId = await createMeeting();

      const first = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('v1', 'utf8'), 'same.txt')
        .expect(201);

      const second = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('v2', 'utf8'), 'same.txt')
        .expect(201);

      expect(second.body.originalName).toBe('same.txt');
      expect(second.body.storedName).not.toBe(first.body.storedName);

      const files = await readdir(path.join(getUploadsDir(), meetingId));
      expect(files.length).toBe(2);
    });

    it('should strip path segments from the uploaded filename', async () => {
      const meetingId = await createMeeting();
      const res = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('x', 'utf8'), '../../evil.txt')
        .expect(201);

      expect(res.body.originalName).toBe('evil.txt');
      expect(res.body.originalName).not.toContain('/');
      expect(res.body.originalName).not.toContain('..');
    });
  });
});
