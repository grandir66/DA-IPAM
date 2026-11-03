/**
 * Rilievi della cifratura della sonda (Edge-C, modulo tls-deep) arrivati prima della sonda 0.8.224
 * (Riccardo, 03/11/2026: «ho ancora questa evidenza» — «overall_grade» Critical su 60 host).
 *
 * Tre difetti della sonda di prima, che la sincronia (solo inserimenti) non avrebbe mai corretto:
 * - l'IP arrivava «nome/IP» (formato del motore): nessun host agganciato e, siccome nessuna
 *   scansione successiva porta più quell'IP scritto così, il rilievo restava «attuale» per sempre;
 * - il voto riassuntivo («overall_grade», Critical per ogni certificato autofirmato) e gli avvisi
 *   dello strumento («scanTime», «cmdline_ip-target»…) erano salvati come rilievi;
 * - l'autofirmato contava Critical (Riccardo, 02/11: vale Media);
 * - tutti i controlli dello stesso tipo avevano lo stesso `nvt_oid` («controllo:tls-deep:tls_weakness»):
 *   la lista li fondeva in UNA riga col nome del primo, ed ecco «overall_grade» su 60 host. Ora
 *   l'identificativo porta anche il nome del rilievo: `controllo:<modulo>:<tipo>:<nome>`.
 * Si corregge all'arrivo (`normalizzaRilievoControllo`) e, a ogni sincronia, sulle righe già salvate
 * (`ripulisciRilieviControlli`, idempotente). Nessuna riga si cancella: i non-rilievi passano a «Log».
 * Stesse regole di DA-Vul-can `infra/scanner-edge/.../tls_deep/spiegazioni.json`: se cambia uno, l'altro.
 */
import type Database from "better-sqlite3";

const TLS = "controllo:tls-deep:%";

/** Nomi tecnici che non sono rilievi: riassunti del voto e avvisi dello strumento. */
const NON_RILIEVI = [
  "overall_grade", "final_score", "scanTime", "scanProblem", "engine_problem", "host_certificate_Problem",
  "service", "HTTP_status_code", "NPN", "ALPN", "optimal_proto", "pre_128cipher", "TLS_timestamp", "http_get",
  "protocol_support_score", "protocol_support_score_weighted", "key_exchange_score", "key_exchange_score_weighted",
  "cipher_strength_score", "cipher_strength_score_weighted",
];
const PREFISSI_NON_RILIEVI = ["grade_cap_reason_", "grade_cap_warning_", "rating_", "clientsimulation-", "cmdline_", "banner_"];

/** Gravità decise per la LAN (Riccardo, 02/11/2026): il motore le tara per servizi pubblici. */
const GRAVITA: Record<string, string> = {
  cert_caIssuers: "Medium",
  cert_chain_of_trust: "Medium",
  cert_expirationStatus: "Medium",
  cert_trust: "Low",
};

const idBase = (nome: string | null | undefined) => (nome ?? "").replace(/\s*<[^>]*>\s*$/, "").trim();

export function nonERilievo(nome: string | null | undefined): boolean {
  const id = idBase(nome);
  return NON_RILIEVI.includes(id) || PREFISSI_NON_RILIEVI.some((p) => id.startsWith(p));
}

/** «nome/IP» → IP. */
export function soloIp(ip: string): string {
  const i = ip.indexOf("/");
  return i < 0 ? ip : ip.slice(i + 1) || ip.slice(0, i);
}

/** `controllo:<modulo>:<tipo>` (due «:») → `controllo:<modulo>:<tipo>:<nome>`. */
function oidDistinto(oid: string, nome: string | null): string {
  return oid.split(":").length === 3 && nome ? `${oid}:${nome}` : oid;
}

export function normalizzaRilievoControllo<T extends { ip: string; severity: string | null; nvt_oid: string | null; nvt_name: string | null }>(f: T): T {
  const oid = f.nvt_oid ?? "";
  if (!oid.startsWith("controllo:")) return f;
  const distinto = { ...f, nvt_oid: oidDistinto(oid, f.nvt_name) };
  if (!oid.startsWith("controllo:tls-deep:")) return distinto;
  const out = { ...distinto, ip: soloIp(f.ip) };
  if (nonERilievo(f.nvt_name)) out.severity = "Log";
  else if (GRAVITA[idBase(f.nvt_name)]) out.severity = GRAVITA[idBase(f.nvt_name)];
  return out;
}

/** Righe già salvate: idempotente, ritorna quante ne ha cambiate. */
export function ripulisciRilieviControlli(db: Database.Database): number {
  let n = 0;
  n += db
    .prepare(`UPDATE vuln_findings SET nvt_oid = nvt_oid || ':' || nvt_name
               WHERE nvt_oid LIKE 'controllo:%' AND nvt_name IS NOT NULL AND nvt_name <> ''
                 AND length(nvt_oid) - length(replace(nvt_oid, ':', '')) = 2`)
    .run().changes;
  n += db
    .prepare(`UPDATE vuln_findings SET ip = substr(ip, instr(ip, '/') + 1), host_id = NULL
               WHERE nvt_oid LIKE ? AND instr(ip, '/') > 0 AND substr(ip, instr(ip, '/') + 1) <> ''`)
    .run(TLS).changes;
  const segnaposto = NON_RILIEVI.map(() => "?").join(", ");
  const prefissi = PREFISSI_NON_RILIEVI.map(() => "nvt_name LIKE ?").join(" OR ");
  n += db
    .prepare(`UPDATE vuln_findings SET severity = 'Log'
               WHERE nvt_oid LIKE ? AND COALESCE(severity, '') <> 'Log'
                 AND (nvt_name IN (${segnaposto}) OR ${prefissi})`)
    .run(TLS, ...NON_RILIEVI, ...PREFISSI_NON_RILIEVI.map((p) => `${p}%`)).changes;
  for (const [nome, gravita] of Object.entries(GRAVITA)) {
    n += db
      .prepare("UPDATE vuln_findings SET severity = ? WHERE nvt_oid LIKE ? AND nvt_name = ? AND severity IN ('Critical', 'High')")
      .run(gravita, TLS, nome).changes;
  }
  return n;
}
