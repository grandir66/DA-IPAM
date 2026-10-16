/**
 * Token effimero firmato (HMAC-SHA256) per autorizzare l'apertura di una
 * sessione SSH interattiva via WebSocket. Emesso da un'API autenticata
 * (requireAdmin + tenant); il WebSocket handler in server.ts lo verifica senza
 * dover decodificare il cookie NextAuth. Host-bound + scadenza breve.
 */
import { createHmac, timingSafeEqual } from "crypto";

function secret(): string {
  return process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.ENCRYPTION_KEY || "";
}

export interface SshTokenPayload {
  hostId: number;
  tenantCode: string;
  userId: number;
  exp: number; // epoch ms
}

/** Firma un token con TTL breve (default 60s, il tempo per aprire il WS). */
export function signSshToken(
  p: Omit<SshTokenPayload, "exp">,
  ttlMs = 60_000,
): string {
  const payload: SshTokenPayload = { ...p, exp: Date.now() + ttlMs };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifySshToken(token: string): SshTokenPayload | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as SshTokenPayload;
    if (
      typeof p.hostId !== "number" ||
      typeof p.tenantCode !== "string" ||
      typeof p.exp !== "number" ||
      Date.now() > p.exp
    ) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}
