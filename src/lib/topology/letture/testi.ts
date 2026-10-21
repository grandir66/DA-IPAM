/**
 * I testi di «Letture in più per la mappa» (spec topologia §13.5.6), puri: che cosa legge ogni lettura (in parole e coi
 * comandi), su quali apparati, lo stato, l'esito per apparato, il dialogo di accensione con la cadenza vera del cliente.
 * Orari in ora italiana.
 */
import { FUSO_UTENTI, parseDbDate } from "@/lib/db-date";
import type { EsitoApparato, Lettura, StatoInterruttore } from "./interruttori";

/** Ogni riga lo dice accanto a ciò che legge: nessuna lettura è accesa finché un amministratore non lo fa, cliente per cliente. */
export const NASCE_SPENTA = "Nasce spenta: si accende solo da qui, cliente per cliente.";

export const DESCRIZIONE_LETTURE: Readonly<Record<Lettura, { titolo: string; legge: string; apparati: string; comandi: string }>> = {
  mikrotik: {
    titolo: "Spanning tree, bridge e fasci dei MikroTik",
    legge: "Per ogni porta: nel bridge o instradata, ruolo e stato nello spanning tree, fascio e partner; i bridge e la radice; sui bridge in MSTP la porta radice e le VLAN di ogni istanza; tutti i MAC dell'apparato. Sugli switch MikroTik anche i vicini.",
    apparati: "router e switch MikroTik letti via SSH",
    comandi: "/interface bridge print · /interface bridge port print · /interface bridge monitor · /interface bridge port monitor · /interface bonding print e monitor · /interface bridge msti print e monitor (2 in più dove un bridge è in MSTP); sugli switch anche /interface print e /ip neighbor print (sola lettura, una connessione per apparato)",
  },
  controller: {
    titolo: "Campi del controller",
    legge: "L'indice delle porte nei vicini, la porta di uscita e da dove la ricava il controller, lo stato delle porte nello spanning tree, i fasci, tutti i MAC degli apparati.",
    apparati: "gli apparati che il controller elenca già (access point, switch, gateway)",
    comandi: "Nessuna chiamata nuova: campi della risposta che la lettura notturna degli apparati del controller riceve già.",
  },
  snmp: {
    titolo: "Spanning tree, LLDP e fasci via SNMP",
    legge: "Per gli switch che non sono del controller: tipo di ogni porta, stato e verso nello spanning tree, vicini LLDP e CDP, fasci e partner.",
    apparati: "gli switch che non sono del controller e non sono MikroTik letti via SSH",
    comandi: "16 letture in sola lettura (delle tabelle grandi solo le colonne che servono): IF-MIB, BRIDGE-MIB, RSTP-MIB, LLDP-MIB, CISCO-CDP-MIB, LAG-MIB, IEEE8021-MSTP-MIB.",
  },
  host: {
    titolo: "LLDP e bond degli hypervisor",
    legge: "I vicini che ogni scheda dell'hypervisor vede (con lldpd installato), lo stato dei membri dei bond e il loro MAC permanente.",
    apparati: "i nodi hypervisor letti dalla lettura notturna",
    comandi: "command -v lldpcli · lldpcli -f json0 show neighbors details · ip -d -j link show (sola lettura, nella lettura notturna degli hypervisor)",
  },
  mikrotik_scheda: {
    titolo: "VLAN, DNS e utenti dei MikroTik",
    legge: "Le VLAN dei bridge (tagged e untagged per porta), le interfacce VLAN col loro id e la loro interfaccia madre, la configurazione DNS, gli utenti del router (nome, gruppo, ultimo accesso; nessuna password).",
    apparati: "router MikroTik letti via SSH",
    comandi: "/interface bridge vlan print · /interface vlan print · /ip dns print · /user print (sola lettura, una connessione per apparato, al più una volta l'ora)",
  },
};

export function quandoItaliano(utc: string | null): string {
  if (!utc) return "—";
  const d = parseDbDate(utc);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("it-IT", { timeZone: FUSO_UTENTI, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}

export function testoStato(s: StatoInterruttore): string {
  return s.acceso ? `accesa da ${s.da ?? "utente non noto"} il ${quandoItaliano(s.il)}` : "spenta";
}

export function testoEsito(e: EsitoApparato): string {
  if (e.riusciti === 0 && e.comandi === 0) return `non letta (${e.codice ?? "errore"})`;
  if (e.riusciti >= e.comandi && e.codice === null) return e.comandi === 1 ? "letta" : `tutti i ${e.comandi} comandi`;
  return `letta in parte: ${e.riusciti} comandi su ${e.comandi}${e.codice ? ` (${e.codice})` : ""}`;
}

export function righeEsito(esiti: Readonly<Record<string, EsitoApparato>>, nomeDi: (id: number) => string, max = 10): { righe: string[]; altri: number } {
  const tutte = Object.entries(esiti).sort(([, a], [, b]) => (a.il < b.il ? 1 : a.il > b.il ? -1 : 0))
    .map(([id, e]) => `${nomeDi(Number(id))}: letta il ${quandoItaliano(e.il)} · ${testoEsito(e)}`);
  return { righe: tutte.slice(0, max), altri: Math.max(0, tutte.length - max) };
}

export function frequenza(minuti: number | null, daScansioni: boolean): string {
  if (minuti === null) return "solo quando lo chiede qualcuno (nessun giro programmato)";
  if (minuti < 60) return `ogni ${minuti} minuti${daScansioni ? " dalle scansioni veloci" : ""}`;
  if (minuti === 60) return "ogni ora";
  return minuti % 60 === 0 ? `ogni ${minuti / 60} ore` : `ogni ${minuti} minuti`;
}

const CHIUSA = "La mappa non cambia finché non si accende la mappa nuova. Si spegne da qui.";

/** Con la lettura dei MikroTik accesa, la scheda «Neighbors» di uno switch MikroTik mostra anche le righe lette via SSH (fonte `ssh`). */
const NEIGHBORS_MIKROTIK = "Sugli switch MikroTik la scheda «Neighbors» dell'apparato mostra anche le righe lette via SSH.";

export function testoDialogo(l: Lettura, accendi: boolean, c: { router: { minuti: number | null; daScansioni: boolean }; switch: number | null }): string {
  if (!accendi) return `Spegnere la lettura «${DESCRIZIONE_LETTURE[l].titolo}»? I dati già letti restano e invecchiano; la mappa non cambia.`;
  switch (l) {
    case "mikrotik":
      return `Accendere la lettura dello spanning tree sui MikroTik di questo cliente? Il router si legge ${frequenza(c.router.minuti, c.router.daScansioni)}: le letture in più partono al più una volta l'ora, 6 comandi in sola lettura sul router e 8 sugli switch MikroTik (2 in più dove un bridge è in MSTP), su una connessione sola per apparato. ${NEIGHBORS_MIKROTIK} ${CHIUSA}`;
    case "controller":
      return `Accendere la lettura dei campi del controller? Nessuna chiamata nuova agli apparati: si salvano campi che la lettura notturna riceve già. ${CHIUSA}`;
    case "snmp":
      return `Accendere le letture SNMP per la mappa sugli switch che non sono del controller? Il giro degli switch parte ${frequenza(c.switch, false)}: le letture in più partono al più una volta l'ora per switch, 16 letture in sola lettura. ${CHIUSA}`;
    case "host":
      return `Accendere la lettura LLDP degli hypervisor? Si legge con la lettura notturna degli hypervisor, tre comandi in sola lettura per nodo. ${CHIUSA}`;
    case "mikrotik_scheda":
      // Non serve alla mappa (riempie la scheda del router): niente frase sulla mappa nuova.
      return `Accendere la lettura di VLAN, DNS e utenti sui MikroTik di questo cliente? Il router si legge ${frequenza(c.router.minuti, c.router.daScansioni)}: questa lettura parte al più una volta l'ora, 4 comandi in sola lettura sul router, su una connessione sua. Riempie la matrice VLAN e il DNS della scheda del router; gli utenti del router (nessuna password) li vede solo un amministratore. Si spegne da qui.`;
  }
}
