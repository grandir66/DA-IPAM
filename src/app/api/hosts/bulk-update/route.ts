import { NextResponse } from "next/server";
import { updateHost, addHostCredential, getHostCredentials } from "@/lib/db";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import { withTenantFromSession } from "@/lib/api-tenant";
import { z } from "zod";
import { DEVICE_CLASSIFICATIONS } from "@/lib/device-classifications";

const classificationSchema = z.enum(DEVICE_CLASSIFICATIONS as unknown as [string, ...string[]]);

const BulkHostUpdateSchema = z.object({
  host_ids: z.array(z.coerce.number().int().positive()).min(1, "Selezionare almeno un host"),
  classification: classificationSchema.optional(),
  known_host: z.union([z.literal(0), z.literal(1)]).optional(),
  notes: z.string().max(2000).optional().nullable(),
  device_manufacturer: z.string().max(200).optional().nullable(),
  ip_assignment: z.enum(["dynamic", "static", "reserved", "unknown"]).optional(),
  custom_name: z.string().max(255).optional().nullable(),
  // Credenziali da assegnare a tutti gli host selezionati
  credential_id: z.coerce.number().int().positive().optional().nullable(),
  credential_protocol: z.enum(["ssh", "snmp", "winrm", "api"]).optional(),
  credential_port: z.coerce.number().int().min(1).max(65535).optional(),
});

/**
 * PATCH /api/hosts/bulk-update
 * Aggiorna campi comuni su più host (cross-network).
 */
export async function PATCH(request: Request) {
  return withTenantFromSession(async () => {
    try {
      const adminCheck = await requireAdmin();
      if (isAuthError(adminCheck)) return adminCheck;

      const body = await request.json();
      const parsed = BulkHostUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Dati non validi" },
          { status: 400 },
        );
      }

      const {
        host_ids, classification, known_host, notes,
        device_manufacturer, ip_assignment, custom_name,
        credential_id, credential_protocol, credential_port,
      } = parsed.data;

      const hasField =
        classification !== undefined ||
        known_host !== undefined ||
        notes !== undefined ||
        device_manufacturer !== undefined ||
        ip_assignment !== undefined ||
        custom_name !== undefined ||
        (credential_id != null && credential_id > 0);

      if (!hasField) {
        return NextResponse.json(
          { error: "Specificare almeno un campo da aggiornare" },
          { status: 400 },
        );
      }

      let updated = 0;
      let credentialsAdded = 0;

      for (const id of host_ids) {
        // Aggiorna campi host
        const update: Record<string, unknown> = {};
        if (classification !== undefined) update.classification = classification;
        if (known_host !== undefined) update.known_host = known_host;
        if (notes !== undefined) update.notes = notes;
        if (device_manufacturer !== undefined) update.device_manufacturer = device_manufacturer;
        if (ip_assignment !== undefined) update.ip_assignment = ip_assignment;
        if (custom_name !== undefined) update.custom_name = custom_name;

        if (Object.keys(update).length > 0) {
          const result = updateHost(id, update as Parameters<typeof updateHost>[1]);
          if (result) updated++;
        }

        // Assegna credenziale (se specificata e non già presente)
        if (credential_id != null && credential_id > 0) {
          const proto = credential_protocol ?? "ssh";
          const port = credential_port ?? (proto === "snmp" ? 161 : proto === "winrm" ? 5985 : proto === "api" ? 443 : 22);
          try {
            const existing = getHostCredentials(id);
            const alreadyBound = existing.some(
              (hc) => hc.credential_id === credential_id && hc.protocol_type === proto,
            );
            if (!alreadyBound) {
              addHostCredential(id, credential_id, proto, port);
              credentialsAdded++;
            }
          } catch {
            // Host non trovato o errore DB — skip
          }
        }
      }

      const parts: string[] = [];
      if (updated > 0) parts.push(`${updated} host aggiornato${updated !== 1 ? "i" : ""}`);
      if (credentialsAdded > 0) parts.push(`${credentialsAdded} credenzial${credentialsAdded !== 1 ? "i" : "e"} assegnat${credentialsAdded !== 1 ? "e" : "a"}`);
      const message = parts.join(", ") || "Nessuna modifica";

      return NextResponse.json({ success: true, updated, credentials_added: credentialsAdded, message });
    } catch (error) {
      console.error("Bulk host update error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Errore nell'aggiornamento" },
        { status: 500 },
      );
    }
  });
}
