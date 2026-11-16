import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import type { Role } from "@cloudtill/shared";

const JWT_SECRET = process.env.JWT_SECRET || "cloudtill-dev-secret";

export interface JwtPayload {
  sub: string;
  storeId: string;
  role: Role;
  name: string;
  email: string;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "12h" });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, JWT_SECRET) as JwtPayload;
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 8);
}

export async function checkPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export interface AuthedRequest extends Request {
  user?: JwtPayload;
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role === "owner") return next();
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
