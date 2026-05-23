import pino from 'pino';

export function createLogger() {
  return pino({
    level: process.env['LOG_LEVEL'] ?? 'info',
    base: { service: 'ollive-api' },
  });
}

export type Logger = ReturnType<typeof createLogger>;
