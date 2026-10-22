/**
 * Scansione automatica dei device scelti in Discovery (piano 2026-10-22, Task 2): le regole pure del job
 * `apparati_scelti`. Forma di `config`, le tre frequenze che lo scheduler sa fare, chi entra nel giro e con quale
 * motivo resta fuori, quali letture valgono per ogni tipo. Modulo puro: niente DB, niente Node; lo usano la
 * finestra J2, le rotte e il giro.
 */
import { z } from "zod";
import { senzaCredenzialeProvata } from "@/lib/devices/credenziali-assegnate";

/** Tetto per job: lo stesso della finestra «Rendi apparato» (decisione 3: un giro seriale da 50 sta nell'ora). */
export const MAX_APPARATI = 50;

export const LETTURE = ["info", "porte_mac", "vlan"] as const;
export type Lettura = (typeof LETTURE)[number];

const ORA_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** La `config` del job (decisione 2): `ora` solo per il giornaliero. Il server la ricontrolla, non si fida della finestra. */
export const ConfigApparatiScelti = z.object({
  nome: z.string().trim().min(1).max(80),
  device_ids: z
    .array(z.number().int().positive())
    .min(1)
    .max(MAX_APPARATI)
    .refine((ids) => new Set(ids).size === ids.length, { message: "Apparati ripetuti" }),
  cosa: z
    .object({ info: z.boolean(), porte_mac: z.boolean(), vlan: z.boolean() })
    .refine((c) => c.info || c.porte_mac || c.vlan, { message: "Nessuna lettura scelta" }),
  ora: z.string().regex(ORA_RE).optional(),
});
export type ConfigApparatiScelti = z.infer<typeof ConfigApparatiScelti>;

/** La `config` salvata nel job, o null se manca, non è JSON o non ha la forma giusta (chi chiama lo dice). */
export function leggiConfig(configStr: string | null): ConfigApparatiScelti | null {
  if (configStr == null) return null;
  let grezza: unknown;
  try {
    grezza = JSON.parse(configStr);
  } catch {
    return null;
  }
  const r = ConfigApparatiScelti.safeParse(grezza);
  return r.success ? r.data : null;
}

// ── Frequenze (decisione 7: tre scelte, nessuna frequenza libera) ──────────

export type Frequenza = { tipo: "ora" } | { tipo: "4ore" } | { tipo: "giorno"; ora: string };

export function intervalloDaFrequenza(f: Frequenza): 60 | 240 | 1440 {
  return f.tipo === "ora" ? 60 : f.tipo === "4ore" ? 240 : 1440;
}

/** La frequenza di un job salvato; null = una forma che la finestra non sa fare (giornaliero senza ora, altri intervalli). */
export function frequenzaDaJob(intervalMinutes: number, config: { ora?: string }): Frequenza | null {
  if (intervalMinutes === 60) return { tipo: "ora" };
  if (intervalMinutes === 240) return { tipo: "4ore" };
  if (intervalMinutes === 1440 && typeof config.ora === "string" && ORA_RE.test(config.ora)) return { tipo: "giorno", ora: config.ora };
  return null;
}

export function etichettaFrequenza(f: Frequenza): string {
  return f.tipo === "ora" ? "ogni ora" : f.tipo === "4ore" ? "ogni 4 ore" : `ogni giorno alle ${f.ora}`;
}

/** «H:M» → ore e minuti; da usare solo su un'ora già validata. */
export function oraDaTesto(ora: string): { h: number; m: number } {
  const [h, m] = ora.split(":").map(Number);
  return { h, m };
}

/**
 * Il prossimo scatto dopo `adesso` (strettamente dopo), nell'ora del server come node-cron: «ogni ora» = `0 *\/1`,
 * «ogni 4 ore» = `0 *\/4` (00, 04, 08, …), «ogni giorno» = l'ora scelta, oggi se non è passata, altrimenti domani.
 */
export function prossimaEsecuzione(f: Frequenza, adesso: Date): Date {
  const p = new Date(adesso.getTime());
  if (f.tipo === "giorno") {
    const { h, m } = oraDaTesto(f.ora);
    p.setHours(h, m, 0, 0);
    if (p.getTime() <= adesso.getTime()) p.setDate(p.getDate() + 1);
    return p;
  }
  const passo = f.tipo === "ora" ? 1 : 4;
  p.setMinutes(0, 0, 0);
  do {
    p.setHours(p.getHours() + 1);
  } while (p.getHours() % passo !== 0 || p.getTime() <= adesso.getTime());
  return p;
}

// ── Idoneità (decisione 5) ──────────────────────────────────────────────

export type MotivoEsclusione = "NON_APPARATO" | "TOLTO" | "SENZA_CREDENZIALE" | "CREDENZIALE_NON_PROVATA" | "DISATTIVATO" | "NON_LEGGIBILE";

/**
 * Lo stato di un apparato per il job, come lo legge `statoApparatiPerHost`/`statoApparatiPerDevice` (una query).
 * `host_id` e `device_id` entrambi null = l'id chiesto non c'è più. `validate_sul_host` = credenziali validate
 * sull'host (null = apparato senza host); `binding_riusciti` = binding `success` dell'apparato (contano solo senza host).
 * `leggibile` lo calcola chi chiama con `resolveDeviceAcquisition`.
 */
export interface StatoApparato {
  host_id: number | null;
  device_id: number | null;
  enabled: boolean;
  credenziali_memorizzate: number;
  validate_sul_host: number | null;
  binding_riusciti: number;
  leggibile: boolean;
  tipo: { device_type: string; vendor: string | null; protocol: string | null; usa_arp: boolean; vlan_switch: boolean };
}

export const TESTO_MOTIVO: Record<MotivoEsclusione, string> = {
  NON_APPARATO: "non è un apparato",
  TOLTO: "apparato tolto",
  SENZA_CREDENZIALE: "nessuna credenziale memorizzata",
  CREDENZIALE_NON_PROVATA: "credenziale non provata",
  DISATTIVATO: "apparato disattivato",
  NON_LEGGIBILE: "lettura non disponibile per questo tipo di apparato",
};

/**
 * Entra nel giro? Ordine dei motivi: NON_APPARATO, TOLTO, DISATTIVATO, NON_LEGGIBILE, SENZA_CREDENZIALE,
 * CREDENZIALE_NON_PROVATA. «Provata» è la definizione unica di `senzaCredenzialeProvata`: con l'host vale l'host,
 * solo un apparato senza host ricade sui binding.
 */
export function valutaApparato(s: StatoApparato): { incluso: true } | { incluso: false; motivo: MotivoEsclusione } {
  if (s.device_id == null) return { incluso: false, motivo: s.host_id == null ? "TOLTO" : "NON_APPARATO" };
  if (!s.enabled) return { incluso: false, motivo: "DISATTIVATO" };
  if (!s.leggibile) return { incluso: false, motivo: "NON_LEGGIBILE" };
  if (s.credenziali_memorizzate <= 0) return { incluso: false, motivo: "SENZA_CREDENZIALE" };
  const bindings = s.binding_riusciti > 0 ? [{ test_status: "success" as const }] : [];
  if (senzaCredenzialeProvata(s.validate_sul_host, bindings)) return { incluso: false, motivo: "CREDENZIALE_NON_PROVATA" };
  return { incluso: true };
}

/**
 * Le letture che valgono per un tipo (decisione 9): informazioni per ogni apparato leggibile; porte e MAC per i
 * router con ARP e il ramo switch; VLAN per gli switch della lettura `switch_vlan` o i router MikroTik via SSH.
 */
export function lettureValide(t: StatoApparato["tipo"]): Lettura[] {
  const out: Lettura[] = ["info"];
  if (t.usa_arp || t.device_type === "switch") out.push("porte_mac");
  if (t.vlan_switch || (t.device_type === "router" && t.vendor === "mikrotik" && t.protocol === "ssh")) out.push("vlan");
  return out;
}

// ── Esiti per apparato (decisione 11) ─────────────────────────────────────

/** Stato di una riga di `job_apparati_esiti`: validato nel codice (la tabella non ha CHECK). */
export const STATI_ESITO = ["ok", "parziale", "errore", "escluso", "saltato"] as const;
export type StatoEsito = (typeof STATI_ESITO)[number];

/** Esito di una lettura scelta: `codice` è un codice (mai un messaggio con nomi o IP). */
export interface EsitoLettura {
  stato: string;
  codice?: string;
}

/** L'ultimo esito di un apparato in un job. */
export interface EsitoRiga {
  device_id: number;
  giro_il: string;
  stato: StatoEsito;
  letture: Record<string, EsitoLettura>;
  motivo: string | null;
}
