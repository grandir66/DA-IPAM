/**
 * Un'acquisizione con un collector, dal pulsante d'acquisizione della scheda (tavola C1: «è l'acquisizione normale
 * dell'apparato con un altro formato»). Un tentativo solo: la richiesta si costruisce nel backend con le voci della
 * fonte, il collector legge, lo snapshot si salva (anche un errore, come fatto da mostrare), poi le proiezioni
 * popolano l'apparato in una transazione (`applica.ts`). Nessuna seconda credenziale, nemmeno dopo un'uscita parziale.
 *
 * Una sola acquisizione per apparato alla volta (lucchetto in memoria, come le scansioni, ADR 0006). Se il processo
 * cade a metà non resta nulla da pulire: lo snapshot si scrive solo a lettura finita e le sessioni le chiude il
 * trasporto del collector (`withSshClient`, `session.close`).
 */
import { acquisitionInputSchema, collectDevice, snapshotSchema, type AcquisitionRequest, type AcquisitionSnapshot, type CollectorId } from "@/lib/acquisition";
import { redactSnapshot } from "@/lib/acquisition/redact";
import { getCurrentTenantCode } from "@/lib/db-tenant";
import { contieneSegreto, salvaSnapshot, type CredenzialiUsate } from "./archivio";
import { applicaSnapshot, type EsitoApplicazione } from "./applica";
import { costruisciRichiesta, type ApparatoPerRichiesta, type LettoreSegreto } from "./richiesta";
import { snapshotDiErrore } from "./snapshot-errore";
import type { CredenzialiProposte } from "./fonte";

const IN_CORSO_KEY = "__daipam_acquisizione_modulare_in_corso__" as const;

function inCorso(): Set<string> {
  const g = globalThis as Record<string, unknown>;
  if (!g[IN_CORSO_KEY]) g[IN_CORSO_KEY] = new Set<string>();
  return g[IN_CORSO_KEY] as Set<string>;
}

const chiave = (deviceId: number): string => `${getCurrentTenantCode() ?? "-"}:${deviceId}`;

export function acquisizioneInCorso(deviceId: number): boolean {
  return inCorso().has(chiave(deviceId));
}

/** Prende il lucchetto dell'apparato; false se un'acquisizione modulare è già in corso. */
export function prendiLucchetto(deviceId: number): boolean {
  const k = chiave(deviceId);
  if (inCorso().has(k)) return false;
  inCorso().add(k);
  return true;
}

export function lasciaLucchetto(deviceId: number): void {
  inCorso().delete(chiave(deviceId));
}

export interface DipendenzeEsecuzione {
  collect(request: AcquisitionRequest): Promise<AcquisitionSnapshot>;
  leggi: LettoreSegreto;
  adesso(): Date;
}

export interface EsitoEsecuzione {
  snapshotId: number;
  status: AcquisitionSnapshot["status"];
  sezioni: Record<string, string>;
  /** Cosa è cambiato nell'apparato; null se lo snapshot è in errore (non si applica niente). */
  applicazione: EsitoApplicazione | null;
  /** Codice dell'errore prima o durante la lettura (richiesta, eccezione); null se il collector ha risposto. */
  errore: string | null;
}

export interface ParametriEsecuzione {
  deviceId: number;
  device: ApparatoPerRichiesta;
  collector: CollectorId;
  credenziali: CredenzialiProposte;
  utente: { id: number | null; nome: string | null } | null;
  log?: (riga: string) => void;
}

function usate(c: CredenzialiProposte): CredenzialiUsate {
  return Object.fromEntries(Object.entries(c).map(([p, v]) => [p, { credential_id: v.credential_id, nome: v.nome }]));
}

/** Chi chiama ha già preso il lucchetto (`prendiLucchetto`); qui lo si lascia sempre, anche su eccezione. */
export async function eseguiAcquisizioneModulare(p: ParametriEsecuzione, deps: DipendenzeEsecuzione): Promise<EsitoEsecuzione> {
  const log = p.log ?? (() => {});
  try {
    const inizio = deps.adesso();
    let snapshot: AcquisitionSnapshot;
    let segreti: string[] = [];
    let errore: string | null = null;
    const costruita = costruisciRichiesta(p.collector, p.device, p.credenziali, deps.leggi);
    if (!costruita.ok) {
      errore = costruita.codice;
      log(`✗ ${costruita.motivo}`);
      snapshot = snapshotDiErrore(p.collector, p.device.host, costruita.codice, inizio);
    } else {
      segreti = costruita.segreti;
      const input = acquisitionInputSchema.safeParse(costruita.richiesta);
      if (!input.success) {
        errore = "REQUEST_INVALID";
        log("✗ Richiesta al collector non valida (credenziale di forma non ammessa dal collector)");
        snapshot = snapshotDiErrore(p.collector, p.device.host, errore, inizio);
      } else {
        log(`Lettura con ${p.collector} (${Object.keys(p.credenziali).map((x) => x.toUpperCase()).join(" + ")})...`);
        try {
          snapshot = redactSnapshot(await deps.collect(costruita.richiesta), input.data);
        } catch {
          // Il messaggio dell'eccezione può contenere ciò che l'apparato ha risposto: si tiene solo il codice.
          errore = "COLLECTOR_EXCEPTION";
          log("✗ Il collector si è interrotto: nessun dato letto");
          snapshot = snapshotDiErrore(p.collector, p.device.host, errore, inizio, deps.adesso().getTime() - inizio.getTime());
        }
      }
    }
    // Ultime due guardie prima del DB: uno snapshot fuori schema o con un segreto in un testo non si salva com'è, ma
    // diventa un errore col solo codice, così la scheda lo mostra invece di non mostrare niente.
    if (!snapshotSchema.safeParse(snapshot).success) {
      errore = "SNAPSHOT_INVALID";
      log("✗ Il collector ha prodotto uno snapshot fuori dallo schema 1.0: salvato come errore");
      snapshot = snapshotDiErrore(p.collector, p.device.host, errore, inizio, snapshot.duration_ms ?? 0);
    } else if (contieneSegreto(snapshot, segreti)) {
      errore = "SNAPSHOT_SECRET";
      log("✗ Lo snapshot conteneva una credenziale: non salvato, al suo posto un errore");
      snapshot = snapshotDiErrore(p.collector, p.device.host, errore, inizio, snapshot.duration_ms ?? 0);
    }
    const snapshotId = salvaSnapshot(p.deviceId, snapshot, { credenziali: usate(p.credenziali), utente: p.utente, segreti });
    const sezioni = Object.fromEntries(Object.entries(snapshot).filter(([, v]) => v && typeof v === "object" && "status" in (v as object))
      .map(([k, v]) => [k, (v as { status: string }).status]));
    log(`${snapshot.status === "ok" ? "✓" : snapshot.status === "partial" ? "▲" : "✕"} Snapshot #${snapshotId} salvato (${snapshot.status})`);
    let applicazione: EsitoApplicazione | null = null;
    if (snapshot.status !== "error") {
      applicazione = applicaSnapshot(p.deviceId, snapshotId, snapshot);
      log(`✓ Apparato aggiornato: ${applicazione.scritte} modifiche, ${applicazione.manuali} valori a mano lasciati${applicazione.ignorate.length ? `, sezioni non usate: ${applicazione.ignorate.map((x) => `${x.sezione} (${x.stato})`).join(", ")}` : ""}`);
    }
    return { snapshotId, status: snapshot.status, sezioni, applicazione, errore };
  } finally {
    lasciaLucchetto(p.deviceId);
  }
}

export const DIPENDENZE_VERE: Pick<DipendenzeEsecuzione, "collect" | "adesso"> = {
  collect: (r) => collectDevice(r),
  adesso: () => new Date(),
};
