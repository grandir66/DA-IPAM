/**
 * Salvataggio di una rete con le sue credenziali: POST /api/networks e
 * PUT /api/networks/[id] (tappa 2 credenziali, T12, 16/10).
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
 * Ora rete, router, lista e catene stanno in una transazione sola: una voce
 * rifiutata non lascia scritto niente, e la rotta lo dice con un 400.
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
  getNetworkHostCredentialIds,
  replaceNetworkHostCredentials,
  replaceNetworkCredentials,
  getNetworkCredentials,
  type NetworkCredentialRow,
} from "@/lib/db";
import { CredenzialeNonAmmessa } from "@/lib/credentials/lista-rete";

/** Una credenziale della richiesta non vale per la rete: la rotta risponde 400. */
export class CredenzialiReteNonValide extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "CredenzialiReteNonValide";
  }
}

type DatiCreazione = z.infer<typeof NetworkCreateSchema>;
type DatiModifica = z.infer<typeof NetworkUpdateSchema>;
type Catene = Pick<DatiCreazione, "windows_credential_ids" | "linux_credential_ids" | "ssh_credential_ids" | "snmp_credential_ids">;

export interface ReteSalvata extends Network {
  router_id: number | null;
  credential_ids: number[];
  network_credentials: NetworkCredentialRow[];
  windows_credential_ids: number[];
  linux_credential_ids: number[];
  ssh_credential_ids: number[];
  snmp_credential_ids: number[];
}

/** Codice di un errore di SQLite (`SQLITE_…`), o null per un errore che non viene dal DB. */
function codiceSqlite(e: unknown): string | null {
  const codice = typeof e === "object" && e !== null ? (e as { code?: unknown }).code : undefined;
  return typeof codice === "string" && codice.startsWith("SQLITE_") ? codice : null;
}

/**
 * La lista unica della rete. Un id che non c'è più nell'archivio, o una voce
 * che non vale per una rete (UniFi, Omada, AD: T13), è un rifiuto, non un 500.
 */
function lista(networkId: number, ids: number[]): void {
  try {
    replaceNetworkCredentials(networkId, ids);
  } catch (e) {
    if (e instanceof CredenzialeNonAmmessa) throw new CredenzialiReteNonValide(e.message);
    if (codiceSqlite(e) === "SQLITE_CONSTRAINT_FOREIGNKEY") {
      throw new CredenzialiReteNonValide("Una delle credenziali scelte non esiste più nell'archivio: ricarica la pagina");
    }
    throw e;
  }
}

/** Catene vecchie per ruolo: le scrivono ancora le richieste che le mandano (tolte nella 2d). */
function catene(networkId: number, d: Catene): void {
  const ruoli = [
    ["windows", d.windows_credential_ids],
    ["linux", d.linux_credential_ids],
    ["ssh", d.ssh_credential_ids],
    ["snmp", d.snmp_credential_ids],
  ] as const;
  for (const [ruolo, ids] of ruoli) {
    if (ids === undefined) continue;
    try {
      replaceNetworkHostCredentials(networkId, ruolo, ids);
    } catch (e) {
      // Fuori dal DB, replaceNetworkHostCredentials lancia solo il rifiuto di
      // una voce (assente o di tipo sbagliato per il ruolo): quello è un 400,
      // un errore di SQLite resta un errore.
      if (codiceSqlite(e) !== null || !(e instanceof Error)) throw e;
      throw new CredenzialiReteNonValide(e.message);
    }
  }
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
    windows_credential_ids: getNetworkHostCredentialIds(networkId, "windows"),
    linux_credential_ids: getNetworkHostCredentialIds(networkId, "linux"),
    ssh_credential_ids: getNetworkHostCredentialIds(networkId, "ssh"),
    snmp_credential_ids: getNetworkHostCredentialIds(networkId, "snmp"),
  };
}

/** Crea la rete con router, lista e catene, tutto o niente. */
export function creaRete(dati: DatiCreazione): Network {
  const { router_id, windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids, credential_ids, ...datiRete } = dati;
  return getDb().transaction(() => {
    const rete = createNetwork(datiRete);
    if (router_id) setNetworkRouter(rete.id, router_id);
    if (credential_ids !== undefined && credential_ids.length > 0) lista(rete.id, credential_ids);
    catene(rete.id, { windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids });
    return rete;
  })();
}

/**
 * Modifica la rete con router, lista e catene, tutto o niente. Null = rete
 * che non c'è. `credential_ids` assente lascia la lista com'è.
 */
export function aggiornaRete(networkId: number, dati: DatiModifica): ReteSalvata | null {
  const { router_id, windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids, credential_ids, ...datiRete } = dati;
  return getDb().transaction(() => {
    const rete = updateNetwork(networkId, datiRete);
    if (!rete) return null;
    if (router_id !== undefined) {
      if (router_id) setNetworkRouter(networkId, router_id);
      else deleteNetworkRouter(networkId);
    }
    if (credential_ids !== undefined) lista(networkId, credential_ids);
    catene(networkId, { windows_credential_ids, linux_credential_ids, ssh_credential_ids, snmp_credential_ids });
    return letturaRete(networkId);
  })();
}
