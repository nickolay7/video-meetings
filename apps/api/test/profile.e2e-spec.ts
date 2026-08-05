import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { rm, readFile, readdir } from 'fs/promises';
import * as path from 'path';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { getAvatarsDir, MAX_AVATAR_SIZE } from '../src/profile/profile.constants';

describe('Profile (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;

  const password = 'password123';
  // Минимальный корректный PNG (1×1); валидация типа идёт по магическим байтам.
  const validPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNgYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    usersRepository = moduleFixture.get<UsersRepository>(UsersRepository);
    await app.init();
  });

  beforeEach(async () => {
    await usersRepository.clear();
    // Чистим каталог аватаров, чтобы тесты не зависели от файлов предыдущих запусков.
    await rm(getAvatarsDir(), { recursive: true, force: true });
  });

  afterAll(async () => {
    await app.close();
  });

  async function registerAndGetToken(email: string, name?: string): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password, name })
      .expect(201);
    return res.body.access_token as string;
  }

  describe('/profile (GET)', () => {
    it('should return the profile of the authenticated user (id, email, name)', async () => {
      const token = await registerAndGetToken('named@example.com', 'Alice');

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.id).toEqual(expect.any(String));
          expect(res.body.email).toBe('named@example.com');
          expect(res.body.name).toBe('Alice');
        });
    });

    it('should omit name when the user registered without one', async () => {
      const token = await registerAndGetToken('unnamed@example.com');

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe('unnamed@example.com');
          expect(res.body.name).toBeUndefined();
        });
    });

    it('should return 404 when the authenticated user no longer exists', async () => {
      const token = await registerAndGetToken('gone@example.com');
      await usersRepository.clear();

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).get('/profile').expect(401);
    });

    it('should reject a request with an invalid token (401)', () => {
      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });

  describe('/profile (PATCH)', () => {
    it('should update the name and return the updated profile', async () => {
      const token = await registerAndGetToken('patch@example.com', 'Alice');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bob' })
        .expect(200)
        .expect((res) => {
          expect(res.body.email).toBe('patch@example.com');
          expect(res.body.name).toBe('Bob');
        });
    });

    it('should persist the updated name (visible via GET /profile)', async () => {
      const token = await registerAndGetToken('persist@example.com');

      await request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Charlie' })
        .expect(200);

      return request(app.getHttpServer())
        .get('/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Charlie');
        });
    });

    it('should clear the name when an empty string is sent', async () => {
      const token = await registerAndGetToken('clear@example.com', 'Alice');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBeUndefined();
        });
    });

    it('should treat a whitespace-only name as no name', async () => {
      const token = await registerAndGetToken('ws-clear@example.com', 'Alice');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '   ' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBeUndefined();
        });
    });

    it('should trim a non-empty name', async () => {
      const token = await registerAndGetToken('ws-trim@example.com', 'Alice');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: '  Bob  ' })
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe('Bob');
        });
    });

    it('should reject a non-string name (400)', async () => {
      const token = await registerAndGetToken('bad-name@example.com');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 123 })
        .expect(400);
    });

    it('should reject a body without name (400)', async () => {
      const token = await registerAndGetToken('no-name@example.com');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(400);
    });

    it('should reject unknown fields (400)', async () => {
      const token = await registerAndGetToken('extra@example.com');

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Dave', email: 'hacked@example.com' })
        .expect(400);
    });

    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).patch('/profile').send({ name: 'Bob' }).expect(401);
    });

    it('should return 404 when the authenticated user no longer exists', async () => {
      const token = await registerAndGetToken('gone-patch@example.com');
      await usersRepository.clear();

      return request(app.getHttpServer())
        .patch('/profile')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bob' })
        .expect(404);
    });
  });

  describe('/profile/avatar (POST)', () => {
    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).post('/profile/avatar').expect(401);
    });

    it('should save an image avatar to disk and return the profile (201)', async () => {
      const token = await registerAndGetToken('avatar@example.com', 'Alice');

      const res = await request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', validPng, 'avatar.png')
        .expect(201);

      expect(res.body.email).toBe('avatar@example.com');
      expect(res.body.name).toBe('Alice');

      const user = await usersRepository.findByEmail('avatar@example.com');
      expect(user).toBeDefined();
      expect(user!.avatarMimeType).toBe('image/png');

      const stored = await readFile(path.join(getAvatarsDir(), user!.id, 'avatar'));
      expect(stored.equals(validPng)).toBe(true);
    });

    it('should reject a non-image file (400)', async () => {
      const token = await registerAndGetToken('not-image@example.com');

      return request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('hello, not an image', 'utf8'), 'file.txt')
        .expect(400);
    });

    it('should reject a file larger than 5 MB (413)', async () => {
      const token = await registerAndGetToken('big-avatar@example.com');
      const big = Buffer.alloc(MAX_AVATAR_SIZE + 1);
      big.write('x', MAX_AVATAR_SIZE);

      return request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', big, 'big.png')
        .expect(413);
    });

    it('should replace the previous avatar on re-upload', async () => {
      const token = await registerAndGetToken('replace-avatar@example.com');
      const second = Buffer.concat([validPng, Buffer.from('x')]); // другой размер, но валидный PNG

      await request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', validPng, 'a.png')
        .expect(201);

      await request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', second, 'b.png')
        .expect(201);

      const user = await usersRepository.findByEmail('replace-avatar@example.com');
      const files = await readdir(path.join(getAvatarsDir(), user!.id));
      expect(files).toEqual(['avatar']);
      const stored = await readFile(path.join(getAvatarsDir(), user!.id, 'avatar'));
      expect(stored.equals(second)).toBe(true);
    });

    it('should return 404 when the authenticated user no longer exists', async () => {
      const token = await registerAndGetToken('gone-avatar@example.com');
      await usersRepository.clear();

      return request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', validPng, 'a.png')
        .expect(404);
    });
  });

  describe('/profile/avatar (GET)', () => {
    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).get('/profile/avatar').expect(401);
    });

    it('should return 404 when the avatar is not uploaded', async () => {
      const token = await registerAndGetToken('no-avatar@example.com');

      return request(app.getHttpServer())
        .get('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return the uploaded avatar bytes with the image content type', async () => {
      const token = await registerAndGetToken('get-avatar@example.com');

      await request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', validPng, 'avatar.png')
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toBe('image/png');
      expect(Buffer.isBuffer(res.body)).toBe(true);
      expect(res.body.equals(validPng)).toBe(true);
    });

    it('should return 404 when the avatar file is missing on disk', async () => {
      const token = await registerAndGetToken('orphan-avatar@example.com');

      await request(app.getHttpServer())
        .post('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .attach('file', validPng, 'avatar.png')
        .expect(201);

      const user = await usersRepository.findByEmail('orphan-avatar@example.com');
      await rm(path.join(getAvatarsDir(), user!.id), { recursive: true, force: true });

      return request(app.getHttpServer())
        .get('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('should return 404 when the authenticated user no longer exists', async () => {
      const token = await registerAndGetToken('gone-avatar-get@example.com');
      await usersRepository.clear();

      return request(app.getHttpServer())
        .get('/profile/avatar')
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });
  });

  describe('/profile/password (POST)', () => {
    const newPassword = 'new-password-1';

    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).post('/profile/password').send({}).expect(401);
    });

    it('should change the password and allow login with the new one (200)', async () => {
      const email = 'pw-change@example.com';
      const token = await registerAndGetToken(email);

      await request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: password, newPassword })
        .expect(200);

      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: newPassword })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
        });

      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(401);
    });

    it('should reject a wrong old password and keep the old one (400)', async () => {
      const email = 'pw-wrong@example.com';
      const token = await registerAndGetToken(email);

      await request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: 'wrong-old-password', newPassword })
        .expect(400);

      await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(200);
    });

    it('should reject a short new password (400)', async () => {
      const token = await registerAndGetToken('pw-short@example.com');

      return request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: password, newPassword: 'short' })
        .expect(400);
    });

    it('should reject missing fields (400)', async () => {
      const token = await registerAndGetToken('pw-missing@example.com');

      await request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword })
        .expect(400);

      return request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: password })
        .expect(400);
    });

    it('should reject unknown fields (400)', async () => {
      const token = await registerAndGetToken('pw-extra@example.com');

      return request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: password, newPassword, email: 'hack@example.com' })
        .expect(400);
    });

    it('should return 404 when the authenticated user no longer exists', async () => {
      const token = await registerAndGetToken('gone-pw@example.com');
      await usersRepository.clear();

      return request(app.getHttpServer())
        .post('/profile/password')
        .set('Authorization', `Bearer ${token}`)
        .send({ oldPassword: password, newPassword })
        .expect(404);
    });
  });
});
