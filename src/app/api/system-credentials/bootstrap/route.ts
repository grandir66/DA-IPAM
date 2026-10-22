import { NextResponse } from "next/server";
import { z } from "zod";
import { VoceBootstrapSchema } from "@/lib/credentials-vault-tipi";
import { requireAdmin } from "@/lib/api-auth";
import {
  listCredentials,
  createCredential,
  updateCredential,
  logCredentialEvent,
  type CredentialKind,
  type LaunchMode,
} from "@/lib/credentials-vault";

const BodySchema = z.object({
  entries: z.array(VoceBootstrapSchema).min(1).max(50),
});

/**
 * Bulk-bootstrap del vault. Pensato per l'appliance Proxmox (connect.sh) che,
 * dopo aver fatto login come admin DA-IPAM, pusha tutte le credenziali Dashboard
 * (Wazuh admin, LibreNMS admin, Graylog admin, Scanner-Edge admin UI, ecc.) che
 * vivono sui secrets del PVE host e non sono altrimenti note al hub IPAM.
 *
 * Strategia upsert per (kind, label):
 *  - se la entry esiste già → UPDATE solo dei campi forniti, secret sovrascritto
 *    se non vuoto (PUT semantic). Mai cancellare un secret esistente.
 *  - altrimenti → CREATE.
 */
export async function POST(req: Request) {
  const session = await requireAdmin();
  if (session instanceof NextResponse) return session;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const existing = listCredentials();
  const byKey = new Map(existing.map((c) => [`${c.kind}:${c.label}`, c]));

  let created = 0;
  let updated = 0;

  for (const e of parsed.data.entries) {
    const key = `${e.kind}:${e.label}`;
    const found = byKey.get(key);
    if (found) {
      const patch: Record<string, unknown> = {};
      if (e.url !== undefined) patch.url = e.url;
      if (e.api_url !== undefined) patch.api_url = e.api_url;
      if (e.username !== undefined) patch.username = e.username;
      if (e.notes !== undefined) patch.notes = e.notes;
      if (e.launch_mode !== undefined) patch.launch_mode = e.launch_mode;
      // Secret: sovrascrivi solo se valore presente (mai vuoto)
      if (e.password) patch.password = e.password;
      if (e.api_token) patch.api_token = e.api_token;
      if (Object.keys(patch).length > 0) {
        updateCredential(found.id, patch as Parameters<typeof updateCredential>[1]);
        logCredentialEvent({
          credentialId: found.id,
          action: "update",
          actorUsername: session.user.name ?? "bootstrap",
          result: "ok",
          details: { source: "bootstrap", fields: Object.keys(patch) },
        });
        updated++;
      }
    } else {
      const c = createCredential({
        kind: e.kind as CredentialKind,
        label: e.label,
        url: e.url ?? null,
        api_url: e.api_url ?? null,
        username: e.username ?? null,
        password: e.password ?? null,
        api_token: e.api_token ?? null,
        notes: e.notes ?? null,
        launch_mode: (e.launch_mode ?? "copy") as LaunchMode,
      });
      logCredentialEvent({
        credentialId: c.id,
        action: "create",
        actorUsername: session.user.name ?? "bootstrap",
        result: "ok",
        details: { source: "bootstrap", kind: c.kind, label: c.label },
      });
      created++;
    }
  }

  return NextResponse.json({ created, updated, total: parsed.data.entries.length });
}
