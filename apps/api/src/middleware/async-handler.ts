import type { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>;

/**
 * Adapts an async route handler into a synchronous Express `RequestHandler`.
 *
 * Express 4 ignores the promise returned by an `async` handler, so a rejection
 * becomes an unhandled rejection rather than reaching the error middleware.
 * Wrapping forwards any rejection to `next`. Handlers that already try/catch
 * internally keep working unchanged — this is just a type-correct safety net.
 */
export function asyncHandler(fn: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
