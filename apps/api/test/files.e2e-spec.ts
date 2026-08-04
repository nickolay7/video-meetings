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

  describe('GET /meetings/:id/files', () => {
    it('should reject a request without a token (401)', async () => {
      const meetingId = await createMeeting();
      return request(app.getHttpServer()).get(`/meetings/${meetingId}/files`).expect(401);
    });

    it('should return an empty list for a meeting without files', async () => {
      const meetingId = await createMeeting();
      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('should return uploaded files with metadata', async () => {
      const meetingId = await createMeeting();
      const body = Buffer.from('hello list content', 'utf8');

      const upload = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', body, 'list.txt')
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        id: upload.body.id,
        meetingId,
        originalName: 'list.txt',
        size: body.length,
      });
      expect(res.body[0]).toHaveProperty('mimeType');
      expect(res.body[0]).toHaveProperty('storedName');
      expect(new Date(res.body[0].uploadedAt).getTime()).not.toBeNaN();
    });

    it('should only list files of the requested meeting', async () => {
      const firstMeetingId = await createMeeting('First meeting');
      const secondMeetingId = await createMeeting('Second meeting');

      await request(app.getHttpServer())
        .post(`/meetings/${firstMeetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('first', 'utf8'), 'a.txt')
        .expect(201);
      await request(app.getHttpServer())
        .post(`/meetings/${secondMeetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from('second', 'utf8'), 'b.txt')
        .expect(201);

      const first = await request(app.getHttpServer())
        .get(`/meetings/${firstMeetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(200);
      const second = await request(app.getHttpServer())
        .get(`/meetings/${secondMeetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(200);

      expect(first.body.map((f: { originalName: string }) => f.originalName)).toEqual(['a.txt']);
      expect(second.body.map((f: { originalName: string }) => f.originalName)).toEqual(['b.txt']);
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .get('/meetings/999999/files')
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(404);
    });
  });

  describe('GET /meetings/:id/files/:fileId/download', () => {
    async function uploadFile(
      meetingId: string,
      content: string,
      name: string,
    ): Promise<{ id: string; storedName: string }> {
      const res = await request(app.getHttpServer())
        .post(`/meetings/${meetingId}/files`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .attach('file', Buffer.from(content, 'utf8'), name)
        .expect(201);
      return { id: res.body.id as string, storedName: res.body.storedName as string };
    }

    it('should reject a request without a token (401)', async () => {
      const meetingId = await createMeeting();
      const { id } = await uploadFile(meetingId, 'secret', 's.txt');
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${id}/download`)
        .expect(401);
    });

    it('should return the file content with the original name', async () => {
      const meetingId = await createMeeting();
      const content = 'the download payload';
      const { id } = await uploadFile(meetingId, content, 'payload.txt');

      const res = await request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/${id}/download`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.body.toString('utf8')).toBe(content);
      expect(res.headers['content-disposition']).toContain('filename="payload.txt"');
      expect(res.headers['content-type']).toBeDefined();
    });

    it('should return 404 for a non-existent file', async () => {
      const meetingId = await createMeeting();
      return request(app.getHttpServer())
        .get(`/meetings/${meetingId}/files/999999/download`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(404);
    });

    it('should return 404 for a file that belongs to another meeting', async () => {
      const firstMeetingId = await createMeeting('First meeting');
      const secondMeetingId = await createMeeting('Second meeting');
      const { id } = await uploadFile(firstMeetingId, 'belongs to first', 'own.txt');

      return request(app.getHttpServer())
        .get(`/meetings/${secondMeetingId}/files/${id}/download`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(404);
    });

    it('should return 404 for a non-existent meeting', async () => {
      return request(app.getHttpServer())
        .get('/meetings/999999/files/999999/download')
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(404);
    });
  });
});
