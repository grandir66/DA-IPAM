/**
 * Identita' con cui DA-IPAM e lo Scanner-Edge si presentano agli host.
 *
 * Serve a non scambiare le nostre stesse sonde per un attacco: probe WinRM,
 * patch management e inventario software autenticano contro macchine di
 * dominio, e con una credenziale scaduta genererebbero valanghe di 4625.
 *
 * Ricavata automaticamente (interfacce locali + credenziali configurate +
 * scanner edge) e integrabile a mano dalle impostazioni, per i casi che non
 * possiamo dedurre (es. un secondo collector, o un NAT davanti all'appliance).
 */

import * as os from "node:os";
import type { Database } from "better-sqlite3";
import { getSetting } from "../db-hub";
import { safeDecrypt } from "../crypto";
import { normalizeAccount, normalizeIp, type SelfIdentity } from "./wazuh-alerts";

const KEY_EXTRA_IPS = "wazuh_alerts_self_ips";
const KEY_EXTRA_ACCOUNTS = "wazuh_alerts_self_accounts";

function splitList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parte pura: normalizza e deduplica. Testabile senza DB ne' rete. */
export function buildSelfIdentity(parts: {
  localIps?: string[];
  dbIps?: string[];
  extraIps?: string[];
  dbAccounts?: string[];
  extraAccounts?: string[];
}): SelfIdentity {
  const ips = new Set<string>();
  for (const ip of [...(parts.localIps ?? []), ...(parts.dbIps ?? []), ...(parts.extraIps ?? [])]) {
    const n = normalizeIp(ip);
    // Loopback escluso: sul DC "127.0.0.1" indica un fallimento locale suo,
    // non una nostra connessione.
    if (n && n !== "127.0.0.1" && n !== "::1") ips.add(n);
  }
  const accounts = new Set<string>();
  for (const a of [...(parts.dbAccounts ?? []), ...(parts.extraAccounts ?? [])]) {
    const n = normalizeAccount(a);
    if (n) accounts.add(n);
  }
  return { ips: [...ips], accounts: [...accounts] };
}

function localIps(): string[] {
  const out: string[] = [];
  const ifaces = os.networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const i of list ?? []) {
      if (!i.internal && i.address) out.push(i.address);
    }
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Raccoglie l'identita' dal DB tenant. Best-effort: qualunque query mancante
 * (schema piu' vecchio, tabella assente) viene ignorata, mai un'eccezione —
 * al peggio si sopprime meno del dovuto, che e' il lato giusto in cui sbagliare.
 */
export function collectSelfIdentity(db: Database): SelfIdentity {
  const dbAccounts: string[] = [];
  const dbIps: string[] = [];

  const tryAll = <T>(sql: string): T[] => {
    try {
      return db.prepare(sql).all() as T[];
    } catch {
      return [];
    }
  };

  for (const r of tryAll<{ encrypted_username: string | null }>(
    "SELECT encrypted_username FROM ad_integrations",
  )) {
    const u = r.encrypted_username ? safeDecrypt(r.encrypted_username) : null;
    if (u) dbAccounts.push(u);
  }
  for (const r of tryAll<{ encrypted_username: string | null }>(
    "SELECT encrypted_username FROM credentials WHERE credential_type = 'windows'",
  )) {
    const u = r.encrypted_username ? safeDecrypt(r.encrypted_username) : null;
    if (u) dbAccounts.push(u);
  }
  for (const r of tryAll<{ base_url: string | null }>("SELECT base_url FROM vuln_scanners")) {
    const h = r.base_url ? hostOf(r.base_url) : null;
    if (h) dbIps.push(h);
  }

  return buildSelfIdentity({
    localIps: localIps(),
    dbIps,
    dbAccounts,
    extraIps: splitList(getSetting(KEY_EXTRA_IPS)),
    extraAccounts: splitList(getSetting(KEY_EXTRA_ACCOUNTS)),
  });
}
