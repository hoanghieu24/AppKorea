import app from './app.js';
import { config } from './config.js';
import { closePool } from './db.js';

const server = app.listen(config.port, () => {
  console.log(`HanQuoc Classroom API listening on port ${config.port} (${config.nodeEnv}).`);
});

server.keepAliveTimeout = 65_000;
server.headersTimeout = 66_000;
server.requestTimeout = 70_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: closing HTTP server...`);

  const forceTimer = setTimeout(() => {
    console.error('Graceful shutdown timed out; exiting.');
    process.exit(1);
  }, 12_000);
  forceTimer.unref();

  server.close(async (error) => {
    try {
      await closePool();
    } catch (dbError) {
      console.error('Failed to close DB pool:', dbError?.message || dbError);
    }
    clearTimeout(forceTimer);
    process.exit(error ? 1 : 0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason instanceof Error ? reason.message : String(reason));
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error?.message || error);
  shutdown('uncaughtException');
});
