import { Logger } from '@nestjs/common';
import { createApp, loadEnv } from './bootstrap';

async function bootstrap(): Promise<void> {
  loadEnv();
  const app = await createApp();
  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
  new Logger('Bootstrap').log(`API ready: http://localhost:${port}  (docs: /docs, graphql: /graphql)`);
}

bootstrap().catch((e) => {
  console.error(e);
  process.exit(1);
});
