/**
 * Sonde UDP di protocollo: DNS 53, NTP 123, NetBIOS-NS 137, SQL Browser 1434.
 *
 * Confronto con Nety sugli stessi host (192.168.4.1 e 192.168.4.4, 10/11/2026): loro sull'UDP
 * leggono il contenuto (nome NetBIOS, dominio, controller di dominio, MAC, istanza SQL), noi
 * avevamo solo «aperta» da nmap. Una domanda per protocollo, quella che farebbe un client
 * normale; nessuna risposta = nessuna riga. Niente codice di Nety (GPL): solo i protocolli.
 */
import dgram from "node:dgram";

export interface EsitoUdp {
  porta: number;
  nome: string;
  prodotto: string | null;
  versione: string | null;
  /** Una riga leggibile con ciò che il servizio ha detto. */
  banner: string;
  /** Solo NetBIOS: il MAC dichiarato dall'host. */
  mac?: string;
}

export function domandaUdp(ip: string, porta: number, dati: Buffer, ms: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    let chiuso = false;
    const fine = (r: Buffer | null) => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      try {
        sock.close();
      } catch {
        // già chiuso
      }
      resolve(r);
    };
    const timer = setTimeout(() => fine(null), ms);
    sock.once("error", () => fine(null));
    sock.once("message", (m) => fine(m));
    sock.send(dati, porta, ip, (e) => {
      if (e) fine(null);
    });
  });
}

/** NBSTAT sul nome «*»: l'host elenca i propri nomi NetBIOS e il MAC. */
export function domandaNetbios(): Buffer {
  const nome = Buffer.from(" CKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\0", "latin1");
  return Buffer.concat([Buffer.from([0x4e, 0x03, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]), nome, Buffer.from([0, 0x21, 0, 1])]);
}

export function leggiNetbios(r: Buffer): EsitoUdp | null {
  // intestazione 12 + nome 34 + tipo/classe 4 + ttl 4 + lunghezza 2, poi il numero di nomi
  const inizio = 12 + 34 + 4 + 4 + 2;
  if (r.length < inizio + 1) return null;
  const n = r[inizio]!;
  if (n === 0 || r.length < inizio + 1 + n * 18 + 6) return null;
  let computer: string | null = null;
  let dominio: string | null = null;
  let dc = false;
  for (let i = 0; i < n; i++) {
    const p = inizio + 1 + i * 18;
    const testo = r.subarray(p, p + 15).toString("latin1").trim();
    const suffisso = r[p + 15]!;
    const gruppo = (r.readUInt16BE(p + 16) & 0x8000) !== 0;
    if (!/^[\x20-\x7e]+$/.test(testo)) continue;
    if (suffisso === 0x00 && !gruppo && !computer) computer = testo;
    if (suffisso === 0x00 && gruppo && !dominio) dominio = testo;
    if (suffisso === 0x1c && gruppo) dc = true;
  }
  if (!computer && !dominio) return null;
  const m = r.subarray(inizio + 1 + n * 18, inizio + 1 + n * 18 + 6);
  const mac = [...m].map((b) => b.toString(16).padStart(2, "0")).join(":");
  const haMac = mac !== "00:00:00:00:00:00";
  const parti = [dominio && computer ? `${dominio}\\${computer}` : (computer ?? dominio)!, ...(dc ? ["controller di dominio"] : []), ...(haMac ? [`MAC ${mac}`] : [])];
  return { porta: 137, nome: "netbios-ns", prodotto: "NetBIOS Name Service", versione: null, banner: parti.join(" · "), ...(haMac ? { mac } : {}) };
}

/** Client NTP v3: 48 byte, il primo dice versione 3 e modo client. */
export function domandaNtp(): Buffer {
  const b = Buffer.alloc(48);
  b[0] = 0x1b;
  return b;
}

export function leggiNtp(r: Buffer): EsitoUdp | null {
  if (r.length < 48) return null;
  const modo = r[0]! & 0x07;
  const versione = (r[0]! >> 3) & 0x07;
  if (modo !== 4 && modo !== 5) return null;
  const strato = r[1]!;
  return { porta: 123, nome: "ntp", prodotto: `NTPv${versione}`, versione: null, banner: `server NTP, strato ${strato}` };
}

/** Chiede i server dei nomi della radice, con ricorsione richiesta: ogni resolver la sa. */
export function domandaDns(): Buffer {
  return Buffer.from([0x4e, 0x02, 0x01, 0x00, 0, 1, 0, 0, 0, 0, 0, 0, 0x00, 0, 2, 0, 1]);
}

export function leggiDns(r: Buffer): EsitoUdp | null {
  if (r.length < 12 || r[0] !== 0x4e || r[1] !== 0x02 || (r[2]! & 0x80) === 0) return null;
  const ricorsione = (r[3]! & 0x80) !== 0;
  const rcode = r[3]! & 0x0f;
  const risposte = r.readUInt16BE(6);
  const esito = rcode === 0 ? `${risposte} risposte` : rcode === 5 ? "rifiuta la domanda" : `codice ${rcode}`;
  return { porta: 53, nome: "domain", prodotto: null, versione: null, banner: `DNS: ${esito}, ricorsione ${ricorsione ? "offerta" : "non offerta"}` };
}

/** SQL Server Browser: 0x02 chiede l'elenco delle istanze. */
export function domandaSqlBrowser(): Buffer {
  return Buffer.from([0x02]);
}

export function leggiSqlBrowser(r: Buffer): EsitoUdp | null {
  if (r.length < 4 || r[0] !== 0x05) return null;
  const campi = r.subarray(3).toString("latin1").split(";");
  const valore = (chiave: string) => {
    const i = campi.indexOf(chiave);
    const v = i >= 0 ? campi[i + 1] : undefined;
    return v && /^[\x20-\x7e]{1,64}$/.test(v) ? v : null;
  };
  const istanza = valore("InstanceName");
  const versione = valore("Version");
  if (!istanza && !versione) return null;
  const tcp = valore("tcp");
  return {
    porta: 1434,
    nome: "ms-sql-m",
    prodotto: "Microsoft SQL Server Browser",
    versione,
    banner: [`istanza ${istanza ?? "?"}`, ...(versione ? [`versione ${versione}`] : []), ...(tcp ? [`TCP ${tcp}`] : [])].join(" · "),
  };
}

const SONDE: ReadonlyArray<{ porta: number; domanda: () => Buffer; leggi: (r: Buffer) => EsitoUdp | null }> = [
  { porta: 137, domanda: domandaNetbios, leggi: leggiNetbios },
  { porta: 123, domanda: domandaNtp, leggi: leggiNtp },
  { porta: 53, domanda: domandaDns, leggi: leggiDns },
  { porta: 1434, domanda: domandaSqlBrowser, leggi: leggiSqlBrowser },
];

/** Le quattro domande a un host, in parallelo. Torna solo chi ha risposto in modo leggibile. */
export async function sondeUdpHost(ip: string, ms = 1500): Promise<EsitoUdp[]> {
  const esiti = await Promise.all(
    SONDE.map(async (s) => {
      const r = await domandaUdp(ip, s.porta, s.domanda(), ms);
      try {
        return r ? s.leggi(r) : null;
      } catch {
        return null;
      }
    }),
  );
  return esiti.filter((e): e is EsitoUdp => e !== null);
}
