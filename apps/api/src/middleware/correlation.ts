import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

// Augment Express Request to carry the correlation id
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

export function correlationId(): RequestHandler {
  return (req, res, next) => {
    const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
    req.requestId = id;
    res.setHeader('x-request-id', id);
    next();
  };
}
