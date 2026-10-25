/**
 * Tipi e testi dei rilievi di sicurezza della rete osservata (25/10): senza dipendenze
 * dal server, così la pagina li importa senza tirarsi dietro il DB.
 */

export type CategoriaRilievo = "allarme" | "esposizione" | "novita";
export type GravitaRilievo = "alta" | "media" | "bassa";
export type TipoRilievo =
  | "dhcp_non_previsto"
  | "ip_conteso"
  | "fuori_rete"
  | "nomi_insicuri"
  | "piu_vlan"
  | "vicino_esposto"
  | "non_in_inventario"
  | "vlan_inattesa";

/** Testi fissi per tipo: etichetta breve e cosa fare. La pagina li mostra, non li ripete altrove. */
export const TIPI_RILIEVO: Record<TipoRilievo, { etichetta: string; categoria: CategoriaRilievo; cosaFare: string }> = {
  dhcp_non_previsto: {
    etichetta: "Server DHCP non previsto",
    categoria: "allarme",
    cosaFare: "Trova l'apparato dal MAC e staccalo; se è un server previsto, prendilo in carico.",
  },
  ip_conteso: {
    etichetta: "Indirizzo IP conteso",
    categoria: "allarme",
    cosaFare: "Due schede usano lo stesso IP. Se è il gateway, controlla subito chi è il secondo MAC.",
  },
  fuori_rete: {
    etichetta: "Indirizzo fuori dalla sua rete",
    categoria: "allarme",
    cosaFare: "Porta dello switch sulla VLAN sbagliata, un bridge o un apparato portato da fuori.",
  },
  nomi_insicuri: {
    etichetta: "Usa LLMNR o NetBIOS",
    categoria: "esposizione",
    cosaFare: "Spegni LLMNR e NetBIOS su TCP/IP con una GPO: sono la via per rubare password in LAN.",
  },
  piu_vlan: {
    etichetta: "Stesso apparato in più VLAN",
    categoria: "esposizione",
    cosaFare: "Normale per router e server di virtualizzazione; per un PC o una stampante va controllato.",
  },
  vicino_esposto: {
    etichetta: "Switch che si annuncia (CDP/LLDP)",
    categoria: "esposizione",
    cosaFare: "Spegni CDP/LLDP sulle porte verso gli utenti: regalano modello e IP di gestione.",
  },
  non_in_inventario: {
    etichetta: "Apparato non in inventario",
    categoria: "novita",
    cosaFare: "Riconoscilo e portalo in inventario, oppure scopri chi l'ha collegato.",
  },
  vlan_inattesa: {
    etichetta: "VLAN non censita",
    categoria: "novita",
    cosaFare: "Passa sul trunk ma non ha una rete in DA-IPAM: censiscila o chiedi chi l'ha creata.",
  },
};
