/**
 * Profili di scansione: tipi condivisi.
 *
 * Perche' esistono (04/11/2026, richiesta di Riccardo): di nmap usavamo una
 * fetta minima — `-O` non era mai passato, `--version-intensity` stava a 0 e in
 * tutto il codice girava **un** paio di script NSE (`smb-os-discovery`,
 * `snmp-info`), con l'output di tutti gli altri buttato dal parser. Un profilo
 * e' un elenco di porte piu' una mappa porta -> script: il motore manda uno
 * script **solo** sulla porta che lo riguarda, e solo sugli host scelti a mano
 * nella lista.
 *
 * Niente script di categoria `intrusive` o `exploit`, in nessun profilo: la
 * lista bianca sta in `profili.ts` e una prova la fissa.
 */

/** Uno o piu' script NSE da mandare su un gruppo di porte. */
export interface RegolaScript {
  /** Porte a cui si applica. Lo script parte solo se la porta risulta aperta. */
  porte: number[];
  protocollo: "tcp" | "udp";
  /** Nomi degli script NSE, senza `.nse`. Solo categorie safe/discovery/version. */
  script: string[];
}

export interface ProfiloScansione {
  /** Chiave stabile: finisce nel database e nelle rotte. */
  id: "approfondito" | "iot_ot";
  nome: string;
  descrizione: string;
  /** Porte TCP del profilo. */
  tcp: number[];
  /** Porte UDP del profilo (servono privilegi: senza, la fase UDP si salta e lo dice). */
  udp: number[];
  regole: RegolaScript[];
  /** `-O`: riconoscimento del sistema operativo. Vuole raw socket, quindi root. */
  osDetection: boolean;
  /**
   * `--version-intensity` per questo profilo. Il default globale resta 0 di
   * proposito (costa su ogni host di ogni cliente); qui si puo' alzare perche'
   * il profilo gira solo sugli host selezionati a mano.
   */
  versionIntensity: number;
  /** Tetto in byte all'output di ogni script salvato: un broker MQTT chiacchierone riempirebbe la riga. */
  tettoByteOutput: number;
  /** Tetto in secondi per host, per fase. */
  hostTimeoutS: number;
}

/** Un rilievo letto da uno script, pronto da salvare. */
export interface RilievoProfilo {
  ip: string;
  profilo: ProfiloScansione["id"];
  porta: number | null;
  protocollo: "tcp" | "udp" | null;
  script: string;
  elems: Record<string, string>;
  output: string | null;
}

/** Cio' che il profilo ha capito dell'host, al netto degli script. */
export interface FattiProfilo {
  hostname?: string;
  dominio?: string;
  netbios?: string;
  osInfo?: string;
  modello?: string;
  seriale?: string;
  firmware?: string;
  produttore?: string;
  /** Protocollo OT riconosciuto ("s7", "enip", "bacnet", "fins", "modbus", "mqtt", "opcua"). */
  protocolloOt?: string;
  /** Impronte delle chiavi SSH: identita' stabile dell'apparato. */
  chiaviSsh?: string[];
  /** Titolo della pagina web, dove c'e'. */
  titoloWeb?: string;
}
