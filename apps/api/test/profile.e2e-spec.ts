import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';

describe('Profile (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;

  const password = 'password123';

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
});
