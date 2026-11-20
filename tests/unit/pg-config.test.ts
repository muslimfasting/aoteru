import { parse } from 'pg-connection-string';
import { describe, expect, it } from 'vitest';
import { pgConfig } from '@/server/pg-config';

const CA = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

describe('database connection options', () => {
  it('leaves a local connection string without ssl untouched', () => {
    const url = 'postgres://aoteru:aoteru@127.0.0.1:5432/aoteru';
    expect(pgConfig(url, {})).toEqual({ connectionString: url });
    expect(parse(pgConfig(url, {}).connectionString!).ssl).toBeUndefined();
  });

  it('gives sslmode=require its libpq meaning: encrypted, chain not verified', () => {
    const cfg = pgConfig('postgres://u:p%40ss@db.example.com:6543/postgres?sslmode=require&supa=base-pooler.x', {});
    const parsed = parse(cfg.connectionString!);
    expect(parsed.ssl).toEqual({ rejectUnauthorized: false });
    expect(parsed.password).toBe('p@ss');
    expect(parsed.port).toBe('6543');
  });

  it('keeps verification for sslmode=verify-full', () => {
    const parsed = parse(pgConfig('postgres://u:p@db.example.com/postgres?sslmode=verify-full', {}).connectionString!);
    expect(parsed.ssl).not.toEqual({ rejectUnauthorized: false });
    expect(parsed.ssl).toBeTruthy();
  });

  it('verifies against a provided CA certificate whatever the string says', () => {
    const cfg = pgConfig('postgres://u:p@db.example.com/postgres?sslmode=require', { DATABASE_CA_CERT: CA.replace(/\n/g, '\\n') });
    expect(cfg.ssl).toEqual({ ca: CA, rejectUnauthorized: true });
    expect(cfg.connectionString).not.toContain('sslmode');
    expect(parse(cfg.connectionString!).ssl).toBeUndefined();
  });
});
