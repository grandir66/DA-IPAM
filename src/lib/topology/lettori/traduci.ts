/**
 * Traduttori per prodotto (spec topologia §13.6.1; vincolo 4 di Riccardo: «a prescindere dal prodotto»). I nomi di porta
 * arrivano nella forma del prodotto che li ha scritti («ether3,bridge», «bridge/ether3», «SFP_ 9»); un traduttore li
 * porta in fatti neutri — il nome pulito, fisica o logica, senza fili, nel bridge, il fascio — quando si carica
 * l'ingresso del modello. È il solo posto, con i file accanto, dove stanno le forme dei nomi dei prodotti: la logica dei
 * collegamenti (links.ts in T1, cavi/ da T2) legge solo i fatti. Un prodotto sconosciuto passa dal traduttore generico.
 * Si calcola alla lettura: in T1 non serve schema. Logica pura.
 */
import { traduciGenerico } from "./generico";
import { traduciMikrotikLocale, traduciMikrotikRemoto } from "./mikrotik";
import { traduciUnifiLocale } from "./unifi";

export interface PortaLetta {
  /** Il nome pulito, com'è (o come sarebbe) nell'elenco delle porte dell'apparato. */
  nome: string;
  /** null = non noto. */
  fisica: boolean | null;
  senzaFili: boolean | null;
  nelBridge: boolean | null;
  /** Il fascio nominato insieme alla porta. */
  fascio: string | null;
}

export interface ComeLetto {
  /** network_devices.vendor dell'apparato a cui appartiene la porta (lato remoto: dell'apparato remoto, se abbinato). */
  vendor: string | null;
  /** network_devices.protocol dello stesso apparato: la via di lettura (ssh, snmp_v2, api…). */
  via: string | null;
  /** device_neighbors.source della riga; per le porte scritte dall'apparato o dal controller, «device» o «unifi». */
  fonte: string;
  /** device_neighbors.remote_platform: la piattaforma annunciata (vale per il lato remoto). */
  piattaforma: string | null;
}

const eMikrotik = (vendor: string | null): boolean => (vendor ?? "").trim().toLowerCase() === "mikrotik";
/** Le righe di un MikroTik letto via SSH: fonte `device` con vendor mikrotik e via `ssh` (da T2 anche la fonte `ssh`). */
const lettoDaMikrotik = (come: ComeLetto): boolean => eMikrotik(come.vendor) && (come.via === "ssh" || come.fonte === "ssh");

/**
 * Chi traduce. Lato locale: le righe del controller il traduttore del controller; quelle di un MikroTik letto via SSH
 * (fonte `device` con vendor mikrotik e via `ssh`; da T2 anche la fonte `ssh`) il traduttore MikroTik; le altre il
 * generico (in T1 anche le righe SNMP: il traduttore SNMP, che legge `ifType`, nasce in T2). Lato remoto: il traduttore
 * della piattaforma annunciata, o, se la riga non la dice, quello dell'apparato remoto abbinato (il controller non
 * scrive la piattaforma di un router che non gestisce).
 */
export function traduciPorta(nome: string, lato: "locale" | "remoto", come: ComeLetto): PortaLetta {
  const n = nome.trim();
  if (lato === "locale") {
    if (come.fonte === "unifi") return traduciUnifiLocale(n);
    return lettoDaMikrotik(come) ? traduciMikrotikLocale(n) : traduciGenerico(n);
  }
  return haTraduttoreRemoto(come) ? traduciMikrotikRemoto(n) : traduciGenerico(n);
}

/**
 * Il lato locale passa dal traduttore di un prodotto (il controller, un MikroTik letto via SSH), non dal generico: è la
 * stessa scelta di `traduciPorta`. Chi ha un traduttore suo conosce i nomi delle sue porte fisiche, quindi un nome che
 * non riconosce (`fisica: null`: un nome scelto dal cliente) non è una porta fisica; il generico invece non conosce i nomi
 * del prodotto.
 */
export function haTraduttore(come: ComeLetto): boolean {
  return come.fonte === "unifi" || lettoDaMikrotik(come);
}

/**
 * Il lato remoto passa dal traduttore di un prodotto, non dal generico: è la scelta di `traduciPorta` per il lato remoto (la
 * piattaforma annunciata, o l'apparato remoto abbinato letto col traduttore del suo prodotto). La usa la regola
 * «nome-scelto-non-fisico» dal lato remoto (links.ts, G2). Verifica del 15/10: prima links.ts ricopiava questa scelta con
 * un'espressione sulla marca, e le due copie potevano divergere; la scelta sta qui sola, accanto a `traduciPorta`.
 */
export function haTraduttoreRemoto(come: ComeLetto): boolean {
  return /mikrotik/i.test(come.piattaforma ?? "") || lettoDaMikrotik(come);
}

/**
 * Il MAC di una riga dei vicini è il telaio dell'apparato remoto? Sì per il controller e per SNMP (`lldpRemChassisId`).
 * No per le righe di `/ip neighbor` di un MikroTik letto via SSH: il MAC è quello dell'interfaccia che ha mandato
 * l'annuncio, e lo stesso router compare con più MAC (spec §13.6.4; sulla rete B un router con quattro). Lo usa il
 * raggruppamento per apparato delle righe (links.ts, passo 3b).
 */
export function macDelTelaio(come: ComeLetto): boolean {
  return !lettoDaMikrotik(come);
}
