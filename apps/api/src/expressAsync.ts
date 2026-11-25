import type { NextFunction, Request, RequestHandler, Response, Router } from "express";

/** Wrap a handler so sync throws and async rejections reach Express error middleware (Express 4 default). */
function wrapHandler(fn: RequestHandler): RequestHandler {
  if (fn.length >= 4) return fn;
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res, next);
      if (result !== undefined && result !== null && typeof (result as Promise<unknown>).then === "function") {
        (result as Promise<unknown>).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

export function installAsyncHandlers(router: Router) {
  for (const layer of router.stack) {
    if (layer.route) {
      for (const routeLayer of layer.route.stack) {
        routeLayer.handle = wrapHandler(routeLayer.handle);
      }
      continue;
    }
    const handle = layer.handle as Router & { stack?: Router["stack"] };
    if (handle?.stack?.length) installAsyncHandlers(handle);
  }
}