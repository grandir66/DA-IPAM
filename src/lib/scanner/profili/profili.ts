/**
 * I due profili di scansione (04/11/2026).
 *
 * Dati puri: nessuna rete, nessun database. Il motore (`motore.ts`) li esegue,
 * `comando.ts` li traduce in argomenti nmap.
 *
 * **Approfondito**: nessun rischio, pensato per girare su qualunque cliente.
 * Alza `--version-intensity` e accende `-O`, cose che il default globale non fa
 * (e non deve fare: la', a 0, costa su ogni host di ogni rete). Qui si puo'
 * perche' il profilo parte solo sugli host selezionati a mano nella lista.
 *
 * **IoT/OT**: le porte di campo date da Riccardo il 04/11 piu' gli script di
 * sola lettura. `--version-intensity` resta a 0 di proposito: su un PLC vecchio
 * le probe di versione sono la parte che puo' fare danno, e l'identificazione la
 * da' lo script, non la probe. `modbus-discover` e `iec-identify` sono fuori:
 * categoria `intrusive`.
 */
import type { ProfiloScansione } from "./tipi";

/**
 * Script vietati: categoria `intrusive` o `exploit` sulla macchina di collaudo
 * (nmap 7.94SVN). Non si aggirano con un interruttore. `iec-identify` e'
 * `discovery,intrusive`: niente IEC 60870-5-104, si vede solo la porta 2404.
 */
export const SCRIPT_VIETATI: readonly string[] = [
  "modbus-discover",
  "iec-identify",
  "ftp-anon",
  "ftp-brute",
  "http-brute",
  "snmp-brute",
  "ssh-brute",
  "smb-brute",
  "realvnc-auth-bypass",
  "rdp-vuln-ms12-020",
] as const;

/** Porte web su cui vale la pena chiedere titolo, intestazioni, favicon e generator. */
const PORTE_WEB = [80, 81, 280, 591, 3000, 5000, 5001, 7304, 8000, 8001, 8008, 8080, 8081, 8880, 8888, 9000, 10000];
/** Porte TLS su cui `ssl-cert` dice CN, organizzazione e seriale del certificato. */
const PORTE_TLS = [443, 465, 636, 993, 995, 1300, 3389, 5986, 5989, 8006, 8007, 8443, 8883, 9443, 10443];

export const PROFILO_APPROFONDITO: ProfiloScansione = {
  id: "approfondito",
  nome: "Approfondito",
  descrizione:
    "Riconoscimento del sistema operativo, probe di versione piene e 30 script NSE di sola lettura: nome DNS e build di Windows dalla 3389, certificato dalla 443, nome NetBIOS dalla UDP 137, impronta della chiave SSH, titolo e favicon delle pagine web, sysDescr SNMP, BMC dalla UDP 623. Niente credenziali, niente script intrusivi.",
  tcp: [
    21, 22, 23, 25, 53, 80, 81, 88, 110, 111, 135, 139, 143, 161, 179, 199, 280, 389, 443, 445, 465, 541, 542, 548,
    554, 587, 591, 623, 631, 636, 873, 902, 990, 993, 995, 1300, 1433, 1514, 1515, 1720, 1723, 2049, 2121, 3000,
    3128, 3306, 3389, 4786, 4899, 5000, 5001, 5060, 5061, 5100, 5432, 5631, 5666, 5800, 5900, 5985, 5986, 5988,
    5989, 6000, 6690, 6789, 7304, 8000, 8001, 8006, 8007, 8009, 8080, 8081, 8200, 8291, 8443, 8554, 8728, 8729,
    8880, 8888, 9000, 9100, 9443, 9999, 10000, 10050, 10051, 10443, 17988, 17990, 34567, 37777, 49152, 49153,
    49154, 49155, 49156, 49157, 55000,
  ],
  udp: [53, 67, 68, 69, 123, 137, 161, 162, 500, 514, 520, 521, 623, 1194, 1900, 4500, 4789, 5060, 5353, 10161],
  regole: [
    // Windows: nome DNS, nome NetBIOS, dominio e build. Senza credenziali.
    { porte: [3389], protocollo: "tcp", script: ["rdp-ntlm-info"] },
    { porte: [445, 139], protocollo: "tcp", script: ["smb-os-discovery", "smb2-security-mode", "smb2-time"] },
    { porte: [137], protocollo: "udp", script: ["nbstat"] },
    { porte: [23], protocollo: "tcp", script: ["telnet-ntlm-info", "banner"] },
    // Identita' dell'apparato
    { porte: PORTE_TLS, protocollo: "tcp", script: ["ssl-cert"] },
    { porte: [22], protocollo: "tcp", script: ["ssh-hostkey"] },
    { porte: [21], protocollo: "tcp", script: ["banner"] },
    { porte: PORTE_WEB, protocollo: "tcp", script: ["http-title", "http-headers", "http-favicon", "http-generator"] },
    { porte: [8009], protocollo: "tcp", script: ["ajp-headers"] },
    { porte: [554, 8554], protocollo: "tcp", script: ["rtsp-methods"] },
    { porte: [5900], protocollo: "tcp", script: ["vnc-info"] },
    // Servizi che si dichiarano
    { porte: [161], protocollo: "udp", script: ["snmp-info", "snmp-sysdescr"] },
    { porte: [623], protocollo: "udp", script: ["ipmi-version"] },
    { porte: [1900], protocollo: "udp", script: ["upnp-info"] },
    { porte: [53], protocollo: "udp", script: ["dns-nsid"] },
    { porte: [123], protocollo: "udp", script: ["ntp-info"] },
    { porte: [111], protocollo: "tcp", script: ["rpcinfo"] },
    { porte: [2049], protocollo: "tcp", script: ["nfs-showmount"] },
    { porte: [389, 636], protocollo: "tcp", script: ["ldap-rootdse"] },
    { porte: [548], protocollo: "tcp", script: ["afp-serverinfo"] },
    { porte: [1433], protocollo: "tcp", script: ["ms-sql-info"] },
    { porte: [3306], protocollo: "tcp", script: ["mysql-info"] },
  ],
  osDetection: true,
  // 7 e non 9: oltre il 7 nmap aggiunge probe rare che allungano molto per poco.
  versionIntensity: 7,
  tettoByteOutput: 4096,
  hostTimeoutS: 180,
};

export const PROFILO_IOT_OT: ProfiloScansione = {
  id: "iot_ot",
  nome: "IoT / OT",
  descrizione:
    "Porte di campo industriali e IoT (Modbus, S7, EtherNet/IP, BACnet, OPC UA, DNP3, FINS, GE SRTP, MQTT, CoAP) con gli script di sola lettura che danno modello, firmware e numero di serie. Le probe di versione restano al minimo: su un PLC vecchio sono la parte che puo' fare danno. Niente modbus-discover ne' iec-identify (intrusivi).",
  tcp: [
    // OT / automazione
    102, // Siemens S7comm
    502, // Modbus TCP
    2404, // IEC 60870-5-104 (solo porta: iec-identify e' intrusive)
    4840, // OPC UA
    9600, // Omron FINS
    18245, 18246, // GE SRTP
    19999, 20000, // DNP3
    44818, // EtherNet/IP (CIP)
    // IoT
    1883, 8883, // MQTT, MQTT su TLS
    8008, 8009, // Google Cast e simili
    // utili per capire chi e': quasi ogni apparato di campo ha una pagina web
    80, 443, 8080, 8443, 161,
  ],
  udp: [
    47808, // BACnet/IP
    2222, // EtherNet/IP implicit messaging
    5683, 5684, // CoAP, CoAP su DTLS
    9600, // Omron FINS su UDP
    20000, // DNP3 su UDP
    44818, // EtherNet/IP su UDP
    161, 1900, 5353, // SNMP, UPnP, mDNS: scoperta IoT consumer
  ],
  regole: [
    { porte: [102], protocollo: "tcp", script: ["s7-info"] },
    { porte: [44818], protocollo: "tcp", script: ["enip-info"] },
    { porte: [9600], protocollo: "tcp", script: ["omron-info"] },
    { porte: [47808], protocollo: "udp", script: ["bacnet-info"] },
    // Scelta di Riccardo (04/11): incluso com'e'. Legge i messaggi del broker,
    // quindi dati di processo del cliente: `tettoByteOutput` e' il freno.
    { porte: [1883, 8883], protocollo: "tcp", script: ["mqtt-subscribe"] },
    { porte: [8883, 443, 8443], protocollo: "tcp", script: ["ssl-cert"] },
    { porte: [80, 8080], protocollo: "tcp", script: ["http-title", "http-headers", "http-favicon"] },
    { porte: [161], protocollo: "udp", script: ["snmp-info", "snmp-sysdescr"] },
    { porte: [1900], protocollo: "udp", script: ["upnp-info"] },
  ],
  // Un PLC non risponde al fingerprint OS e `-O` aggiunge pacchetti strani: non serve.
  osDetection: false,
  versionIntensity: 0,
  tettoByteOutput: 2048,
  hostTimeoutS: 120,
};

export const PROFILI: readonly ProfiloScansione[] = [PROFILO_APPROFONDITO, PROFILO_IOT_OT] as const;

export function profiloPerId(id: string): ProfiloScansione | null {
  return PROFILI.find((p) => p.id === id) ?? null;
}

/** Tutti gli script citati da un profilo, senza duplicati. */
export function scriptDelProfilo(profilo: ProfiloScansione): string[] {
  const set = new Set<string>();
  for (const r of profilo.regole) for (const s of r.script) set.add(s);
  return [...set].sort();
}
