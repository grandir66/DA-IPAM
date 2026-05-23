import { NextResponse } from "next/server";
import { getCredentialById, getCredentialCommunityString, getHostByIp, setHostCredentialValidatedByKey } from "@/lib/db";
import { safeDecrypt } from "@/lib/crypto";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";

const TEST_TIMEOUT_MS = 25000;

/** Memorizza che (credenziale, protocollo, porta) funziona contro l'host con quell'IP.
 * Best-effort: se l'host non esiste in DB (test estemporaneo) o l'upsert fallisce, ignora. */
function persistValidatedBinding(
  ip: string,
  credentialId: number,
  protocolType: "ssh" | "snmp" | "winrm" | "api",
  port: number
): void {
  try {
    const host = getHostByIp(ip);
    if (!host?.id) return;
    setHostCredentialValidatedByKey(host.id, credentialId, protocolType, port, { auto_detected: false });
  } catch (e) {
    console.warn("[credentials/test] persistValidatedBinding failed:", e);
  }
}

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
  return withTenantFromSession(async () => {
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
          persistValidatedBinding(host, Number(id), "snmp", port);
          return NextResponse.json({ success: true, message: "Connessione SNMP riuscita" });
        } catch (e) {
          return NextResponse.json({
            success: false,
            error: e instanceof Error ? e.message : "Connessione SNMP fallita",
          });
        }
      }

      if (type === "ssh" || type === "linux") {
        const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
        const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
        if (username === null || password === null) {
          return NextResponse.json({ success: false, error: "Credenziale corrotta: rigenerare la password" });
        }
        if (!username || !password) {
          return NextResponse.json({ success: false, error: "Username e password richiesti" });
        }
        const { sshTryConnect } = await import("@/lib/devices/ssh-transport");
        const port = typeof body.port === "number" ? body.port : 22;
        const result = await withTimeout(
          sshTryConnect({ host, port, username, password, timeout: 15000, credentialName: cred.name }),
          TEST_TIMEOUT_MS
        );
        if (result.ok) {
          persistValidatedBinding(host, Number(id), "ssh", port);
          return NextResponse.json({ success: true, message: "Connessione SSH riuscita" });
        }
        const err = result.error;
        return NextResponse.json({
          success: false,
          error: err.message,
          hint: err.hint,
          kind: err.kind,
          methodsOffered: err.methodsOffered,
          methodsTried: err.methodsTried,
        });
      }

      if (type === "windows") {
        const username = cred.encrypted_username ? safeDecrypt(cred.encrypted_username) : "";
        const password = cred.encrypted_password ? safeDecrypt(cred.encrypted_password) : "";
        if (username === null || password === null) {
          return NextResponse.json({ success: false, error: "Credenziale corrotta: rigenerare la password" });
        }
        if (!username || !password) {
          return NextResponse.json({ success: false, error: "Username e password richiesti" });
        }
        try {
          const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
          const { getAdRealm } = await import("@/lib/db");
          const port = typeof body.port === "number" ? body.port : 5985;
          const adInfo = getAdRealm();
          await withTimeout(
            runWinrmCommand(host, port, username, password, "echo test", false, adInfo?.realm || ""),
            TEST_TIMEOUT_MS
          );
          persistValidatedBinding(host, Number(id), "winrm", port);
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
  });
}
