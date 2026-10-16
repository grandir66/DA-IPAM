/**
 * Salvataggio di una rete con le sue credenziali: POST /api/networks e
 * PUT /api/networks/[id] (tappa 2 credenziali, T12 e T17, 16/10).
 *
 * Sta fuori dalle rotte per poterlo provare: le rotte passano dalla sessione
 * di NextAuth, che in una prova non c'è.
 *
 * Prima:
 * - il PUT ignorava `credential_ids`. La pagina della rete salvava la lista
 *   con una seconda richiesta in parallelo, che ingoiava gli errori, e
 *   rimandava le quattro catene vecchie, nascoste nella pagina;
 * - le catene si scrivevano dopo la rete: una voce rifiutata rispondeva 400
 *   con la rete già creata o già modificata.
 * Ora rete, router e lista stanno in una transazione sola: una voce rifiutata
 * non lascia scritto niente, e la rotta lo dice con un 400.
 *
 * Dalla 2d (T17) le catene vecchie per ruolo non si scrivono più: la rete ha
 * una lista sola, e la conversione del T16 vi ha già portato quelle che
 * c'erano. I quattro campi `windows/linux/ssh/snmp_credential_ids` di un
 * client vecchio si controllano per ruolo prima di creare la rete e si
 * accodano alla lista; la risposta porta `avvisi` e il log una riga, così chi
 * li manda lo sa invece di vederli ignorati.
 */
import type { z } from "zod";
import type { Network } from "@/types";
import type { NetworkCreateSchema, NetworkUpdateSchema } from "@/lib/validators";
import {
  getDb,
  createNetwork,
  updateNetwork,
  getNetworkById,
  setNetworkRouter,
  deleteNetworkRouter,
  getNetworkRouterId,
  getCredentialById,
  replaceNetworkCredentials,
  addNetworkCredential,
  getNetworkCredentials,
  type NetworkCredentialRow,
} from "@/lib/db";
import { CredenzialeNonAmmessa } from "@/lib/credentials/lista-rete";
import { etichettaTipo, tipiPerRuoloVecchio } from "@/lib/credentials/tipi";

/** Una credenziale della richiesta non vale per la rete: la rotta risponde 400. */
export class CredenzialiReteNonValide extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "CredenzialiReteNonValide";
  }
}

/** L'avviso nella risposta quando la richiesta usa i campi delle catene vecchie. */
export const AVVISO_CAMPI_VECCHI = "windows/linux/ssh/snmp_credential_ids sono superati: usare credential_ids";

type DatiCreazione = z.infer<typeof NetworkCreateSchema>;
type DatiModifica = z.infer<typeof NetworkUpdateSchema>;
type CampiVecchi = Pick<DatiCreazione, "windows_credential_ids" | "linux_credential_ids" | "ssh_credential_ids" | "snmp_credential_ids">;

/** I campi vecchi nell'ordine con cui la conversione della 2d accoda i ruoli. */
const CAMPI_VECCHI = [
  ["windows_credential_ids", "windows"],
  ["ssh_credential_ids", "ssh"],
  ["linux_credential_ids", "linux"],
  ["snmp_credential_ids", "snmp"],
] as const;

export interface ReteCreata extends Network {
  /** Solo se la richiesta usava i campi superati. */
  avvisi?: string[];
}

export interface ReteSalvata extends Network {
  router_id: number | null;
  credential_ids: number[];
  network_credentials: NetworkCredentialRow[];
  /** Solo se la richiesta usava i campi superati. */
  avvisi?: string[];
}

/** Codice di un errore di SQLite (`SQLITE_…`), o null per un errore che non viene dal DB. */
function codiceSqlite(e: unknown): string | null {
  const codice = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof codice === "string" && codice.startsWith("SQLITE_") ? codice : null;
}

/** Un id che non c'è più nell'archivio, o una voce che non vale per una rete (UniFi, Omada, AD: T13), è un rifiuto, non un 500. */
function rifiuto(e: unknown): never {
  if (e instanceof CredenzialeNonAmmessa) throw new CredenzialiReteNonValide(e.message);
  if (codiceSqlite(e) === "SQLITE_CONSTRAINT_FOREIGNKEY") {
    throw new CredenzialiReteNonValide("Una delle credenziali scelte non esiste più nell'archivio: ricarica la pagina");
  }
  throw e;
}

/** La lista unica della rete, sostituita. */
function lista(networkId: number, ids: number[]): void {
  try {
    replaceNetworkCredentials(networkId, ids);
  } catch (e) {
    rifiuto(e);
  }
}

/** Voci accodate alla lista che c'è (una voce già presente resta dov'è). */
function accoda(networkId: number, ids: number[]): void {
  for (const id of ids) {
    try {
      addNetworkCredential(networkId, id);
    } catch (e) {
      rifiuto(e);
    }
  }
}

/**
 * Le voci dei campi vecchi, in ordine di ruolo e senza doppioni, controllate
 * PRIMA di scrivere: la voce deve esistere e valere per il ruolo (stessa
 * regola con cui le leggeva il motore). `usati` dice se la richiesta li
 * mandava, anche vuoti.
 */
function vociDaCampiVecchi(d: CampiVecchi): { ids: number[]; usati: string[] } {
  const ids: number[] = [];
  const usati: string[] = [];
  for (const [campo, ruolo] of CAMPI_VECCHI) {
    const valori = d[campo];
    if (valori === undefined) continue;
    usati.push(campo);
    for (const id of valori) {
      const voce = getCredentialById(id);
      if (!voce) throw new CredenzialiReteNonValide("Una delle credenziali scelte non esiste più nell'archivio: ricarica la pagina");
      const tipo = String(voce.credential_type);
      if (!tipiPerRuoloVecchio(ruolo).includes(tipo)) {
        throw new CredenzialiReteNonValide(`La credenziale «${voce.name}» (${etichettaTipo(tipo)}) non vale per il ruolo ${ruolo} (${campo})`);
      }
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return { ids, usati };
}

/** A salvataggio riuscito: la riga nel log e l'avviso nella risposta, se la richiesta usava i campi superati. */
function avvisi(networkId: number, vecchi: { ids: number[]; usati: string[] }): { avvisi?: string[] } {
  if (vecchi.usati.length === 0) return {};
  console.warn(`[reti] rete #${networkId}: campi superati ${vecchi.usati.join(", ")} → ${vecchi.ids.length} voci accodate alla lista`);
  return { avvisi: [AVVISO_CAMPI_VECCHI] };
}

function letturaRete(networkId: number): ReteSalvata | null {
  const rete = getNetworkById(networkId);
  if (!rete) return null;
  const network_credentials = getNetworkCredentials(networkId);
  return {
    ...rete,
    router_id: getNetworkRouterId(networkId),
    credential_ids: network_credentials.map((c) => c.credential_id),
    network_credentials,
  };
}

/** Crea la rete con router e lista, tutto o niente; i campi vecchi si accodano dopo `credential_ids`. */
export function creaRete(dati: DatiCreazione): ReteCreata {
  const { router_id, windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids, credential_ids, ...datiRete } = dati;
  const vecchi = vociDaCampiVecchi({ windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids });
  const rete = getDb().transaction(() => {
    const rete = createNetwork(datiRete);
    if (router_id) setNetworkRouter(rete.id, router_id);
    const tutte = [...(credential_ids ?? [])];
    for (const id of vecchi.ids) if (!tutte.includes(id)) tutte.push(id);
    if (tutte.length > 0) lista(rete.id, tutte);
    return rete;
  })();
  return { ...rete, ...avvisi(rete.id, vecchi) };
}

/**
 * Modifica la rete con router e lista, tutto o niente. Null = rete che non
 * c'è. `credential_ids` assente lascia la lista com'è; i campi vecchi si
 * accodano a `credential_ids`, o alla lista che c'è.
 */
export function aggiornaRete(networkId: number, dati: DatiModifica): ReteSalvata | null {
  const { router_id, windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids, credential_ids, ...datiRete } = dati;
  const vecchi = vociDaCampiVecchi({ windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids });
  const salvata = getDb().transaction(() => {
    const rete = updateNetwork(networkId, datiRete);
    if (!rete) return null;
    if (router_id !== undefined) {
      if (router_id) setNetworkRouter(networkId, router_id);
      else deleteNetworkRouter(networkId);
    }
    if (credential_ids !== undefined) {
      const tutte = [...credential_ids];
      for (const id of vecchi.ids) if (!tutte.includes(id)) tutte.push(id);
      lista(networkId, tutte);
    } else {
      accoda(networkId, vecchi.ids);
    }
    return letturaRete(networkId);
  })();
  return salvata ? { ...salvata, ...avvisi(networkId, vecchi) } : null;
}
