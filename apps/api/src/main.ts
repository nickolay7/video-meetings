import { createApp } from './app.factory';

async function bootstrap() {
  const port = process.env.PORT ?? 3001;
  const app = await createApp();
  await app.listen(port);
  console.log(`API запущен на http://localhost:${port}`);
}

void bootstrap();
