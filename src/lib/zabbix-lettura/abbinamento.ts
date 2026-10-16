/**
 * Abbinamento host del centro ↔ host di DA-IPAM (§5 del design dell'API, passo 7.4).
 *
 * In ordine, senza indovinare:
 * 1. **hostid verificato** salvato in DA-IPAM e l'host ha ancora quell'IP → `verificato`;
 *    se ha cambiato IP → `perso` (non si riabbina da solo, nemmeno a un altro host);
 * 2. **IP** non condiviso fra gli host del cliente (`ip_condiviso: false`) e di un solo
 *    host in DA-IPAM → `proposto`; diventa `verificato` solo con la conferma di una persona;
 * 3. il **nome** è un indizio accanto all'IP (`nomeCoincide`), mai un abbinamento da solo.
 *
 * L'ambiguità si dichiara: IP condiviso sul centro, o lo stesso IP su più host di
 * DA-IPAM → `ambiguo` coi candidati, e nessuno si sceglie né si salva.
 * Un hostid verificato che non torna più nell'elenco → fra i `persi`.
 *
 * Va chiamato solo con l'elenco COMPLETO degli host del cliente: su un elenco a metà
 * un host che c'è sembrerebbe perso (il client rifiuta le letture incomplete).
 *
 * Pura: nessun DB, nessuna rete.
 */
import type { HostDelCentro } from "./api";

export interface HostIpam {
  id: number;
  ip: string;
  /** Nome mostrato in DA-IPAM (`custom_name`, poi `hostname`), se c'è. */
  nome: string | null;
}

export interface AbbinamentoSalvato {
  hostid: string;
  hostId: number;
  ip: string;
  /** Nome dell'host di DA-IPAM, se la riga esiste ancora. */
  nome: string | null;
}

export interface CandidatoCentro {
  hostid: string;
  nome: string;
  proxy: string | null;
}

export type EsitoAbbinamento =
  | { stato: "verificato"; hostId: number; ip: string; nomeIpam: string | null }
  | { stato: "proposto"; hostId: number; ip: string; nomeIpam: string | null; nomeCoincide: boolean }
  | {
      stato: "ambiguo";
      motivo: "ip_condiviso" | "ip_doppio_in_ipam";
      candidatiCentro: CandidatoCentro[];
      candidatiIpam: Array<{ id: number; nome: string | null; ip: string }>;
    }
  | { stato: "perso"; hostId: number; ip: string; nomeIpam: string | null; motivo: "ip_cambiato" }
  | { stato: "nessuno" };

export type StatoAbbinamento = EsitoAbbinamento["stato"];

export interface RisultatoAbbinamento {
  /** Esito per ogni hostid del centro. */
  perHost: Map<string, EsitoAbbinamento>;
  /** Verificati il cui hostid non torna più dal centro. */
  persi: AbbinamentoSalvato[];
}

/** Forma corta di un nome: minuscolo, senza dominio. */
export function nomeCorto(n: string | null | undefined): string {
  return (n ?? "").trim().toLowerCase().split(".")[0] ?? "";
}

function nomiCoincidono(h: HostDelCentro, nomeIpam: string | null): boolean {
  const ipam = nomeCorto(nomeIpam);
  if (!ipam) return false;
  return nomeCorto(h.host) === ipam || nomeCorto(h.nome) === ipam;
}

/**
 * Calcola gli esiti. `ipamPerIp`: gli host di DA-IPAM per IP (tutti, anche più d'uno
 * per IP); `salvati`: gli abbinamenti verificati.
 */
export function abbina(
  host: readonly HostDelCentro[],
  ipamPerIp: ReadonlyMap<string, readonly HostIpam[]>,
  salvati: readonly AbbinamentoSalvato[],
): RisultatoAbbinamento {
  const salvatoPerHostid = new Map(salvati.map((s) => [s.hostid, s]));
  // Host del centro per IP: i candidati di un IP condiviso.
  const centroPerIp = new Map<string, CandidatoCentro[]>();
  for (const h of host) {
    for (const ip of h.ip) {
      const c = centroPerIp.get(ip) ?? [];
      c.push({ hostid: h.hostid, nome: h.nome || h.host, proxy: h.proxy ?? null });
      centroPerIp.set(ip, c);
    }
  }

  const perHost = new Map<string, EsitoAbbinamento>();
  const visti = new Set<string>();
  for (const h of host) {
    visti.add(h.hostid);
    const salvato = salvatoPerHostid.get(h.hostid);
    if (salvato) {
      perHost.set(
        h.hostid,
        h.ip.includes(salvato.ip)
          ? { stato: "verificato", hostId: salvato.hostId, ip: salvato.ip, nomeIpam: salvato.nome }
          : { stato: "perso", hostId: salvato.hostId, ip: salvato.ip, nomeIpam: salvato.nome, motivo: "ip_cambiato" },
      );
      continue;
    }
    if (h.ip.length === 0) {
      perHost.set(h.hostid, { stato: "nessuno" });
      continue;
    }
    // Il centro dice che l'IP è su più host del cliente (o lo vediamo noi: due host
    // nell'elenco con lo stesso IP): ambiguo, coi candidati del centro.
    const condivisoQui = h.ip.some((ip) => (centroPerIp.get(ip)?.length ?? 0) > 1);
    if (h.ip_condiviso || condivisoQui) {
      const cand = new Map<string, CandidatoCentro>();
      for (const ip of h.ip) for (const c of centroPerIp.get(ip) ?? []) cand.set(c.hostid, c);
      perHost.set(h.hostid, {
        stato: "ambiguo",
        motivo: "ip_condiviso",
        candidatiCentro: [...cand.values()],
        candidatiIpam: h.ip.flatMap((ip) => (ipamPerIp.get(ip) ?? []).map((x) => ({ id: x.id, nome: x.nome, ip }))),
      });
      continue;
    }
    const inIpam = new Map<number, { h: HostIpam; ip: string }>();
    for (const ip of h.ip) for (const x of ipamPerIp.get(ip) ?? []) inIpam.set(x.id, { h: x, ip });
    if (inIpam.size === 0) {
      perHost.set(h.hostid, { stato: "nessuno" });
    } else if (inIpam.size === 1) {
      const [{ h: x, ip }] = [...inIpam.values()];
      perHost.set(h.hostid, {
        stato: "proposto",
        hostId: x.id,
        ip,
        nomeIpam: x.nome,
        nomeCoincide: nomiCoincidono(h, x.nome),
      });
    } else {
      perHost.set(h.hostid, {
        stato: "ambiguo",
        motivo: "ip_doppio_in_ipam",
        candidatiCentro: [{ hostid: h.hostid, nome: h.nome || h.host, proxy: h.proxy ?? null }],
        candidatiIpam: [...inIpam.values()].map(({ h: x, ip }) => ({ id: x.id, nome: x.nome, ip })),
      });
    }
  }
  const persi = salvati.filter((s) => !visti.has(s.hostid));
  return { perHost, persi };
}
