/** A rule of the game (or of the API) said no. Sent to the client as `{ error: { code, message } }`. */
export class GameError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'GameError';
  }
}

export const notFound = (what: string) => new GameError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (message: string) => new GameError('FORBIDDEN', message, 403);
export const conflict = (code: string, message: string) => new GameError(code, message, 409);
export const invalid = (message: string) => new GameError('INVALID', message, 400);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(value: unknown, what: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw invalid(`Invalid ${what}`);
  return value;
}
