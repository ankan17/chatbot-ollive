import type { RequestHandler } from 'express';
import { AppError } from '../errors.js';

/**
 * Validates `Authorization: Bearer <token>` against the configured ingestion API key.
 * AU5 — service-to-service bearer token.
 */
export function ingestionAuth(apiKey: string): RequestHandler {
  return (req, _res, next) => {
    const header = req.headers['authorization'] ?? '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match || match[1] !== apiKey) {
      return next(new AppError('unauthorized', 'Invalid or missing Authorization header'));
    }
    next();
  };
}
