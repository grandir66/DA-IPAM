/**
 * Tipi e regole di lettura condivisi dai pezzi della finestra «Rendi apparato» (tappa 3, 21/10).
 * Lo stato vive nella finestra; la sezione credenziale (un host) e la tabella (più host) leggono
 * le righe da qui e chiamano le azioni.
 */
import type { CredenzialeArchivio, ProtocolloApparato } from "@/lib/devices/proposta-apparato";
import type { HostPerRendiApparato } from "@/lib/devices/rendi-apparato";
import type { EsitoCredenziale } from "./rendi-apparato-esito";

/** Tentativo come lo restituisce `POST /api/hosts/trova-credenziale`. */
export interface TentativoVista {
  credentialId: number;
  nome: string;
  esito: "riuscita" | "rifiutata" | "esclusa" | "fermata";
  motivo: string | null;
  quando: string;
}

export interface Esclusa {
  dal: string;
  errore: string;
}

/** Credenziali escluse per host: `hostId → credentialId → motivo e data`. */
export type EscluseHost = Record<number, Record<number, Esclusa>>;

export interface RigaApparato {
  host: HostPerRendiApparato;
  nome: string;
  credentialId: string | null;
  snmpCredentialId: string | null;
  /** Esito di una prova o ricerca fatta qui, riferito alla credenziale `credentialId` di quel momento. */
  esito: (EsitoCredenziale & { credentialId: string | null }) | null;
  /** Tentativi dell'ultima ricerca automatica su questo host. */
  tentativi: TentativoVista[];
  creazione: { stato: "creato" | "errore"; messaggio?: string } | null;
  /** L'IP è già di un apparato (lo stesso host o un altro IP del suo device fisico): niente creazione, solo il rimando. */
  bloccata: ApparatoBloccante | null;
}

/** L'apparato che possiede già l'IP; `host_id` è la scheda a cui rimandare (`/objects/<host_id>`). */
export interface ApparatoBloccante {
  nome: string;
  host_id: number;
}

/** Il blocco letto dalla scheda dell'host: apparato proprio oppure unico apparato del cluster fisico. */
export function bloccoDaHost(h: HostPerRendiApparato): ApparatoBloccante | null {
  if (h.network_device) return { nome: h.network_device.name, host_id: h.id };
  if (h.apparato_cluster) return { nome: h.apparato_cluster.nome, host_id: h.apparato_cluster.host_id };
  return null;
}

/** Il blocco letto dal 409 del server (`{ codice: "IP_DI_APPARATO", apparato }`), o null per ogni altro errore. */
export function bloccoDa409(body: unknown): ApparatoBloccante | null {
  const a = body && typeof body === "object" ? (body as { codice?: unknown; apparato?: { nome?: unknown; host_id?: unknown } }) : null;
  if (a?.codice !== "IP_DI_APPARATO" || typeof a.apparato?.nome !== "string" || typeof a.apparato.host_id !== "number") return null;
  return { nome: a.apparato.nome, host_id: a.apparato.host_id };
}

export interface AzioniCredenziale {
  onScegli: (hostId: number, credentialId: string | null) => void;
  /** Credenziale SNMP in più (lettura SNMP accanto a SSH/API/WinRM): router, switch, firewall. */
  onScegliSnmp: (hostId: number, credentialId: string | null) => void;
  onProva: (hostId: number) => void;
  onNome: (hostId: number, nome: string) => void;
  onTrova: (hostIds: number[]) => void;
  onFermaRicerca: () => void;
}

/** Quante prove vere (riuscite o rifiutate) ha fatto l'ultima ricerca: le escluse e la «fermata» non sono tentativi. */
export function tentativiFatti(t: readonly TentativoVista[]): number {
  return t.filter((x) => x.esito === "riuscita" || x.esito === "rifiutata").length;
}

/**
 * Esito da mostrare per la credenziale scelta sulla riga: prima la prova fatta qui (se è per
 * questa credenziale), poi l'esclusione registrata sull'host, poi la validazione già salvata
 * sull'host, altrimenti «non provata».
 */
export function esitoVisibile(
  riga: RigaApparato,
  protocollo: ProtocolloApparato,
  escluse: EscluseHost,
  archivio: readonly CredenzialeArchivio[],
): EsitoCredenziale {
  const cid = riga.credentialId;
  if (riga.esito && riga.esito.credentialId === cid) {
    if (riga.esito.stato === "fermata") return { ...riga.esito, tentativi: tentativiFatti(riga.tentativi) };
    return riga.esito;
  }
  if (!cid) return { stato: "non_provata" };
  const esclusa = escluse[riga.host.id]?.[Number(cid)];
  if (esclusa) {
    const nome = archivio.find((c) => c.id === Number(cid))?.name ?? null;
    return { stato: "esclusa", quando: esclusa.dal, dettaglio: esclusa.errore, nome };
  }
  const proto = protocollo === "snmp_v2" || protocollo === "snmp_v3" ? "snmp" : protocollo;
  const validata = riga.host.host_credentials?.find(
    (hc) => hc.credential_id === Number(cid) && hc.protocol_type === proto && hc.validated === 1,
  );
  if (validata) return { stato: "riuscita", quando: validata.validated_at ?? null };
  return { stato: "non_provata" };
}
