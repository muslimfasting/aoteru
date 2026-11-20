/**
 * Stand-alone world simulation worker for self-hosted deployments and local
 * development: `npm run worker`. It runs the same engine as the cron endpoint
 * and the on-request catch-up, once a second, so timers fire on time even when
 * nobody is playing. Any number of workers may run; the world lock lets only
 * one advance the world at a time.
 */
import { loadEnv } from './env';

loadEnv();

async function main(): Promise<void> {
  const { advanceWorld } = await import('../src/server/advance');
  const { closePool } = await import('../src/server/db');
  let running = true;
  const stop = () => {
    running = false;
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  console.log('[worker] world simulation worker started');
  while (running) {
    try {
      const result = await advanceWorld({ budgetMs: 10_000, blocking: false });
      if (result.steps > 0) console.log(`[worker] ${new Date().toISOString()} processed ${result.steps} step(s) (${result.status})`);
    } catch (err) {
      console.error('[worker] step failed; retrying in 5s', err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 5000));
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await closePool();
  console.log('[worker] stopped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
