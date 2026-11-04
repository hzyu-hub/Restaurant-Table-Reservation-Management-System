import 'dotenv/config';
import { createApp } from './app.js';
import { connectToDatabase, disconnectFromDatabase } from './db.js';

const DEFAULT_PORT = 4000;

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (uri === undefined || uri.length === 0) {
    console.error(
      '[server] MONGODB_URI is not set. Copy server/.env.example to server/.env and set your Atlas connection string.',
    );
    process.exitCode = 1;
    return;
  }

  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  await connectToDatabase(uri);
  console.log('[server] connected to MongoDB');

  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[server] listening on http://localhost:${port}`);
  });

  const shutdown = (signal: string): void => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(() => {
      void disconnectFromDatabase().finally(() => {
        process.exit(0);
      });
    });
  };

  process.on('SIGINT', () => {
    shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    shutdown('SIGTERM');
  });
}

main().catch((error: unknown) => {
  console.error('[server] failed to start:', error);
  process.exitCode = 1;
});
