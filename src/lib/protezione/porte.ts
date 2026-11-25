/**
 * Le porte che la macchina presenta: ascolto + container + cosa oggi le chiude (Protezione, tappa 1).
 * Modulo puro. I gruppi e le porte stanno qui nel codice, non in configurazione (ADR 0041).
 */
import { PRIMA_PORTA_EFFIMERA, ascoltoLocale, eIpv6, soloMacchina, suTutte, type Ascolto } from "./ascolto";
import type { Container } from "./container";

export type Gruppo = "Pagina web" | "SSH" | "Console dei moduli" | "Ricezione dati" | "Interna" | "Gestione Domarc" | "Sistema" | "Non attribuita";

/** Chi la raggiunge oggi. `non_so` quando manca la fonte per dirlo: mai «chiusa» per difetto. */
export type Raggiunge = "tutti" | "macchina" | "netbird";

export interface PortaPresentata {
  porta: number;
  proto: "tcp" | "udp";
  gruppo: Gruppo;
  /** Processo o container che la tiene. */
  tiene: string;
  inContainer: boolean;
  modulo: string;
  indirizzi: string[];
  ipv6: boolean;
  raggiunge: Raggiunge;
}

interface Nota { gruppo: Gruppo; modulo: string }
/** Porte conosciute. Una porta in ascolto che non è qui resta «Non attribuita» e si vede: è il punto. */
const NOTE: Readonly<Record<string, Nota>> = {
  "tcp/443": { gruppo: "Pagina web", modulo: "DA-IPAM" },
  "tcp/80": { gruppo: "Pagina web", modulo: "DA-IPAM (rimanda a 443)" },
  "tcp/22": { gruppo: "SSH", modulo: "Sistema" },
  "tcp/6443": { gruppo: "Console dei moduli", modulo: "Scanner-Edge" },
  "tcp/3001": { gruppo: "Interna", modulo: "DA-IPAM" },
  "tcp/8080": { gruppo: "Interna", modulo: "Scanner-Edge" },
  "tcp/8000": { gruppo: "Interna", modulo: "LibreNMS" },
  "udp/514": { gruppo: "Ricezione dati", modulo: "Syslog" },
  "tcp/514": { gruppo: "Ricezione dati", modulo: "Syslog" },
  "udp/162": { gruppo: "Ricezione dati", modulo: "Trap SNMP" },
  "udp/2055": { gruppo: "Ricezione dati", modulo: "NetFlow" },
  "udp/6343": { gruppo: "Ricezione dati", modulo: "sFlow" },
  "tcp/1514": { gruppo: "Ricezione dati", modulo: "Wazuh" },
  "tcp/1515": { gruppo: "Ricezione dati", modulo: "Wazuh" },
  "tcp/55000": { gruppo: "Ricezione dati", modulo: "Wazuh" },
  "udp/51820": { gruppo: "Gestione Domarc", modulo: "NetBird" },
  "tcp/53": { gruppo: "Sistema", modulo: "DNS locale" },
  "udp/53": { gruppo: "Sistema", modulo: "DNS locale" },
};
export const PORTE_INTERNE: readonly number[] = [3001, 8080];

export interface FattiPorte {
  ascolto: Ascolto[];
  /** `null` = Docker non letto. */
  container: Container[] | null;
  /** Indirizzi della scheda NetBird (`wt0`). */
  indirizziNetbird: string[];
  /** `DALINK_FW_PORTE_INTERNE=chiuse` con la tabella `inet dalink` caricata. */
  porteInterneChiuse: boolean;
}

export function portePresentate(f: FattiPorte): PortaPresentata[] {
  const perChiave = new Map<string, Ascolto[]>();
  for (const a of f.ascolto) {
    const k = `${a.proto}/${a.porta}`;
    // Visto sull'hub il 25/11: i client UDP dell'app (SNMP) compaiono come porte alte «in ascolto» e cambiano a ogni giro.
    if (a.proto === "udp" && a.porta >= PRIMA_PORTA_EFFIMERA && !NOTE[k]) continue;
    perChiave.set(k, [...(perChiave.get(k) ?? []), a]);
  }
  const righe: PortaPresentata[] = [];
  for (const [k, ascolti] of perChiave) {
    const { proto, porta } = ascolti[0];
    const pubblica = (f.container ?? []).find((c) => c.pubblicate.some((p) => p.suMacchina === porta && p.proto === proto));
    const indirizzi = [...new Set(ascolti.map((a) => a.indirizzo))];
    // Il nginx dell'appliance pubblica una porta per modulo: quale modulo c'è dietro non si sa da qui, e si dice.
    const nota: Nota = NOTE[k] ?? { gruppo: pubblica ? "Console dei moduli" : "Non attribuita", modulo: pubblica ? (pubblica.modulo === "DA-IPAM" ? "dietro nginx, da attribuire" : pubblica.modulo) : "—" };
    let raggiunge: Raggiunge = "tutti";
    if (ascolti.every(ascoltoLocale)) raggiunge = "macchina";
    else if (ascolti.every((a) => ascoltoLocale(a) || f.indirizziNetbird.includes(a.indirizzo))) raggiunge = "netbird";
    else if (f.porteInterneChiuse && proto === "tcp" && PORTE_INTERNE.includes(porta)) raggiunge = "macchina";
    righe.push({
      porta,
      proto,
      gruppo: nota.gruppo,
      tiene: pubblica?.nome ?? ascolti.find((a) => a.processo && a.processo !== "docker-proxy")?.processo ?? ascolti[0].processo ?? "kernel",
      inContainer: Boolean(pubblica),
      modulo: nota.modulo,
      indirizzi,
      ipv6: indirizzi.some((i) => eIpv6(i) && !soloMacchina(i)),
      raggiunge,
    });
  }
  const peso = (r: PortaPresentata): number => (r.raggiunge === "tutti" ? 0 : r.raggiunge === "netbird" ? 1 : 2);
  return righe.sort((a, b) => peso(a) - peso(b) || a.porta - b.porta || a.proto.localeCompare(b.proto));
}

/** Una porta interna che risponde a tutta la rete: l'ascolto è su tutte le schede e niente la chiude. */
export function interneEsposte(righe: PortaPresentata[]): PortaPresentata[] {
  return righe.filter((r) => r.gruppo === "Interna" && r.raggiunge === "tutti" && r.indirizzi.some(suTutte));
}
