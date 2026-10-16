import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { versioneApparato } from "@/lib/protocols/snmp-sessione";
import { provaBinding } from "@/lib/devices/prova-binding";
import {
  getNetworkDeviceById,
  getDeviceCredentialBindings,
  addDeviceCredentialBinding,
  updateDeviceCredentialBinding,
  deleteDeviceCredentialBinding,
  reorderDeviceCredentialBindings,
  updateBindingTestStatus,
  getCredentialById,
} from "@/lib/db";
import { erroreVocePerProtocollo } from "@/lib/credentials/tipi";
import { encrypt } from "@/lib/crypto";
import { aggiornamentiBinding, normalizzaInlineSnmp } from "@/lib/devices/aggiornamenti-binding";

/**
 * GET /api/devices/:id/credentials — lista bindings credenziali per device
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withTenantFromSession(async () => {
    try {
      const session = await requireAuth();
      if (isAuthError(session)) return session;
      // Lo username inline lo vede solo chi può modificarlo (tappa 1).
      const role = (session.user as { role?: string }).role;
      const vedeUsername = role === "admin" || role === "superadmin";
      const { id } = await params;
    const device = getNetworkDeviceById(Number(id));
    if (!device) return NextResponse.json({ error: "Dispositivo non trovato" }, { status: 404 });

    const bindings = getDeviceCredentialBindings(Number(id));
    // Maschera password inline
    const safe = bindings.map((b) => {
      const username = vedeUsername ? (b.inline_username ?? null) : null;
      return {
        ...b,
        inline_username: username,
        inline_encrypted_password: b.inline_encrypted_password ? "●●●●●●●●" : null,
        inline_username_display: username,
        source: b.credential_id ? "archive" as const : "inline" as const,
        display_name: b.credential_id
          ? (b.credential_name || `Credenziale #${b.credential_id}`)
          : (username ? `${username} (inline)` : "Inline"),
      };
    });
    return NextResponse.json(safe);
    } catch {
      return NextResponse.json({ error: "Errore" }, { status: 500 });
    }
  });
}

const AddBindingSchema = z.object({
  credential_id: z.number().int().positive().optional().nullable(),
  protocol_type: z.enum(["ssh", "snmp", "winrm", "api", "redfish", "onvif"]),
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

    const { credential_id, protocol_type, port } = parsed.data;
    // La voce d'archivio deve valere per il protocollo del binding (T13, 16/10):
    // prima si salvava e il motore la scartava in silenzio.
    if (credential_id) {
      const errore = erroreVocePerProtocollo(credential_id, getCredentialById(credential_id), protocol_type);
      if (errore) return NextResponse.json({ error: errore }, { status: 400 });
    }
    const { inline_username, inline_password } = normalizzaInlineSnmp(protocol_type, parsed.data.inline_username, parsed.data.inline_password);

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
  protocol_type: z.enum(["ssh", "snmp", "winrm", "api", "redfish", "onvif"]).optional(),
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
      // Voce e protocollo dopo la modifica: quelli mandati, altrimenti quelli del binding.
      const attuale = getDeviceCredentialBindings(Number(id)).find((b) => b.id === data.binding_id);
      if (!attuale) return NextResponse.json({ error: "Binding non trovato" }, { status: 404 });
      const voceDopo = data.credential_id !== undefined ? data.credential_id : attuale.credential_id;
      if (voceDopo) {
        const errore = erroreVocePerProtocollo(voceDopo, getCredentialById(voceDopo), data.protocol_type ?? attuale.protocol_type);
        if (errore) return NextResponse.json({ error: errore }, { status: 400 });
      }
      // Campi inline solo in modalità inline, community SNMP nel campo cifrato
      // (tappa 1): dettaglio in src/lib/devices/aggiornamenti-binding.ts.
      const updates = aggiornamentiBinding(data);
      updateDeviceCredentialBinding(data.binding_id, updates);
      return NextResponse.json({ success: true });
    }

    if (data.action === "test") {
      if (!data.binding_id) return NextResponse.json({ error: "binding_id richiesto" }, { status: 400 });
      // Recupera binding
      const bindings = getDeviceCredentialBindings(Number(id));
      const binding = bindings.find((b) => b.id === data.binding_id);
      if (!binding) return NextResponse.json({ error: "Binding non trovato" }, { status: 404 });

      const testResult = await provaBinding(device.host, binding, versioneApparato(device, "1"));
      // Per API/Redfish/ONVIF una prova non c'è: il binding non si marca fallito
      // (il motore delle credenziali scarterebbe un binding buono).
      if (testResult.nonDisponibile) return NextResponse.json(testResult);
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
              binding.protocol_type as "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif",
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

