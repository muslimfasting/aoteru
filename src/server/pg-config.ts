import type { ClientConfig } from 'pg';

/**
 * Turn a PostgreSQL connection string into driver options.
 *
 * `sslmode` is given its standard libpq meaning: `require` encrypts the
 * connection without verifying the certificate chain, `verify-full` verifies
 * it. Hosted providers hand out `sslmode=require` strings, and some (Supabase)
 * sign their servers with their own CA, which a stricter reading would reject.
 *
 * To verify such a provider's certificate, put its CA certificate (PEM) in
 * DATABASE_CA_CERT: the connection is then always verified against that CA.
 */
export function pgConfig(connectionString: string, env: Record<string, string | undefined> = process.env): ClientConfig {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return { connectionString };
  }
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  if (ca && ca.includes('BEGIN CERTIFICATE')) {
    // Options in the connection string win over explicit ones, so take the ssl switches out of it.
    for (const key of ['sslmode', 'ssl', 'sslrootcert', 'uselibpqcompat']) url.searchParams.delete(key);
    return { connectionString: url.toString(), ssl: { ca, rejectUnauthorized: true } };
  }
  if (url.searchParams.has('sslmode') && !url.searchParams.has('uselibpqcompat')) {
    url.searchParams.set('uselibpqcompat', 'true');
  }
  return { connectionString: url.toString() };
}
