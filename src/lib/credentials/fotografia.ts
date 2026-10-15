/**
 * Fotografia delle scelte delle credenziali (tappa 2 credenziali, T1 del piano
 * 2026-10-15-tappa2-archivio-credenziali): formato, impronta e confronto.
 *
 * Una fotografia dice, per ogni apparato, host, rete, anteprima edge e host da
 * patchare, quale credenziale viene scelta oggi, con quale porta e con quale
 * segreto (come impronta). Si prende sulla stessa copia dei dati col codice di
 * prima e con quello di dopo: ogni differenza viene dal codice. È la misura di
 * arresto di ogni sotto-tappa.
 *
 * Il formato è fisso per tutte le sotto-tappe: gli script cambiano i lettori
 * (T8, T26), non le righe. Modulo puro: niente DB, niente ambiente.
 */
import crypto from "node:crypto";

export type OggettoFotografia = "apparato" | "host" | "rete" | "edge" | "patch";

const OGGETTI: readonly OggettoFotografia[] = ["apparato", "host", "rete", "edge", "patch"];

export interface SceltaFotografia {
  credential_id: number | null;
  port: number | null;
  /**
   * Da dove viene la scelta. Coi lettori di oggi vale `lettore_vecchio`,
   * seguito dal livello ricostruito (`lettore_vecchio:binding`,
   * `lettore_vecchio:public`, …): serve alle misure (D5), e `--confronta` la
   * guarda solo con `--con-fonte`.
   */
  fonte: string;
  /** Impronta del segreto in chiaro (`impronta()`), mai il segreto. */
  impronta: string;
}

export interface RigaFotografia {
  tenant: string;
  oggetto: OggettoFotografia;
  /** `<id>:<protocollo>`; per catene e anteprima edge `<id rete>:<protocollo|slot>:<posizione>`. */
  chiave: string;
  /** Solo a terminale e nei file sul server, mai nel repo. */
  nome: string;
  scelta: SceltaFotografia | null;
  /** Piano di acquisizione dell'apparato (riga del protocollo principale). */
  piano?: string;
  haSnmp?: boolean;
}

export const FONTE_LETTORE_VECCHIO = "lettore_vecchio";

/** Impronta che vale per un segreto che non si legge (voce senza campi, decifratura fallita). */
export const IMPRONTA_ILLEGGIBILE = "illeggibile";

/**
 * I primi 8 caratteri esadecimali di un HMAC-SHA256 dei byte in chiaro, con la
 * chiave `sha256("credenziali-t2-impronta" + ENCRYPTION_KEY)`. Stabile fra un
 * giro e l'altro con la stessa chiave; senza la chiave non si confronta con un
 * dizionario di community e password deboli (uno sha256 nudo sì).
 */
export function impronta(chiaro: Buffer, encryptionKey: string): string {
  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY assente: l'impronta di un segreto non si calcola senza chiave");
  }
  const chiave = crypto.createHash("sha256").update(`credenziali-t2-impronta${encryptionKey}`, "utf8").digest();
  return crypto.createHmac("sha256", chiave).update(chiaro).digest("hex").slice(0, 8);
}

/** Byte in chiaro di un segreto fatto di più parti (utente e password): separate da NUL. */
export function chiaroDaParti(...parti: string[]): Buffer {
  return Buffer.from(parti.join("\u0000"), "utf8");
}

export type CampoConfronto = "scelta" | "credential_id" | "port" | "impronta" | "fonte" | "piano" | "haSnmp";

export interface Differenza {
  tenant: string;
  oggetto: OggettoFotografia;
  chiave: string;
  nome: string;
  tipo: "solo_prima" | "solo_dopo" | "cambiata";
  campi: Array<{ campo: CampoConfronto; prima: string; dopo: string }>;
}

function chiaveRiga(r: RigaFotografia): string {
  return `${r.tenant}\u0000${r.oggetto}\u0000${r.chiave}`;
}

function indicizza(righe: RigaFotografia[], lato: string): Map<string, RigaFotografia> {
  const m = new Map<string, RigaFotografia>();
  for (const r of righe) {
    const k = chiaveRiga(r);
    if (m.has(k)) {
      throw new Error(`Chiave doppia nella fotografia «${lato}»: ${r.tenant} ${r.oggetto} ${r.chiave}`);
    }
    m.set(k, r);
  }
  return m;
}

const testo = (v: unknown): string => (v === undefined ? "—" : v === null ? "null" : String(v));

/**
 * Differenze fra due fotografie. Di default confronta `credential_id`, `port`,
 * `impronta`, `piano`, `haSnmp` e l'assenza di scelta; con `conFonte` anche
 * `fonte` (solo quando i due lati girano col motore, dalla 2b in poi).
 * Una chiave doppia in un lato è un errore, non una differenza.
 */
export function confrontaFotografie(
  prima: RigaFotografia[],
  dopo: RigaFotografia[],
  opz: { conFonte: boolean },
): Differenza[] {
  const a = indicizza(prima, "prima");
  const b = indicizza(dopo, "dopo");
  const out: Differenza[] = [];
  const base = (r: RigaFotografia) => ({ tenant: r.tenant, oggetto: r.oggetto, chiave: r.chiave, nome: r.nome });

  for (const [k, ra] of a) {
    const rb = b.get(k);
    if (!rb) {
      out.push({ ...base(ra), tipo: "solo_prima", campi: [] });
      continue;
    }
    const campi: Differenza["campi"] = [];
    const vedi = (campo: CampoConfronto, x: unknown, y: unknown) => {
      if (x !== y) campi.push({ campo, prima: testo(x), dopo: testo(y) });
    };
    if ((ra.scelta === null) !== (rb.scelta === null)) {
      campi.push({
        campo: "scelta",
        prima: ra.scelta ? `#${testo(ra.scelta.credential_id)} ${ra.scelta.impronta}` : "nessuna",
        dopo: rb.scelta ? `#${testo(rb.scelta.credential_id)} ${rb.scelta.impronta}` : "nessuna",
      });
    } else if (ra.scelta && rb.scelta) {
      vedi("credential_id", ra.scelta.credential_id, rb.scelta.credential_id);
      vedi("port", ra.scelta.port, rb.scelta.port);
      vedi("impronta", ra.scelta.impronta, rb.scelta.impronta);
      if (opz.conFonte) vedi("fonte", ra.scelta.fonte, rb.scelta.fonte);
    }
    vedi("piano", ra.piano, rb.piano);
    vedi("haSnmp", ra.haSnmp, rb.haSnmp);
    if (campi.length > 0) out.push({ ...base(ra), tipo: "cambiata", campi });
  }
  for (const [k, rb] of b) {
    if (!a.has(k)) out.push({ ...base(rb), tipo: "solo_dopo", campi: [] });
  }
  return out.sort((x, y) =>
    x.tenant.localeCompare(y.tenant) || x.oggetto.localeCompare(y.oggetto) || x.nome.localeCompare(y.nome) || x.chiave.localeCompare(y.chiave)
  );
}

/** Una riga leggibile della differenza: tenant, oggetto, nome, chiave, campi. */
export function descriviDifferenza(d: Differenza): string {
  const testa = `[${d.tenant}] ${d.oggetto} «${d.nome}» (${d.chiave})`;
  if (d.tipo === "solo_prima") return `${testa}: c'è solo prima`;
  if (d.tipo === "solo_dopo") return `${testa}: c'è solo dopo`;
  return `${testa}: ${d.campi.map((c) => `${c.campo} ${c.prima} → ${c.dopo}`).join("; ")}`;
}

function isScelta(v: unknown): v is SceltaFotografia {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Record<string, unknown>;
  return (
    (s.credential_id === null || typeof s.credential_id === "number") &&
    (s.port === null || typeof s.port === "number") &&
    typeof s.fonte === "string" &&
    typeof s.impronta === "string"
  );
}

function isRiga(v: unknown): v is RigaFotografia {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.tenant === "string" &&
    typeof r.oggetto === "string" &&
    (OGGETTI as readonly string[]).includes(r.oggetto) &&
    typeof r.chiave === "string" &&
    typeof r.nome === "string" &&
    (r.scelta === null || isScelta(r.scelta)) &&
    (r.piano === undefined || typeof r.piano === "string") &&
    (r.haSnmp === undefined || typeof r.haSnmp === "boolean")
  );
}

/** Legge un file JSONL di fotografia. Una riga illeggibile è un errore col suo numero, mai saltata. */
export function leggiFotografia(contenuto: string, origine: string): RigaFotografia[] {
  const out: RigaFotografia[] = [];
  const righe = contenuto.split("\n");
  for (let i = 0; i < righe.length; i++) {
    const t = righe[i].trim();
    if (!t) continue;
    let v: unknown;
    try {
      v = JSON.parse(t);
    } catch {
      throw new Error(`${origine}: riga ${i + 1} non è JSON`);
    }
    if (!isRiga(v)) throw new Error(`${origine}: riga ${i + 1} non ha la forma di una riga di fotografia`);
    out.push(v);
  }
  return out;
}

/** Conteggio delle righe per oggetto, per il riepilogo a terminale. */
export function contaPerOggetto(righe: RigaFotografia[]): Record<OggettoFotografia, number> {
  const c: Record<OggettoFotografia, number> = { apparato: 0, host: 0, rete: 0, edge: 0, patch: 0 };
  for (const r of righe) c[r.oggetto] += 1;
  return c;
}
