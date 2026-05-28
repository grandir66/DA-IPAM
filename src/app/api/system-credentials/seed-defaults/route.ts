/**
 * Seed-defaults: inserisce 5 placeholder standard nel Launchpad
 * (Wazuh Manager, Wazuh Indexer, LibreNMS, Graylog, TrueNAS) se non
 * esistono già entry per quel kind. Senza secrets: l'admin completa
 * URL + credenziali tramite "Modifica" dopo.
 *
 * Idempotente: se una entry placeholder esiste già (label include
 * "(placeholder)"), non la duplica.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  createCredential,
  listCredentials,
  logCredentialEvent,
  type CredentialKind,
} from "@/lib/credentials-vault";

interface SeedEntry {
  kind: CredentialKind;
  label: string;
  url: string | null;
  username: string | null;
  notes: string;
}

const SEED: SeedEntry[] = [
  {
    kind: "wazuh",
    label: "Wazuh Manager (placeholder)",
    url: null,
    username: "wazuh",
    notes:
      "Wazuh Manager API (porta 55000). Modifica per inserire URL + credenziali admin.\nEsempio URL: https://wazuh.cliente.lan:55000",
  },
  {
    kind: "wazuh",
    label: "Wazuh Indexer / OpenSearch (placeholder)",
    url: null,
    username: "admin",
    notes:
      "Wazuh Indexer (OpenSearch, porta 9200). Modifica per URL + admin password.\nEsempio URL: https://wazuh.cliente.lan:9200",
  },
  {
    kind: "librenms",
    label: "LibreNMS (placeholder)",
    url: null,
    username: "admin",
    notes:
      "LibreNMS web UI (porta 8090 di default). Modifica per URL + credenziali admin.",
  },
  {
    kind: "graylog",
    label: "Graylog (placeholder)",
    url: null,
    username: "admin",
    notes:
      "Graylog web UI + API. Modifica per URL + admin user/password (oppure usa api_token).",
  },
  {
    kind: "truenas",
    label: "TrueNAS — backup target (placeholder)",
    url: null,
    username: "root",
    notes:
      "TrueNAS REST API. Per scan futuri usa api_token (consigliato) o user/password.\nEsempio URL: https://truenas.cliente.lan",
  },
];

export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const existing = listCredentials();
  const existingByKindAndPlaceholder = new Set(
    existing
      .filter((c) => c.label.toLowerCase().includes("(placeholder)"))
      .map((c) => `${c.kind}|${c.label}`),
  );

  let created = 0;
  let skipped = 0;
  for (const entry of SEED) {
    const key = `${entry.kind}|${entry.label}`;
    if (existingByKindAndPlaceholder.has(key)) {
      skipped++;
      continue;
    }
    const newCred = createCredential({
      kind: entry.kind,
      label: entry.label,
      url: entry.url,
      api_url: null,
      username: entry.username,
      password: null,
      api_token: null,
      notes: entry.notes,
      launch_mode: "copy",
      enabled: false,           // placeholder = non attivo finché admin non completa
    });
    logCredentialEvent({
      credentialId: newCred.id,
      action: "create",
      actorUsername: adminCheck.user.name ?? null,
      result: "seed-default",
      details: { source: "seed-defaults endpoint" },
    });
    created++;
  }

  return NextResponse.json({
    ok: true,
    created,
    skipped,
    total: SEED.length,
  });
}
