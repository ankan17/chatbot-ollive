import type { ErrorRequestHandler } from 'express';
import type { Logger } from './logger.js';

export type ErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'not_found'
  | 'login_required'
  | 'internal_error';

const STATUS_MAP: Record<ErrorCode, number> = {
  validation_error: 400,
  unauthorized: 401,
  not_found: 404,
  login_required: 403,
  internal_error: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown, status?: number) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status ?? STATUS_MAP[code];
    this.details = details;
  }
}

export function errorHandler(logger: Logger): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof AppError) {
      logger.warn({ code: err.code, message: err.message }, 'app error');
      const body: Record<string, unknown> = { error: err.code };
      if (err.details !== undefined) body['details'] = err.details;
      res.status(err.status).json(body);
    } else {
      logger.error({ err }, 'unhandled error');
      res.status(500).json({ error: 'internal_error' });
    }
  };
}
