/**
 * Una sessione SNMP per ogni lettura (spec topologia §13.5.4, SN1). La lettura a mano dello spanning tree apriva UNA
 * sessione e la chiudeva alla fine del primo walk: gli altri, partiti insieme, finivano annullati e davano «nessun valore»
 * (query/route.ts, networks/bulk-scan-devices/route.ts). Qui ogni walk apre la sua e la chiude alla fine; un walk che non
 * risponde entro il suo tempo dà `TEMPO_SCADUTO` e chiude solo la sua. Le sessioni le apre chi chiama, da
 * `snmp-sessione.ts` (ADR 0016).
 *
 * Tre esiti per lettura (spec §13.5.1): le voci lette (anche nessuna); un rifiuto col codice dell'errore, e l'agente che
 * risponde con uno stato d'errore porta `SNMP_STATO_<n>` (net-snmp lo mette in `status`, senza `code`); «non so»,
 * `TEMPO_SCADUTO` o il codice del trasporto. Un errore non diventa mai «nessuna voce». Solo `subtree` (GETNEXT/GETBULK) e
 * `get` (GET degli scalari dello spanning tree, revisione del Task 6 di T2): niente scritture sull'apparato.
 */
import { CODICE_TEMPO_SCADUTO } from "@/lib/devices/ssh-transport";

export type VoceSnmp = { oid: string; value: Buffer | string | number };
export type SnmpWalkFn = (oid: string) => Promise<VoceSnmp[]>;
/** Un GET di più OID in una richiesta: le voci presenti (un OID che non c'è manca dall'elenco, non è un errore). */
export type SnmpGetFn = (oids: string[]) => Promise<VoceSnmp[]>;
/** Le letture in più: il walk, e il GET degli scalari; ogni chiamata con la sua sessione e il suo tempo massimo. */
export type LettoreSnmp = SnmpWalkFn & { get: SnmpGetFn };

/** Ciò che serve di una sessione net-snmp. */
export interface SessioneWalk {
  subtree(oid: string, feed: (vbs: Array<{ oid: string; value: unknown }>) => void, done: (err?: Error) => void): void;
  close(): void;
}

/** Ciò che serve di una sessione net-snmp per il GET. */
export interface SessioneGet {
  get(oids: string[], cb: (err: Error | null | undefined, vbs?: Array<{ oid: string; value: unknown; type?: number }>) => void): void;
  close(): void;
}

/** Il tempo massimo di una lettura nuova (spec §13.5.1). */
export const TEMPO_WALK_MS = 10_000;

/** L'errore col suo codice: lo stato SNMP della risposta quando net-snmp non ne mette uno (RequestFailedError). */
function conCodice(err: Error): Error {
  const e = err as Error & { code?: unknown; status?: unknown };
  if (typeof e.code !== "string" && typeof e.status === "number" && Number.isInteger(e.status)) {
    return Object.assign(err, { code: `SNMP_STATO_${e.status}` });
  }
  return err;
}

const statoDi = (err: Error): unknown => (err as { status?: unknown }).status;

/** Stato SNMP «tooBig»: la risposta al GETBULK non entra in un pacchetto. */
const TOO_BIG = 1;
/**
 * Righe per richiesta dopo un «tooBig» (net-snmp ne chiede 20 di serie). Gli switch Comware IRF della sede 70151 (22/10)
 * rispondevano tooBig alle tabelle Q-BRIDGE, liste di porte lunghe: VLAN e porte taggate mancavano. Il walk si rifà da capo.
 */
const BLOCCHI_RIDOTTI = [5, 1];
type Feed = (vbs: Array<{ oid: string; value: unknown }>) => void;
type SubtreeConBlocchi = (oid: string, maxRepetitions: number, feed: Feed, done: (err?: Error) => void) => void;

export function walkConSessioneSua(apri: () => SessioneWalk, tempoMs: number): SnmpWalkFn {
  return (oid) => new Promise<VoceSnmp[]>((resolve, reject) => {
    let s: SessioneWalk | null = null;
    let out: VoceSnmp[] = [];
    let finito = false;
    const chiudi = (): void => {
      try { s?.close(); } catch { /* già chiusa */ }
    };
    const timer = setTimeout(() => {
      if (finito) return;
      finito = true;
      chiudi();
      reject(Object.assign(new Error(`nessuna risposta entro ${tempoMs} ms`), { code: CODICE_TEMPO_SCADUTO }));
    }, tempoMs);
    const fine = (err?: Error): void => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      chiudi();
      if (err) reject(conCodice(err));
      else resolve(out);
    };
    // Tentativo `n`: 0 = blocchi di serie, poi BLOCCHI_RIDOTTI; ogni tentativo con la sua sessione e da capo (mezza tabella
    // del tentativo caduto non resta).
    const prova = (n: number): void => {
      try {
        s = apri();
      } catch (e) {
        fine(e instanceof Error ? e : new Error("sessione non aperta"));
        return;
      }
      out = [];
      const feed: Feed = (vbs) => {
        for (const vb of vbs) out.push({ oid: vb.oid, value: vb.value as VoceSnmp["value"] });
      };
      const done = (err?: Error): void => {
        if (finito) return;
        if (err && statoDi(err) === TOO_BIG && n < BLOCCHI_RIDOTTI.length) {
          chiudi();
          prova(n + 1);
          return;
        }
        fine(err);
      };
      try {
        if (n === 0) s.subtree(oid, feed, done);
        else (s.subtree as unknown as SubtreeConBlocchi).call(s, oid, BLOCCHI_RIDOTTI[n - 1]!, feed, done);
      } catch (e) {
        // net-snmp rifiuta subito un OID che non sa scrivere: è un «no», non un tempo scaduto.
        fine(e instanceof Error ? e : new Error("walk non partito"));
      }
    };
    prova(0);
  });
}

/** I tipi di varbind che dicono «qui non c'è» (noSuchObject, noSuchInstance, endOfMibView, SNMP v2c): voce assente. */
const ASSENTE = new Set([128, 129, 130]);
/** Lo stato «noSuchName» di SNMP v1: vale per tutta la richiesta, non dice quali OID ci sono. */
const NO_SUCH_NAME = 2;

/**
 * Il GET degli scalari (revisione del Task 6 di T2, piano «Scelte» 10): una sessione e un tempo massimo per tutta la
 * lettura. Un OID che non c'è manca dall'elenco: in v2c lo dice il varbind; in v1 lo stato «noSuchName» vale per la
 * richiesta intera, e allora si chiede un OID alla volta sulla stessa sessione. Ogni altro errore è un «no» col suo stato;
 * il tempo scaduto è «non so».
 */
export function getConSessioneSua(apri: () => SessioneGet, tempoMs: number): SnmpGetFn {
  return (oids) => new Promise<VoceSnmp[]>((resolve, reject) => {
    let s: SessioneGet;
    try {
      s = apri();
    } catch (e) {
      reject(e);
      return;
    }
    let finito = false;
    const chiudi = (): void => {
      try { s.close(); } catch { /* già chiusa */ }
    };
    const timer = setTimeout(() => {
      if (finito) return;
      finito = true;
      chiudi();
      reject(Object.assign(new Error(`nessuna risposta entro ${tempoMs} ms`), { code: CODICE_TEMPO_SCADUTO }));
    }, tempoMs);
    const fine = (err: Error | null, out: VoceSnmp[] = []): void => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      chiudi();
      if (err) reject(conCodice(err));
      else resolve(out);
    };
    const presenti = (vbs: Array<{ oid: string; value: unknown; type?: number }>): VoceSnmp[] =>
      vbs.filter((vb) => !ASSENTE.has(vb.type ?? -1) && vb.value !== null && vb.value !== undefined)
        .map((vb) => ({ oid: vb.oid, value: vb.value as VoceSnmp["value"] }));
    const chiedi = (lista: string[], cb: (err: Error | null, vbs: Array<{ oid: string; value: unknown; type?: number }>) => void): void => {
      try {
        s.get(lista, (err, vbs) => cb(err ?? null, vbs ?? []));
      } catch (e) {
        cb(e instanceof Error ? e : new Error("get non partito"), []);
      }
    };
    chiedi(oids, (err, vbs) => {
      if (!err) return fine(null, presenti(vbs));
      if (statoDi(err) !== NO_SUCH_NAME) return fine(err);
      if (oids.length === 1) return fine(null, []);
      const out: VoceSnmp[] = [];
      const uno = (i: number): void => {
        if (finito) return;
        if (i >= oids.length) return fine(null, out);
        chiedi([oids[i]], (e, v) => {
          if (e && statoDi(e) !== NO_SUCH_NAME) return fine(e);
          if (!e) out.push(...presenti(v));
          uno(i + 1);
        });
      };
      uno(0);
    });
  });
}
