/**
 * A che punto sono i gruppi dell'ultimo lancio di una rete (tavola del Passo 5, oggetto 17). L'avanzamento
 * della rete abbina per CIDR e vede una scansione sola: con più gruppi sulla stessa rete non basta.
 * Qui si parte dagli id salvati al lancio. Nessun lancio registrato = nessuna chiamata alla sonda.
 */
import { getActiveEdgeScanner } from "@/lib/vuln/edge-scanner-db";
import { eSondaSenzaInCorso, listaInCorso, listScans } from "@/lib/vuln/scanner-edge-client";
import { ETICHETTE_FAMIGLIA, type Famiglia } from "./regole";
import { gruppiRecenti, segnaGruppiChiusi, type GruppoLanciato } from "./store";

export type StatoGruppoAperto = "in_corso" | "in_coda" | "finito" | "errore" | "sconosciuto";

export interface GruppoAperto {
  scan_id: number;
  famiglia: Famiglia;
  nome: string;
  device: number;
  stato: StatoGruppoAperto;
  percento: number | null;
  finiti: number | null;
  /** Motivo dell'errore, se la sonda lo dice. */
  messaggio: string | null;
}

export type EsitoGruppiAperti =
  | { stato: "ok"; gruppi: GruppoAperto[] }
  | { stato: "da_aggiornare" }
  | { stato: "errore"; messaggio: string };

/** Pura, per le prove: incrocia ciò che è stato lanciato con ciò che dice la sonda. */
export function statiGruppi(
  lanciati: ReadonlyArray<Pick<GruppoLanciato, "scan_id" | "famiglia" | "device"> & Partial<Pick<GruppoLanciato, "chiuso" | "chiuso_messaggio">>>,
  sonda: {
    inCorso: ReadonlyArray<{ scan_id: number; percento: number | null; finiti: number }>;
    inCoda: ReadonlyArray<{ id: number }>;
    finite: ReadonlyArray<{ id: number }>;
    fallite: ReadonlyArray<{ id: number; error_message?: string | null }>;
  },
): GruppoAperto[] {
  return lanciati.map((g): GruppoAperto => {
    const base = { scan_id: g.scan_id, famiglia: g.famiglia, nome: ETICHETTE_FAMIGLIA[g.famiglia], device: g.device, percento: null, finiti: null, messaggio: null };
    if (g.chiuso === "finito") return { ...base, stato: "finito" };
    if (g.chiuso === "errore") return { ...base, stato: "errore", messaggio: g.chiuso_messaggio ?? null };
    const corre = sonda.inCorso.find((s) => s.scan_id === g.scan_id);
    if (corre) return { ...base, stato: "in_corso", percento: corre.percento, finiti: corre.finiti };
    if (sonda.inCoda.some((s) => s.id === g.scan_id)) return { ...base, stato: "in_coda" };
    if (sonda.finite.some((s) => s.id === g.scan_id)) return { ...base, stato: "finito" };
    const fallita = sonda.fallite.find((s) => s.id === g.scan_id);
    if (fallita) return { ...base, stato: "errore", messaggio: fallita.error_message ?? null };
    return { ...base, stato: "sconosciuto" };
  });
}

/** Il riquadro sparisce solo quando tutti sono finiti bene: un errore non diventa una lista vuota. */
export function gruppiDaMostrare(gruppi: GruppoAperto[]): GruppoAperto[] {
  return gruppi.some((g) => g.stato !== "finito") ? gruppi : [];
}

export async function leggiGruppiAperti(networkId: number): Promise<EsitoGruppiAperti> {
  const lanciati = gruppiRecenti(networkId);
  const daChiedere = lanciati.filter((g) => g.chiuso === null);
  if (daChiedere.length === 0) {
    return { stato: "ok", gruppi: gruppiDaMostrare(statiGruppi(lanciati, { inCorso: [], inCoda: [], finite: [], fallite: [] })) };
  }
  const scanner = getActiveEdgeScanner();
  if (!scanner || scanner.enabled !== 1) return { stato: "errore", messaggio: "Sonda non configurata o disabilitata" };
  try {
    // Una dopo l'altra e in quest'ordine, il verso in cui si muove una scansione: fra due letture
    // parallele un gruppo passato da in coda a in corso non comparirebbe in nessuna delle due.
    const inCoda = await listScans(scanner, undefined, "pending");
    const inCorso = await listaInCorso(scanner);
    const aperti = new Set([...inCorso.map((s) => s.scan_id), ...inCoda.map((s) => s.id)]);
    // Le chiuse si chiedono solo per chi non si sa: l'esito si salva, e i giri dopo non lo richiedono.
    const chiusi = daChiedere.some((g) => !aperti.has(g.scan_id));
    const finite = chiusi ? await listScans(scanner) : [];
    const fallite = chiusi ? await listScans(scanner, undefined, "error") : [];
    const gruppi = statiGruppi(lanciati, { inCorso, inCoda, finite, fallite });
    segnaGruppiChiusi(networkId, gruppi.flatMap((g) =>
      (g.stato === "finito" || g.stato === "errore") && daChiedere.some((d) => d.scan_id === g.scan_id)
        ? [{ scan_id: g.scan_id, chiuso: g.stato, messaggio: g.messaggio }]
        : []));
    return { stato: "ok", gruppi: gruppiDaMostrare(gruppi) };
  } catch (e) {
    if (eSondaSenzaInCorso(e)) return { stato: "da_aggiornare" };
    return { stato: "errore", messaggio: e instanceof Error ? e.message : "Sonda non raggiungibile" };
  }
}
