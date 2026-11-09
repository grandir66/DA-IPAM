/**
 * Busta `da-ipam-estrazione` 1.0: il JSON che il Claude Code del PC del tecnico produce (prompt in `prompt-tecnico.md`, §3).
 * Dentro c'è uno snapshot 1.0 come quelli dei collector; la busta aggiunge chi, quando, con quale parser e i comandi
 * lanciati (mai il loro output). Logica pura: validazione, controllo d'identità, rotte per `routing_table`.
 */
import { z } from "zod";
import { ID_COLLECTOR_TECNICO, snapshotSchema, snapshotTecnicoSchema, type AcquisitionSnapshot, type Route } from "@/lib/acquisition/schema";

const iso = z.string().datetime();

export const bustaSchema = z.object({
  formato: z.literal("da-ipam-estrazione"),
  versione: z.literal("1.0"),
  origine: z.literal("tecnico"),
  provenienza: z.object({
    generato_il: iso,
    strumento: z.string().min(1).max(200),
    parser: z.object({ id: z.string().regex(ID_COLLECTOR_TECNICO), versione: z.string().regex(/^\d+\.\d+\.\d+$/) }),
    apparato: z.object({ host: z.string().min(1).max(253) }),
    profilo: z.string().max(100).nullable().optional(),
    /** Facoltativa: se manca la ricava l'import dal tipo dell'apparato in DA-IPAM. */
    famiglia: z.enum(["switch", "router", "firewall"]).nullable().optional(),
  }),
  comandi: z.array(z.object({
    id: z.string().min(1).max(20),
    protocollo: z.enum(["ssh", "snmp", "api"]),
    comando: z.string().min(1).max(500),
    esito: z.enum(["ok", "unsupported", "error", "timeout"]),
    letto_il: iso,
    byte: z.number().int().nonnegative(),
  })).max(500),
  snapshot: z.record(z.string(), z.unknown()),
});
export type Busta = z.infer<typeof bustaSchema>;

export type EsitoBusta =
  | { ok: true; busta: Busta; snapshot: AcquisitionSnapshot }
  | { ok: false; errori: string[] };

const elenco = (e: z.ZodError): string[] => e.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(radice)"}: ${i.message}`);

/**
 * Valida la busta e il suo snapshot. Lo snapshot riceve `origine: { tipo: "tecnico", famiglia }`: se il collector è già nel
 * catalogo vale lo schema stretto, altrimenti quello col collector libero (il collector entra nel prodotto più tardi).
 */
export function validaBusta(dato: unknown, famigliaApparato: "switch" | "router" | "firewall" | null): EsitoBusta {
  const b = bustaSchema.safeParse(dato);
  if (!b.success) return { ok: false, errori: elenco(b.error) };
  const busta = b.data;
  const errori: string[] = [];
  if (busta.snapshot.collector !== busta.provenienza.parser.id) errori.push("snapshot.collector: diverso da provenienza.parser.id");
  if (busta.snapshot.collector_version !== busta.provenienza.parser.versione) errori.push("snapshot.collector_version: diverso da provenienza.parser.versione");
  if (errori.length > 0) return { ok: false, errori };
  const conOrigine = { ...busta.snapshot, origine: { tipo: "tecnico" as const, famiglia: busta.provenienza.famiglia ?? famigliaApparato } };
  const stretto = snapshotSchema.safeParse(conOrigine);
  if (stretto.success) return { ok: true, busta, snapshot: stretto.data };
  const tecnico = snapshotTecnicoSchema.safeParse(conOrigine);
  if (!tecnico.success) return { ok: false, errori: elenco(tecnico.error).map((x) => `snapshot.${x}`) };
  return { ok: true, busta, snapshot: tecnico.data as unknown as AcquisitionSnapshot };
}

const norma = (v: string | null | undefined): string => (v ?? "").trim().toLowerCase();

/**
 * L'estrazione è di questo apparato? Se tutti e due hanno un seriale decide il seriale; altrimenti deve coincidere
 * l'indirizzo. Un IP di gestione cambiato con seriale uguale passa; seriali diversi no, anche con lo stesso IP.
 */
export function stessoApparato(apparato: { host: string; serial_number: string | null }, busta: Busta, snapshot: AcquisitionSnapshot): { ok: true } | { ok: false; motivo: string } {
  const seriale = snapshot.identity.data?.serial_number ?? null;
  if (norma(apparato.serial_number) && norma(seriale)) {
    return norma(apparato.serial_number) === norma(seriale) ? { ok: true } : { ok: false, motivo: "Il seriale dell'estrazione è diverso da quello dell'apparato: l'estrazione è di un altro apparato?" };
  }
  return norma(apparato.host) === norma(busta.provenienza.apparato.host)
    ? { ok: true }
    : { ok: false, motivo: "L'indirizzo dell'estrazione è diverso da quello dell'apparato, e manca un seriale per confrontarli: l'estrazione è di un altro apparato?" };
}

/** `device_type` di DA-IPAM → famiglia della busta; gli altri tipi non ricevono porte da switch. */
export function famigliaDaTipo(tipo: string): "switch" | "router" | "firewall" | null {
  return tipo === "switch" || tipo === "router" || tipo === "firewall" ? tipo : null;
}

const PROTOCOLLI_TABELLA = new Set(["connected", "static", "ospf", "bgp", "rip"]);
export interface RigaRotta { destination: string; gateway: string | null; interface_name: string | null; protocol: string; metric?: number; distance?: number; active: boolean }

/**
 * Rotte dello snapshot → righe di `routing_table` (stessa forma del giro SNMP: `destinazione/prefisso`). Il CHECK della
 * tabella ammette pochi protocolli: gli altri diventano `other`. Doppioni sulla chiave UNIQUE: vince la prima.
 */
export function righeRotte(rotte: readonly Route[]): RigaRotta[] {
  const viste = new Set<string>();
  const out: RigaRotta[] = [];
  for (const r of rotte) {
    const destination = r.destination.includes("/") ? r.destination : `${r.destination}/${r.prefix_len}`;
    const chiave = `${destination}|${r.gateway ?? ""}|${r.interface ?? ""}`;
    if (viste.has(chiave)) continue;
    viste.add(chiave);
    const p = norma(r.protocol);
    out.push({
      destination, gateway: r.gateway, interface_name: r.interface, protocol: PROTOCOLLI_TABELLA.has(p) ? p : "other",
      ...(r.metric != null ? { metric: Math.round(r.metric) } : {}), ...(r.distance != null ? { distance: Math.round(r.distance) } : {}),
      active: r.active !== false,
    });
  }
  return out;
}
