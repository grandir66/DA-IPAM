import { NextResponse } from "next/server";
import { getCredentialById, getCredentialCommunityString } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";

const TEST_TIMEOUT_MS = 25000;

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Timeout: nessuna risposta entro ${ms / 1000} secondi`)), ms)
  );
  return Promise.race([p, timeout]);
}

/** Test connessione credenziale su host specificato. POST body: { host: string, port?: number } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminCheck = await requireAdmin();
    if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const cred = getCredentialById(Number(id));
    if (!cred) {
      return NextResponse.json({ success: false, error: "Credenziale non trovata" }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const host = typeof body.host === "string" ? body.host.trim() : "";
    if (!host) {
      return NextResponse.json({ success: false, error: "Indirizzo IP o hostname richiesto" }, { status: 400 });
    }

    const type = String(cred.credential_type || "").toLowerCase();

    if (type === "snmp") {
      const community = getCredentialCommunityString(Number(id));
      if (!community) {
        return NextResponse.json({ success: false, error: "Community string mancante" });
      }
      try {
        const snmp = await import("net-snmp");
        const port = typeof body.port === "number" ? body.port : 161;
        const session = snmp.createSession(host, community, { port, timeout: 8000 });
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            session.get(["1.3.6.1.2.1.1.1.0"], (err: Error | null) => {
              session.close();
              if (err) reject(err);
              else resolve();
            });
          }),
          TEST_TIMEOUT_MS
        );
        return NextResponse.json({ success: true, message: "Connessione SNMP riuscita" });
      } catch (e) {
        return NextResponse.json({
          success: false,
          error: e instanceof Error ? e.message : "Connessione SNMP fallita",
        });
      }
    }

    if (type === "ssh" || type === "linux") {
      const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
      const password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
      if (!username || !password) {
        return NextResponse.json({ success: false, error: "Username e password richiesti" });
      }
      try {
        const { Client } = await import("ssh2");
        const port = typeof body.port === "number" ? body.port : 22;
        await withTimeout(
          new Promise<void>((resolve, reject) => {
            const conn = new Client();
            conn.on("ready", () => {
              conn.end();
              resolve();
            });
            conn.on("error", reject);
            conn.connect({
              host,
              port,
              username,
              password,
              readyTimeout: 15000,
            });
          }),
          TEST_TIMEOUT_MS
        );
        return NextResponse.json({ success: true, message: "Connessione SSH riuscita" });
      } catch (e) {
        return NextResponse.json({
          success: false,
          error: e instanceof Error ? e.message : "Connessione SSH fallita",
        });
      }
    }

    if (type === "windows") {
      const username = cred.encrypted_username ? decrypt(cred.encrypted_username) : "";
      const password = cred.encrypted_password ? decrypt(cred.encrypted_password) : "";
      if (!username || !password) {
        return NextResponse.json({ success: false, error: "Username e password richiesti" });
      }
      try {
        const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
        const port = typeof body.port === "number" ? body.port : 5985;
        await withTimeout(
          runWinrmCommand(host, port, username, password, "echo test", false),
          TEST_TIMEOUT_MS
        );
        return NextResponse.json({ success: true, message: "Connessione WinRM riuscita" });
      } catch (e) {
        return NextResponse.json({
          success: false,
          error: e instanceof Error ? e.message : "Connessione WinRM fallita.",
        });
      }
    }

    if (type === "api") {
      return NextResponse.json({
        success: false,
        error: "Il test per credenziali API va effettuato dal dispositivo (es. Proxmox, Omada).",
      });
    }

    return NextResponse.json({ success: false, error: `Tipo credenziale "${cred.credential_type}" non supportato per il test` });
  } catch (error) {
    console.error("Credential test error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Errore nel test" },
      { status: 500 }
    );
  }
}
