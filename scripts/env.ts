/** Load .env.local / .env for stand-alone scripts. Variables already in the environment win. */
export function loadEnv(): void {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file);
    } catch {
      // File not present: fine, the environment may already be configured (as on Vercel).
    }
  }
}
