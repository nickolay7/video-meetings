import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';
import { MeetingsRepository } from '../src/meetings/meetings.repository';

describe('Meetings (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;
  let meetingsRepository: MeetingsRepository;

  const auth = { email: 'meeting-user@example.com', password: 'password123' };
  let token: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }));
    usersRepository = moduleFixture.get<UsersRepository>(UsersRepository);
    meetingsRepository = moduleFixture.get<MeetingsRepository>(MeetingsRepository);
    await app.init();
  });

  beforeEach(async () => {
    // Reset the users repo each test so registration never conflicts; a signed
    // JWT stays valid regardless of the repo state, so the cached token is safe.
    usersRepository.clear();
  });

  afterEach(async () => {
    meetingsRepository.clear();
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

  describe('/meetings (POST)', () => {
    it('should create a meeting and return it with a generated id (201)', async () => {
      return request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${await authToken()}`)
        .send({ name: 'Status sync' })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.name).toBe('Status sync');
        });
    });

    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).post('/meetings').send({ name: 'X' }).expect(401);
    });

    it('should reject a request with an invalid token (401)', async () => {
      return request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', 'Bearer not-a-real-token')
        .send({ name: 'X' })
        .expect(401);
    });

    it('should fail when name is missing (400)', async () => {
      return request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${await authToken()}`)
        .send({})
        .expect(400);
    });

    it('should fail when name is empty (400)', async () => {
      return request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${await authToken()}`)
        .send({ name: '' })
        .expect(400);
    });
  });

  describe('/meetings (GET)', () => {
    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).get('/meetings').expect(401);
    });

    it('should return an empty list when no meetings exist (200)', async () => {
      return request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body).toHaveLength(0);
        });
    });

    it('should return all created meetings (200)', async () => {
      const token = await authToken();
      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'One' })
        .expect(201);
      await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Two' })
        .expect(201);

      return request(app.getHttpServer())
        .get('/meetings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(2);
          const names = res.body.map((m: { name: string }) => m.name);
          expect(names).toEqual(expect.arrayContaining(['One', 'Two']));
        });
    });
  });

  describe('/meetings/:id (GET)', () => {
    it('should reject a request without a token (401)', () => {
      return request(app.getHttpServer()).get('/meetings/1').expect(401);
    });

    it('should return a meeting by id (200)', async () => {
      const created = await request(app.getHttpServer())
        .post('/meetings')
        .set('Authorization', `Bearer ${await authToken()}`)
        .send({ name: 'By id' })
        .expect(201);
      const id = created.body.id as string;

      return request(app.getHttpServer())
        .get(`/meetings/${id}`)
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.id).toBe(id);
          expect(res.body.name).toBe('By id');
        });
    });

    it('should return 404 for a non-existent meeting id', async () => {
      return request(app.getHttpServer())
        .get('/meetings/999999')
        .set('Authorization', `Bearer ${await authToken()}`)
        .expect(404);
    });
  });
});
