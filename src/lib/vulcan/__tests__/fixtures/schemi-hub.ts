/**
 * Copia degli schemi zod con cui l'hub DA-Vul-can valida i corpi di DA-IPAM:
 * le prove dei costruttori (`corpo-ad.test.ts`, `corpo-inventario.test.ts`)
 * passano ogni corpo da qui, così una forma che l'hub rifiuterebbe (422) si vede
 * nelle prove e non sul live. **Il codice dell'hub vince**: questa è una copia.
 *
 * Copiati il 2026-10-22 da DA-Vul-can `origin/HEAD` = e8e58f7 (blob git):
 *   9f37d8d90794c7d851500ad5d265dbb731bf7f8d src/lib/ipam/inventario.ts           (SchemaInventario, Oggetto)
 *   05e4272e32b3cc7adf8d36e377f69bf24732f8f9 src/lib/parser/domarc-ad-health.ts   (exportSchema, MAX_AD_HEALTH_FINDINGS)
 *   05864398b5e19803218302e87b1c7c98f72dc5e3 src/app/api/ipam/ad-health/route.ts  (409 codcli, 413 oltre 5.000 regole)
 *   acc656698946f1fd42cd2332575ede5155cf162f src/app/api/ipam/inventario/route.ts (409 codcli, poi SchemaInventario)
 *   96df629ab4b4744a46ba01d5552af7385220d338 src/app/api/ipam/heartbeat/route.ts  (Battito; aggiunto col Task 6)
 *
 * Come si tiene allineata (a ogni tocco del flusso e nel collaudo del Task 9):
 *   for f in src/lib/ipam/inventario.ts src/lib/parser/domarc-ad-health.ts \
 *            src/app/api/ipam/ad-health/route.ts src/app/api/ipam/inventario/route.ts \
 *            src/app/api/ipam/heartbeat/route.ts; do
 *     echo "$(git -C ~/Progetti/Domarc/DA-Vul-can rev-parse origin/HEAD:$f) $f"; done
 * Un blob diverso da quelli sopra = si rilegge il file dell'hub e si ricopia qui.
 * Niente prova automatica contro il repo dell'hub: dipenderebbe dalla macchina.
 */
import { z } from "zod";

// ── src/lib/parser/domarc-ad-health.ts ─────────────────────────────────────
export const MAX_AD_HEALTH_FINDINGS = 5000;

const assi = z.object({
  global: z.number(),
  stale: z.number(),
  privileged: z.number(),
  trust: z.number(),
  anomaly: z.number(),
});

export const exportSchemaHub = z.object({
  source: z.literal("domarc-ad-health"),
  domain_fqdn: z.string().min(1),
  engine_version: z.string().min(1),
  generated_at: z.string().min(1),
  scores: assi,
  findings: z
    .array(
      z.object({
        ip: z.null().optional(),
        hostname: z.string().nullable().optional(),
        severity: z.string(),
        cvss_score: z.number(),
        nvt_oid: z.string().min(1),
        nvt_name: z.string(),
        description: z.string(),
        source_kind: z.enum(["ad_misconfig", "risk_indicator"]),
        raw_json: z.string(),
      }),
    )
    .max(MAX_AD_HEALTH_FINDINGS, `al massimo ${MAX_AD_HEALTH_FINDINGS} regole per export`),
});

// ── src/lib/ipam/inventario.ts ─────────────────────────────────────────────
export const MAX_OGGETTI_HUB = 50_000;

const testo = (max: number) => z.string().max(max);
const data = z.string().min(1).max(40);

const Oggetto = z
  .object({
    ip: z.string().min(3).max(45),
    rete_cidr: z.string().min(3).max(49),
    stato: z.enum(["online", "offline", "unknown"]),
    visto_prima: data,
    visto_ultima: data,
    classificazione: testo(60),
    os_famiglia: testo(60),
    os: testo(200).nullable().optional(),
    fuori_supporto: z.boolean().nullable().optional(),
    mac: testo(32).nullable().optional(),
    produttore: testo(120).nullable().optional(),
    hostname: testo(255).nullable().optional(),
    tipo_apparato: testo(60).nullable().optional(),
    modello: testo(120).nullable().optional(),
    firmware: testo(120).nullable().optional(),
    seriale: testo(120).nullable().optional(),
    porte: z
      .array(z.object({ porta: z.number().int().min(0).max(65535), protocollo: testo(8), servizio: testo(80).nullable().optional(), versione: testo(120).nullable().optional() }).strict())
      .max(1000)
      .optional(),
    fonti: z.array(testo(40)).max(20).optional(),
    in_ad: z.boolean().nullable().optional(),
    agente_wazuh: z.boolean().nullable().optional(),
  })
  .strict();

export const SchemaInventarioHub = z
  .object({
    schema_versione: z.literal(1),
    codcli: testo(20).optional(),
    nodo: testo(80),
    generato_il: data,
    versione_ipam: testo(40).nullable().optional(),
    reti: z.array(z.object({ cidr: testo(49), nome: testo(120), vlan: z.number().int().nullable().optional(), sede: testo(120).nullable().optional() }).strict()).max(5000),
    oggetti: z.array(Oggetto).max(MAX_OGGETTI_HUB),
  })
  .strict();

/** Le chiavi ammesse dall'hub per un oggetto: la lista bianca locale deve starci dentro. */
export const CHIAVI_OGGETTO_HUB: readonly string[] = Object.keys(Oggetto.shape);

// ── src/app/api/ipam/heartbeat/route.ts ────────────────────────────────────
// `inventario.oggetti` NON è nullable: senza inventari inviati si manda 0.
const quando = z.string().max(40).nullable();
export const BattitoHub = z.object({
  versione: z.string().min(1).max(40),
  generato_il: z.string().min(1).max(40),
  ad: z.object({ ultima_esecuzione: quando, esito: z.string().max(40).nullable() }),
  inventario: z.object({ ultimo_invio: quando, oggetti: z.number().int().nonnegative() }),
  coda: z.object({ in_attesa: z.number().int().nonnegative(), falliti: z.number().int().nonnegative() }),
});
