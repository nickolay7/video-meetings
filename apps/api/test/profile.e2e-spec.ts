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
});
