/**
 * Una sessione SNMP per ogni lettura (spec topologia §13.5.4, SN1). La lettura a mano dello spanning tree apriva UNA
 * sessione e la chiudeva alla fine del primo walk: gli altri, partiti insieme, finivano annullati e davano «nessun valore»
 * (query/route.ts, networks/bulk-scan-devices/route.ts). Qui ogni walk apre la sua e la chiude alla fine; un walk che non
 * risponde entro il suo tempo dà `TEMPO_SCADUTO` e chiude solo la sua. Le sessioni le apre chi chiama, da
 * `snmp-sessione.ts` (ADR 0016).
 *
 * Tre esiti per lettura (spec §13.5.1): le voci lette (anche nessuna); un rifiuto col codice dell'errore, e l'agente che
 * risponde con uno stato d'errore porta `SNMP_STATO_<n>` (net-snmp lo mette in `status`, senza `code`); «non so»,
 * `TEMPO_SCADUTO` o il codice del trasporto. Un errore non diventa mai «nessuna voce». Solo `subtree` (GETNEXT/GETBULK):
 * niente scritture sull'apparato.
 */
import { CODICE_TEMPO_SCADUTO } from "@/lib/devices/ssh-transport";

export type VoceSnmp = { oid: string; value: Buffer | string | number };
export type SnmpWalkFn = (oid: string) => Promise<VoceSnmp[]>;

/** Ciò che serve di una sessione net-snmp. */
export interface SessioneWalk {
  subtree(oid: string, feed: (vbs: Array<{ oid: string; value: unknown }>) => void, done: (err?: Error) => void): void;
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

export function walkConSessioneSua(apri: () => SessioneWalk, tempoMs: number): SnmpWalkFn {
  return (oid) => new Promise<VoceSnmp[]>((resolve, reject) => {
    let s: SessioneWalk;
    try {
      s = apri();
    } catch (e) {
      reject(e);
      return;
    }
    const out: VoceSnmp[] = [];
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
    const fine = (err?: Error): void => {
      if (finito) return;
      finito = true;
      clearTimeout(timer);
      chiudi();
      if (err) reject(conCodice(err));
      else resolve(out);
    };
    try {
      s.subtree(oid, (vbs) => {
        for (const vb of vbs) out.push({ oid: vb.oid, value: vb.value as VoceSnmp["value"] });
      }, fine);
    } catch (e) {
      // net-snmp rifiuta subito un OID che non sa scrivere: è un «no», non un tempo scaduto.
      fine(e instanceof Error ? e : new Error("walk non partito"));
    }
  });
}
