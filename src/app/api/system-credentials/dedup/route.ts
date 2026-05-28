/**
 * Dedup endpoint per il vault credenziali.
 *
 * Trova entry duplicate (stesso kind + label normalizzato senza suffix
 * "(placeholder)"/"(API interna)" + stesso URL host) e tiene quella
 * "migliore" — quella con più informazioni complete. Cancella le altre.
 *
 * Criterio "migliore" (score):
 *   - has_password / has_api_token (+3 each)
 *   - has url + has username (+2 each)
 *   - enabled = 1 (+1)
 *   - label NON contiene "(placeholder)" (+2)
 * In caso di parità tiene la entry con id più basso (più vecchia).
 *
 * Idempotente: dopo una run successiva senza nuovi duplicati restituisce
 * deleted=0.
 */
import { NextResponse } from "next/server";
import { requireAdmin, isAuthError } from "@/lib/api-auth";
import {
  listCredentials,
  deleteCredential,
  logCredentialEvent,
  type SystemCredential,
} from "@/lib/credentials-vault";

function normalizeLabel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s*\(placeholder\)\s*/gi, "")
    .replace(/\s*\(api interna\)\s*/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeUrl(u: string | null): string {
  if (!u) return "";
  try {
    const parsed = new URL(u);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return u.toLowerCase();
  }
}

function score(c: SystemCredential): number {
  let s = 0;
  if (c.has_password) s += 3;
  if (c.has_api_token) s += 3;
  if (c.url) s += 2;
  if (c.username) s += 2;
  if (c.enabled) s += 1;
  if (!c.label.toLowerCase().includes("(placeholder)")) s += 2;
  return s;
}

export async function POST() {
  const adminCheck = await requireAdmin();
  if (isAuthError(adminCheck)) return adminCheck;

  const all = listCredentials();

  // Gruppi: stesso kind + stesso label normalizzato (URL ignorato qui per
  // catturare il caso più comune di "LibreNMS" + "LibreNMS (placeholder)").
  const groups = new Map<string, SystemCredential[]>();
  for (const c of all) {
    const key = `${c.kind}|${normalizeLabel(c.label)}`;
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  }

  // Gruppi aggiuntivi: stesso kind + stesso URL host (per catturare entry
  // create con label diverso ma stesso endpoint).
  const urlGroups = new Map<string, SystemCredential[]>();
  for (const c of all) {
    if (!c.url) continue;
    const key = `${c.kind}|url:${normalizeUrl(c.url)}`;
    const arr = urlGroups.get(key) ?? [];
    arr.push(c);
    urlGroups.set(key, arr);
  }

  const toDelete = new Set<number>();
  const merges: Array<{ kept: number; removed: number[]; reason: string }> = [];

  const processGroup = (groupKey: string, items: SystemCredential[], reason: string): void => {
    if (items.length < 2) return;
    const sorted = [...items].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sb - sa;
      return a.id - b.id;
    });
    const keep = sorted[0];
    const remove = sorted.slice(1);
    for (const r of remove) toDelete.add(r.id);
    merges.push({ kept: keep.id, removed: remove.map((r) => r.id), reason: `${groupKey} (${reason})` });
  };

  for (const [k, items] of groups) processGroup(k, items, "kind+label-normalized");
  for (const [k, items] of urlGroups) processGroup(k, items, "kind+url-host");

  // Esegui le delete dopo aver raccolto tutto, evita problemi di iter+mutate.
  let deleted = 0;
  for (const id of toDelete) {
    const c = all.find((x) => x.id === id);
    if (!c) continue;
    if (deleteCredential(id)) {
      deleted++;
      logCredentialEvent({
        credentialId: id,
        action: "delete",
        actorUsername: adminCheck.user.name ?? null,
        result: "dedup",
        details: { kind: c.kind, label: c.label, reason: "duplicate of better-scored entry" },
      });
    }
  }

  return NextResponse.json({
    ok: true,
    deleted,
    groups_with_duplicates: merges.length,
    merges,
  });
}
