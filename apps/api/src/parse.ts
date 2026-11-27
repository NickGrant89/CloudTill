import type { Response } from "express";
import { z, type ZodTypeAny } from "zod";

/** Safe Zod parse — returns null and sends 400 instead of throwing (throws crash Express 4 async routes). */
export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown, res: Response): z.infer<T> | null {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    res.status(400).json({ error: "Validation error", details: parsed.error.flatten() });
    return null;
  }
  return parsed.data;
}