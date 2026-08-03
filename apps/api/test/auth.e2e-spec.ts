import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { UsersRepository } from '../src/users/users.repository';

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let usersRepository: UsersRepository;

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

  describe('/auth/register (POST)', () => {
    const validEmail = 'test@example.com';
    const validPassword = 'password123';

    it('should register a new user and return JWT token', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: validEmail, password: validPassword })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
          expect(typeof res.body.access_token).toBe('string');
          expect(res.body.access_token.length).toBeGreaterThan(0);
        });
    });

    it('should not allow duplicate registration with same email', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: validEmail, password: validPassword })
        .expect(201);

      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: validEmail, password: validPassword })
        .expect(409);
    });

    it('should fail when email is missing', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ password: validPassword })
        .expect(400);
    });

    it('should fail when password is missing', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: validEmail })
        .expect(400);
    });

    it('should fail when email format is invalid', () => {
      return request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: validPassword })
        .expect(400);
    });

    it('should fail when both email and password are missing', () => {
      return request(app.getHttpServer()).post('/auth/register').send({}).expect(400);
    });
  });

  describe('/auth/login (POST)', () => {
    const userEmail = 'login-test@example.com';
    const userPassword = 'password123';

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: userEmail, password: userPassword });
    });

    it('should login existing user and return JWT token', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: userPassword })
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveProperty('access_token');
          expect(typeof res.body.access_token).toBe('string');
          expect(res.body.access_token.length).toBeGreaterThan(0);
        });
    });

    it('should fail with wrong password', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail, password: 'wrong-password' })
        .expect(401);
    });

    it('should fail with non-existent email', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'nonexistent@example.com', password: userPassword })
        .expect(401);
    });

    it('should fail when email is missing', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ password: userPassword })
        .expect(400);
    });

    it('should fail when password is missing', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: userEmail })
        .expect(400);
    });

    it('should fail when email format is invalid', () => {
      return request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'not-an-email', password: userPassword })
        .expect(400);
    });

    it('should fail when both email and password are missing', () => {
      return request(app.getHttpServer()).post('/auth/login').send({}).expect(400);
    });
  });
});
