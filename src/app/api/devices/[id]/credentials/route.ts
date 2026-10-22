import { NextResponse } from "next/server";
import { avviaChocoDopoCredenziali } from "@/lib/patch/choco-automatico";
import { z } from "zod";
import { requireAdmin, requireAuth, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { versioneApparato } from "@/lib/protocols/snmp-sessione";
import { provaBinding } from "@/lib/devices/prova-binding";
import { eErroreDiTrasporto, registraProva } from "@/lib/credentials/trova";
import type { CredProtocol } from "@/lib/credentials/porte";
import {
  getNetworkDeviceById,
  getDeviceCredentialBindings,
  reorderDeviceCredentialBindings,
  updateBindingTestStatus,
  getDb,
} from "@/lib/db";
import { aggiungiBindingApparato, aggiornaBindingApparato, VoceNonValePerProtocollo } from "@/lib/credentials/lega-voce";
import { aggiornaSegretoBindingDb, eliminaBindingApparatoDb, nuovaVoceEBindingDb, RifiutoCredenziali } from "@/lib/credentials/apparato-archivio";
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
    const { inline_username, inline_password } = normalizzaInlineSnmp(protocol_type, parsed.data.inline_username, parsed.data.inline_password);

    // «Nuova» (tappa 2e, T20): utente e segreto diventano una voce
    // dell'archivio col nome dell'apparato, e il binding la punta. Prima
    // restavano dentro il binding (inline), che la pagina non mostra come voce
    // e che la 2g smetterà di leggere.
    if (!credential_id) {
      if (!inline_password && !inline_username) {
        return NextResponse.json({ error: "Scegli una credenziale dell'archivio o scrivine una nuova" }, { status: 400 });
      }
      const nuova = nuovaVoceEBindingDb(getDb(), Number(id), protocol_type, port, { username: inline_username ?? null, password: inline_password ?? null });
      return NextResponse.json({ ...nuova.binding, inline_encrypted_password: null, voce: nuova.voce }, { status: 201 });
    }

    // La voce d'archivio deve valere per il protocollo del binding (T13, 16/10):
    // prima si salvava e il motore la scartava in silenzio. Il controllo sta in
    // aggiungiBindingApparato; qui il rifiuto diventa un 400.
    const binding = aggiungiBindingApparato({ device_id: Number(id), credential_id, protocol_type, port });

    return NextResponse.json(binding, { status: 201 });
    } catch (err: unknown) {
      if (err instanceof VoceNonValePerProtocollo) return NextResponse.json({ error: err.message }, { status: 400 });
      if (err instanceof RifiutoCredenziali) return NextResponse.json({ error: err.message }, { status: err.stato });
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
      // Solo un binding di questo apparato (T20): prima si cancellava qualunque id.
      if (!eliminaBindingApparatoDb(getDb(), Number(id), data.binding_id)) {
        return NextResponse.json({ error: "Binding non trovato" }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    if (data.action === "reorder") {
      if (!data.ordered_ids?.length) return NextResponse.json({ error: "ordered_ids richiesto" }, { status: 400 });
      reorderDeviceCredentialBindings(Number(id), data.ordered_ids);
      return NextResponse.json({ success: true });
    }

    if (data.action === "update") {
      if (!data.binding_id) return NextResponse.json({ error: "binding_id richiesto" }, { status: 400 });
      // Voce, protocollo e porta nel binding; utente e segreto nuovi nella
      // voce dell'apparato (T20): dettaglio in aggiornamenti-binding.ts e in
      // credentials/apparato-archivio.ts. Tutto o niente.
      const { modifica, segreto } = aggiornamentiBinding(data);
      let voce: { credential_id: number; nome: string; nuova: boolean } | null = null;
      try {
        if (segreto) {
          // Protocollo e porta, poi la voce: aggiornata se è solo di questo
          // binding, altrimenti una nuova dell'apparato (una condivisa non
          // cambia per gli altri). Un binding di un altro apparato è un 404.
          voce = aggiornaSegretoBindingDb(getDb(), Number(id), data.binding_id, segreto, { protocol_type: data.protocol_type, port: data.port });
        } else if (!aggiornaBindingApparato(Number(id), data.binding_id, modifica)) {
          // La voce dopo la modifica deve valere per il protocollo dopo la
          // modifica (T13): il controllo sta in aggiornaBindingApparato.
          return NextResponse.json({ error: "Binding non trovato" }, { status: 404 });
        }
      } catch (err) {
        if (err instanceof VoceNonValePerProtocollo) return NextResponse.json({ error: err.message }, { status: 400 });
        if (err instanceof RifiutoCredenziali) return NextResponse.json({ error: err.message }, { status: err.stato });
        throw err;
      }
      return NextResponse.json({ success: true, ...(voce ? { voce } : {}) });
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
      const proto = binding.protocol_type as CredProtocol;
      // L'host non risponde (timeout, connessione rifiutata, nessuna strada): non è un rifiuto della credenziale.
      // Niente stato «fallita» sul binding e niente esclusione sull'host (regola «errore di trasporto non è risposta»).
      if (!testResult.success && eErroreDiTrasporto(proto, testResult.message, testResult.kind)) {
        return NextResponse.json({ ...testResult, message: `Host non raggiungibile: ${testResult.message}`, trasporto: true });
      }
      updateBindingTestStatus(data.binding_id, testResult.success ? "success" : "failed", testResult.message);
      // Come la «Prova» a mano e la ricerca (T3): l'esito passa da `registraProva`, quindi un successo azzera
      // fallimenti e backoff dell'host e riabilita una credenziale esclusa; un rifiuto la esclude.
      if (binding.credential_id) {
        try {
          const { getHostByIp, setHostCredentialValidatedByKey } = await import("@/lib/db");
          const h = getHostByIp(device.host);
          if (h?.id) {
            if (proto === "ssh" || proto === "snmp" || proto === "winrm") {
              registraProva(h.id, binding.credential_id, proto, binding.port, { ok: testResult.success, errore: testResult.message });
            } else if (testResult.success) {
              setHostCredentialValidatedByKey(h.id, binding.credential_id, proto, binding.port, { auto_detected: false });
            }
            // WinRM verificato: Chocolatey si installa da solo, se serve (21/10).
            if (testResult.success && proto === "winrm") avviaChocoDopoCredenziali([h.id]);
          }
        } catch (e) {
          console.warn("[devices/credentials/test] registraProva failed:", e);
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

