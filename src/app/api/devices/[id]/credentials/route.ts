import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import {
  getNetworkDeviceById,
  getDeviceCredentialBindings,
  addDeviceCredentialBinding,
  updateDeviceCredentialBinding,
  deleteDeviceCredentialBinding,
  reorderDeviceCredentialBindings,
  updateBindingTestStatus,
} from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";

/**
 * GET /api/devices/:id/credentials — lista bindings credenziali per device
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });

    const bindings = getDeviceCredentialBindings(Number(id));
    // Maschera password inline
    const safe = bindings.map((b) => ({
      ...b,
      inline_encrypted_password: b.inline_encrypted_password ? "●●●●●●●●" : null,
      inline_username_display: b.inline_username ?? null,
      source: b.credential_id ? "archive" as const : "inline" as const,
      display_name: b.credential_id
        ? (b.credential_name || `Credenziale #${b.credential_id}`)
        : (b.inline_username ? `${b.inline_username} (inline)` : "Inline"),
    }));
    return NextResponse.json(safe);
    } catch {
      return NextResponse.json({ error: "Errore" }, { status: 500 });
    }
  });
}

const AddBindingSchema = z.object({
  credential_id: z.number().int().positive().optional().nullable(),
  protocol_type: z.enum(["ssh", "snmp", "winrm", "api"]),
  port: z.number().int().min(1).max(65535),
  inline_username: z.string().max(100).optional().nullable(),
  inline_password: z.string().max(200).optional().nullable(),
});

/**
 * POST /api/devices/:id/credentials — aggiunge un binding credenziale
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });

    const body = await req.json();
    const parsed = AddBindingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    const { credential_id, protocol_type, port, inline_username, inline_password } = parsed.data;

    const binding = addDeviceCredentialBinding({
      device_id: Number(id),
      credential_id: credential_id ?? null,
      protocol_type,
      port,
      inline_username: credential_id ? null : (inline_username ?? null),
      inline_encrypted_password: credential_id ? null : (inline_password ? encrypt(inline_password) : null),
    });

    return NextResponse.json(binding, { status: 201 });
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Errore" }, { status: 500 });
    }
  });
}

const UpdateBindingSchema = z.object({
  action: z.enum(["update", "delete", "reorder", "test"]),
  binding_id: z.number().int().positive().optional(),
  // Per update
  credential_id: z.number().int().positive().optional().nullable(),
  protocol_type: z.enum(["ssh", "snmp", "winrm", "api"]).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  inline_username: z.string().max(100).optional().nullable(),
  inline_password: z.string().max(200).optional().nullable(),
  // Per reorder
  ordered_ids: z.array(z.number().int().positive()).optional(),
});

/**
 * PUT /api/devices/:id/credentials — update, delete, reorder, test binding
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;
    const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });

    const body = await req.json();
    const parsed = UpdateBindingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    const data = parsed.data;

    if (data.action === "delete") {
      if (!data.binding_id) return NextResponse.json({ error: "binding_id richiesto" }, { status: 400 });
      deleteDeviceCredentialBinding(data.binding_id);
      return NextResponse.json({ success: true });
    }

    if (data.action === "reorder") {
      if (!data.ordered_ids?.length) return NextResponse.json({ error: "ordered_ids richiesto" }, { status: 400 });
      reorderDeviceCredentialBindings(Number(id), data.ordered_ids);
      return NextResponse.json({ success: true });
    }

    if (data.action === "update") {
      if (!data.binding_id) return NextResponse.json({ error: "binding_id richiesto" }, { status: 400 });
      const updates: Parameters<typeof updateDeviceCredentialBinding>[1] = {};
      if (data.credential_id !== undefined) updates.credential_id = data.credential_id;
      if (data.protocol_type !== undefined) updates.protocol_type = data.protocol_type;
      if (data.port !== undefined) updates.port = data.port;
      if (data.inline_username !== undefined) updates.inline_username = data.inline_username;
      if (data.inline_password !== undefined) {
        updates.inline_encrypted_password = data.inline_password ? encrypt(data.inline_password) : null;
      }
      updateDeviceCredentialBinding(data.binding_id, updates);
      return NextResponse.json({ success: true });
    }

    if (data.action === "test") {
      if (!data.binding_id) return NextResponse.json({ error: "binding_id richiesto" }, { status: 400 });
      // Recupera binding
      const bindings = getDeviceCredentialBindings(Number(id));
      const binding = bindings.find((b) => b.id === data.binding_id);
      if (!binding) return NextResponse.json({ error: "Binding non trovato" }, { status: 404 });

      const testResult = await testBinding(device.host, binding);
      updateBindingTestStatus(data.binding_id, testResult.success ? "success" : "failed", testResult.message);
      // Promuovi il binding validato anche su host_credentials dell'host con stesso IP,
      // così la credenziale resta associata anche se il device viene rimosso/ricreato.
      if (testResult.success && binding.credential_id) {
        try {
          const { getHostByIp, setHostCredentialValidatedByKey } = await import("@/lib/db");
          const h = getHostByIp(device.host);
          if (h?.id) {
            setHostCredentialValidatedByKey(
              h.id,
              binding.credential_id,
              binding.protocol_type as "ssh" | "snmp" | "winrm" | "api",
              binding.port,
              { auto_detected: false }
            );
          }
        } catch (e) {
          console.warn("[devices/credentials/test] persistValidatedBinding failed:", e);
        }
      }
      return NextResponse.json(testResult);
    }

    return NextResponse.json({ error: "Azione non valida" }, { status: 400 });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Errore" }, { status: 500 });
  }
  });
}

/** Testa una singola credenziale binding su un host */
/** Esito test binding: i campi extra (`kind`, `hint`, `methodsOffered`, `methodsTried`)
 *  sono presenti solo per failure SSH e servono al pannello "Diagnostica" in UI. */
async function testBinding(
  host: string,
  binding: { protocol_type: string; port: number; credential_id: number | null; inline_username: string | null; inline_encrypted_password: string | null; credential_type?: string | null }
): Promise<{
  success: boolean;
  message: string;
  kind?: string;
  hint?: string;
  methodsOffered?: string[];
  methodsTried?: string[];
}> {
  try {
    if (binding.protocol_type === "ssh") {
      let username: string | undefined;
      let password: string | undefined;
      if (binding.credential_id) {
        const { getSshLinuxCredentialPair } = await import("@/lib/db");
        const pair = getSshLinuxCredentialPair(binding.credential_id);
        username = pair?.username;
        password = pair?.password;
      } else {
        username = binding.inline_username ?? undefined;
        password = binding.inline_encrypted_password ? decrypt(binding.inline_encrypted_password) : undefined;
      }
      if (!username) return { success: false, message: "Username mancante" };
      if (!password) return { success: false, message: "Password mancante" };

      const { sshTryConnect } = await import("@/lib/devices/ssh-transport");
      const result = await sshTryConnect({
        host,
        port: binding.port,
        username,
        password,
        timeout: 10000,
        credentialName: binding.credential_id ? `cred#${binding.credential_id}` : "inline",
      });
      if (result.ok) return { success: true, message: "Connessione SSH riuscita" };
      const err = result.error;
      const detail = err.hint ? `${err.message} ${err.hint}` : err.message;
      return {
        success: false,
        message: `[${err.kind}] ${detail}`,
        kind: err.kind,
        hint: err.hint,
        methodsOffered: err.methodsOffered,
        methodsTried: err.methodsTried,
      };
    }

    if (binding.protocol_type === "snmp") {
      let community: string;
      if (binding.credential_id) {
        const { getCredentialCommunityString } = await import("@/lib/db");
        community = getCredentialCommunityString(binding.credential_id) ?? "public";
      } else {
        community = binding.inline_encrypted_password ? decrypt(binding.inline_encrypted_password) : "public";
      }
      const snmp = await import("net-snmp");
      const session = snmp.createSession(host, community, { port: binding.port, timeout: 5000 });
      return new Promise((resolve) => {
        const timer = setTimeout(() => { session.close(); resolve({ success: false, message: "Timeout SNMP" }); }, 8000);
        session.get(["1.3.6.1.2.1.1.1.0"], (error: Error | null) => {
          clearTimeout(timer);
          session.close();
          resolve(error
            ? { success: false, message: `SNMP: ${error.message}` }
            : { success: true, message: "SNMP raggiungibile" }
          );
        });
      });
    }

    if (binding.protocol_type === "winrm") {
      let username: string | undefined;
      let password: string | undefined;
      if (binding.credential_id) {
        const { getCredentialLoginPair } = await import("@/lib/db");
        const pair = getCredentialLoginPair(binding.credential_id, "windows");
        username = pair?.username;
        password = pair?.password;
      } else {
        username = binding.inline_username ?? undefined;
        password = binding.inline_encrypted_password ? decrypt(binding.inline_encrypted_password) : undefined;
      }
      if (!username) return { success: false, message: "Username mancante" };
      try {
        const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
        const { getAdRealm } = await import("@/lib/db");
        const realm = getAdRealm()?.realm ?? "";
        const out = await runWinrmCommand(
          host,
          binding.port ?? 5985,
          username,
          password ?? "",
          "echo DA-IPAM-TEST",
          false,
          realm
        );
        return String(out).includes("DA-IPAM-TEST")
          ? { success: true, message: "WinRM funzionante" }
          : { success: false, message: "WinRM: risposta inattesa" };
      } catch (err: unknown) {
        return { success: false, message: `WinRM: ${err instanceof Error ? err.message : "errore"}` };
      }
    }

    return { success: false, message: `Test per protocollo ${binding.protocol_type} non implementato` };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Errore test" };
  }
}
