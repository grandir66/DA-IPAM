/**
 * Registro dei ripieghi del facade del database (NUC-1, fase A).
 *
 * Un «ripiego» è un accesso al database che non passa da un contesto tenant:
 *   - `default`: `getDb()` senza contesto, con hub presente, va su DEFAULT.db;
 *   - `legacy`: `getDb()` senza contesto, con hub presente, apre ipam.db;
 *   - `tenant_non_registrato`: `getTenantDb(code)` sta per CREARE il file di un
 *     tenant che l'hub non conosce.
 * In fase A l'esito non cambia: si conta chi lo fa, per sapere chi va corretto
 * prima di trasformare il ripiego in errore (fase B).
 *
 * Tappa 2 credenziali (T7, 16/10): anche il motore delle credenziali registra
 * quando sceglie da una fonte vecchia, così la pulizia della 2g si decide su
 * una misura e non a occhio:
 *   - `cred_binding_inline`: segreto scritto dentro un binding, senza voce;
 *   - `cred_colonna_apparato`: colonne di `network_devices` (voce o segreto);
 *   - `cred_catena_vecchia`: `host_detect_credential` / `network_host_credentials`;
 *   - `cred_chiave_hub`: `host_windows_credential_id` / `host_linux_credential_id`;
 *   - `cred_riga_integrazione`: colonne di controller e AD (2f);
 *   - `cred_public`: community della rete, dell'override, public/private (D5);
 *   - `cred_v3_vecchia`: SNMPv3 nel formato vecchio (utente + password).
 * La firma resta quella di chi chiama il motore (`credentials/resolve.ts` è
 * fra i file interni), cioè il lettore che va spostato.
 *
 * PERCHÉ un registro su file e non solo un contatore: il contatore in memoria
 * riparte a ogni aggiornamento (su `dev` arrivano più volte al giorno), e la
 * verifica di NUC-1 è «chi ripiega in una settimana». Il file sì sopravvive.
 *
 * Forma del registro: JSONL, un file al giorno in `<DATA_DIR>/logs/ripieghi/`,
 * tenuto `GIORNI_CONSERVATI` giorni (la pulizia la fa questo modulo).
 * Righe:
 *   - `tipo:"stack"` una volta per firma e per processo (dove si chiama, intero);
 *   - `tipo:"conteggio"` per (firma, ora) quando il conteggio di quell'ora tocca
 *     1, 10, 100, 1000…: il numero vero dell'ora è il massimo `n` letto, con
 *     un'approssimazione per ordine di grandezza. Mille chiamate = quattro righe.
 *   - `tipo:"limite"` se in un'ora le righe di conteggio superano
 *     `MAX_RIGHE_ORA`: da lì fino all'ora dopo si conta solo in memoria. Le
 *     righe di stack restano fuori dal tetto (una per firma e per processo).
 *
 * Non lancia mai: il registro non deve far fallire l'accesso che registra.
 * Nessun dato del cliente: solo caso, codice del tenant, firma del chiamante.
 */
import fs from "node:fs";
import path from "node:path";
import { resolveDataDir } from "../data-dir";

export type CasoRipiego =
  | "default"
  | "legacy"
  | "tenant_non_registrato"
  | "cred_colonna_apparato"
  | "cred_binding_inline"
  | "cred_catena_vecchia"
  | "cred_chiave_hub"
  | "cred_riga_integrazione"
  | "cred_public"
  | "cred_v3_vecchia";

export const GIORNI_CONSERVATI = 30;
export const MAX_RIGHE_ORA = 200;
const MAX_FIRME = 500;

interface Chiamante {
  firma: string;
  caso: CasoRipiego;
  tenant: string | null;
  n: number;
  ultimo: string;
  ora: string;
  nOra: number;
}

interface Stato {
  totale: number;
  perCaso: Partial<Record<CasoRipiego, number>>;
  chiamanti: Map<string, Chiamante>;
  stackScritti: Set<string>;
  oraCorrente: string;
  righeOra: number;
  limiteSegnalato: boolean;
  ultimaPulizia: string;
}

// Su globalThis: sotto tsx possono coesistere due istanze dello stesso modulo
// (vedi no-dynamic-db-tenant-import.test.ts) e il conteggio deve essere uno.
const CHIAVE = Symbol.for("da-ipam.db-maintenance.ripieghi");
function stato(): Stato {
  const g = globalThis as unknown as Record<symbol, Stato | undefined>;
  let s = g[CHIAVE];
  if (!s) {
    s = {
      totale: 0,
      perCaso: {},
      chiamanti: new Map(),
      stackScritti: new Set(),
      oraCorrente: "",
      righeOra: 0,
      limiteSegnalato: false,
      ultimaPulizia: "",
    };
    g[CHIAVE] = s;
  }
  return s;
}

/** Cartella del registro (letta a ogni chiamata: segue `DA_INVENT_DATA_DIR`). */
export function DIR_REGISTRO_RIPIEGHI(): string {
  return path.join(resolveDataDir(), "logs", "ripieghi");
}

// Frame del facade e del registro, riconoscibili solo quando si gira dai
// sorgenti (tsx: scheduler, script). Nel build di Next i file si chiamano
// `.next/server/chunks/<hash>._.js` e i nomi delle funzioni sono minificati.
const FILE_INTERNI = /[\\/](db|db-tenant|ripieghi)\.[cm]?[jt]s\b|[\\/]credentials[\\/]resolve\.[cm]?[jt]s\b/;
const FRAME_ESTRANEI = /node:internal|[\\/]node_modules[\\/]/;
/** Frame del build messi in catena nella firma: getDb, la funzione dati, la rotta, il suo chiamante. */
const FRAME_CATENA = 6;

/** Stack dal chiamante di `registraRipiego` in giù (il registro stesso è escluso per riferimento, non per nome). */
function righeStack(): string[] {
  const vecchioLimite = Error.stackTraceLimit;
  Error.stackTraceLimit = 25;
  const contenitore: { stack?: string } = {};
  Error.captureStackTrace(contenitore, registraRipiego);
  Error.stackTraceLimit = vecchioLimite;
  return (contenitore.stack ?? "").split("\n").slice(1).map((r) => r.trim());
}

function scomponi(riga: string): { funzione: string | null; file: string; posizione: string } | null {
  const m = /^at (?:async )?(?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(riga);
  if (!m) return null;
  return { funzione: m[1] ?? null, file: m[2].replace(/^file:\/\//, ""), posizione: `${m[3]}:${m[4]}` };
}

/**
 * Firma del chiamante.
 * - Dai sorgenti: «funzione @ src/…/file.ts:riga:colonna» del primo frame fuori
 *   dal facade.
 * - Dal build di Next (nessun frame sotto `/src/`): la catena dei primi frame,
 *   «chunk:riga:colonna < …». Un frame solo non basta: nel build è getDb,
 *   uguale per tutti; la rotta che chiama sta qualche frame più in basso.
 */
export function firmaDa(righe: string[]): string {
  const frame = righe.filter((r) => r.startsWith("at ") && !FRAME_ESTRANEI.test(r));
  const sorgente = frame.find((r) => /[\\/]src[\\/]/.test(r) && !FILE_INTERNI.test(r));
  if (sorgente) {
    const p = scomponi(sorgente);
    if (!p) return sorgente.slice(3, 160);
    const idx = p.file.lastIndexOf("/src/");
    return `${p.funzione ?? "<anonima>"} @ ${p.file.slice(idx + 1)}:${p.posizione}`;
  }
  const catena = frame
    .filter((r) => !FILE_INTERNI.test(r))
    .slice(0, FRAME_CATENA)
    .map((r) => {
      const p = scomponi(r);
      if (!p) return r.slice(3, 80);
      const idx = p.file.lastIndexOf("/.next/server/");
      const corto = idx >= 0 ? p.file.slice(idx + "/.next/server/".length) : p.file.split(/[\\/]/).slice(-2).join("/");
      return `${corto}:${p.posizione}`;
    });
  return catena.length > 0 ? catena.join(" < ").slice(0, 600) : "sconosciuto";
}

function scrivi(riga: Record<string, unknown>, adesso: Date): void {
  const dir = DIR_REGISTRO_RIPIEGHI();
  fs.mkdirSync(dir, { recursive: true });
  const giorno = adesso.toISOString().slice(0, 10);
  fs.appendFileSync(path.join(dir, `ripieghi-${giorno}.jsonl`), `${JSON.stringify(riga)}\n`);
  const s = stato();
  if (s.ultimaPulizia !== giorno) {
    s.ultimaPulizia = giorno;
    pulisci(dir, adesso);
  }
}

function pulisci(dir: string, adesso: Date): void {
  const soglia = new Date(adesso.getTime() - GIORNI_CONSERVATI * 86_400_000).toISOString().slice(0, 10);
  for (const f of fs.readdirSync(dir)) {
    const m = /^ripieghi-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (m && m[1] < soglia) fs.rmSync(path.join(dir, f), { force: true });
  }
}

function potenzaDiDieci(n: number): boolean {
  while (n >= 10 && n % 10 === 0) n /= 10;
  return n === 1;
}

/** Conta un ripiego. Non lancia, non cambia l'esito dell'accesso. */
export function registraRipiego(caso: CasoRipiego, tenant: string | null = null): void {
  try {
    const s = stato();
    const adesso = new Date();
    const ora = adesso.toISOString().slice(0, 13);
    s.totale += 1;
    s.perCaso[caso] = (s.perCaso[caso] ?? 0) + 1;

    if (s.oraCorrente !== ora) {
      s.oraCorrente = ora;
      s.righeOra = 0;
      s.limiteSegnalato = false;
    }

    const righe = righeStack();
    const firma = firmaDa(righe);
    const chiave = `${caso}|${tenant ?? ""}|${firma}`;
    let c = s.chiamanti.get(chiave);
    if (!c) {
      if (s.chiamanti.size >= MAX_FIRME) {
        // Tetto alla memoria: si scarta il chiamante visto meno di recente.
        let vecchia: string | null = null;
        let quando = "￿";
        for (const [k, v] of s.chiamanti) if (v.ultimo < quando) { quando = v.ultimo; vecchia = k; }
        if (vecchia) s.chiamanti.delete(vecchia);
      }
      c = { firma, caso, tenant, n: 0, ultimo: "", ora, nOra: 0 };
      s.chiamanti.set(chiave, c);
    }
    c.n += 1;
    c.ultimo = adesso.toISOString();
    if (c.ora !== ora) { c.ora = ora; c.nOra = 0; }
    c.nOra += 1;

    const base = { ts: c.ultimo, caso, tenant, firma };
    if (!s.stackScritti.has(chiave)) {
      // La riga di stack sta FUORI dal tetto orario: è già limitata a una per
      // firma e per processo, ed è proprio il dettaglio che serve per correggere
      // il chiamante. Si segna come scritta solo dopo averla scritta.
      scrivi({ ...base, tipo: "stack", stack: righe.filter((r) => !/node:internal/.test(r)).slice(0, 15) }, adesso);
      s.stackScritti.add(chiave);
      // Una sola riga nel journal per chiamante e processo: niente inondazione.
      console.warn(`[db] ripiego ${caso}${tenant ? ` (${tenant})` : ""} da ${firma}`);
    }
    if (potenzaDiDieci(c.nOra)) {
      if (s.righeOra < MAX_RIGHE_ORA) {
        s.righeOra += 1;
        scrivi({ ...base, tipo: "conteggio", ora, n: c.nOra }, adesso);
      } else if (!s.limiteSegnalato) {
        s.limiteSegnalato = true;
        scrivi({ ts: c.ultimo, tipo: "limite", ora, max_righe: MAX_RIGHE_ORA }, adesso);
      }
    }
  } catch {
    /* il registro non fa mai fallire l'accesso che registra */
  }
}

/** Il solo numero aggregato: è quello che può uscire da un endpoint pubblico. */
export function contaRipieghi(): number {
  return stato().totale;
}

export interface RiepilogoRipieghi {
  totale: number;
  per_caso: Partial<Record<CasoRipiego, number>>;
  chiamanti: Array<{ firma: string; caso: CasoRipiego; tenant: string | null; n: number; ultimo: string }>;
}

/** Dettaglio dal processo corrente (riparte a ogni avvio: lo storico è nel file). */
export function riepilogoRipieghi(limite = 20): RiepilogoRipieghi {
  const s = stato();
  const chiamanti = [...s.chiamanti.values()]
    .sort((a, b) => (a.ultimo < b.ultimo ? 1 : a.ultimo > b.ultimo ? -1 : 0))
    .slice(0, limite)
    .map(({ firma, caso, tenant, n, ultimo }) => ({ firma, caso, tenant, n, ultimo }));
  return { totale: s.totale, per_caso: { ...s.perCaso }, chiamanti };
}

/**
 * Il dettaglio è lo stato dell'intero processo: firme del codice e codici di
 * TUTTI i tenant coinvolti. Lo riceve solo il superadmin; gli altri ruoli, che
 * vedono un tenant solo, non ricevono niente (il numero è già in /api/health).
 */
export function riepilogoPerRuolo(ruolo: string | undefined): RiepilogoRipieghi | undefined {
  return ruolo === "superadmin" ? riepilogoRipieghi() : undefined;
}
