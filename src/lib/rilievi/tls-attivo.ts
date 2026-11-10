/**
 * Prova attiva del TLS: quali versioni vecchie e quali cifrari deboli il server ACCETTA.
 *
 * La sonda normale legge solo ciò che si negozia con un client moderno (TLS 1.2/1.3, AES): un
 * server che accetta anche TLS 1.0 o 3DES passava pulito. Confronto con Nety sulla rete 99
 * (10/11/2026): 14 rilievi TLS da loro, 0 da noi. OpenSSL di Node non ha più 3DES/RC4, quindi
 * il ClientHello si scrive a mano e si guarda solo la risposta: ServerHello = accettato,
 * alert o silenzio = rifiutato. Nessun handshake viene completato.
 */
import net from "node:net";

const VERSIONI: ReadonlyArray<{ codice: number; nome: string }> = [
  { codice: 0x0301, nome: "TLSv1.0" },
  { codice: 0x0302, nome: "TLSv1.1" },
];

/** Cifrari ancora comuni sui server vecchi: servono solo a farsi rispondere in TLS 1.0/1.1. */
const CIFRARI_LARGHI = [0xc014, 0xc013, 0xc00a, 0xc009, 0x0039, 0x0033, 0x0035, 0x002f, 0xc012, 0x000a];

/** RC4, 3DES, DES, NULL: offerti da soli, se il server ne sceglie uno lo accetta davvero. */
export const CIFRARI_DEBOLI: Readonly<Record<number, string>> = {
  0x000a: "DES-CBC3-SHA",
  0xc012: "ECDHE-RSA-DES-CBC3-SHA",
  0xc008: "ECDHE-ECDSA-DES-CBC3-SHA",
  0x0016: "DHE-RSA-DES-CBC3-SHA",
  0x0005: "RC4-SHA",
  0x0004: "RC4-MD5",
  0xc011: "ECDHE-RSA-RC4-SHA",
  0xc007: "ECDHE-ECDSA-RC4-SHA",
  0x0009: "DES-CBC-SHA",
  0x0002: "NULL-SHA",
  0x0001: "NULL-MD5",
};

function u16(n: number): Buffer {
  return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
}

function estensione(tipo: number, corpo: Buffer): Buffer {
  return Buffer.concat([u16(tipo), u16(corpo.length), corpo]);
}

/** ClientHello minimo: versione, cifrari, curve e firme. Niente SNI: si parla a un IP. */
export function clientHello(versione: number, cifrari: number[], casuale: Buffer): Buffer {
  const suite = Buffer.concat([...cifrari, 0x00ff].map(u16));
  const gruppi = Buffer.concat([0x0017, 0x0018, 0x0019].map(u16));
  const firme = Buffer.concat([0x0401, 0x0501, 0x0601, 0x0403, 0x0503, 0x0201, 0x0203].map(u16));
  const ext = Buffer.concat([
    estensione(0x000a, Buffer.concat([u16(gruppi.length), gruppi])),
    estensione(0x000b, Buffer.from([1, 0])),
    ...(versione >= 0x0303 ? [estensione(0x000d, Buffer.concat([u16(firme.length), firme]))] : []),
  ]);
  const corpo = Buffer.concat([
    u16(versione),
    casuale,
    Buffer.from([0]),
    u16(suite.length),
    suite,
    Buffer.from([1, 0]),
    u16(ext.length),
    ext,
  ]);
  const hs = Buffer.concat([Buffer.from([1, 0]), u16(corpo.length), corpo]);
  return Buffer.concat([Buffer.from([0x16]), u16(Math.min(versione, 0x0301)), u16(hs.length), hs]);
}

/** Dal primo record di risposta: versione e cifrario del ServerHello, o null (alert, altro, corto). */
export function leggiServerHello(dati: Buffer): { versione: number; cifrario: number } | null {
  if (dati.length < 5 + 4 + 2 + 32 + 1) return null;
  if (dati[0] !== 0x16 || dati[5] !== 0x02) return null;
  const versione = dati.readUInt16BE(9);
  const lunSessione = dati[43] ?? 0;
  const pos = 44 + lunSessione;
  if (dati.length < pos + 2) return null;
  return { versione, cifrario: dati.readUInt16BE(pos) };
}

function scambia(ip: string, porta: number, hello: Buffer, ms: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: ip, port: porta });
    let buf = Buffer.alloc(0);
    let chiuso = false;
    const fine = (esito: Buffer | null) => {
      if (chiuso) return;
      chiuso = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(esito);
    };
    const timer = setTimeout(() => fine(buf.length ? buf : null), ms);
    sock.once("connect", () => sock.write(hello));
    sock.on("data", (d: Buffer) => {
      buf = Buffer.concat([buf, d]);
      // Basta l'inizio del ServerHello: versione, random, sessione e cifrario.
      if (buf.length >= 5 && (buf[0] !== 0x16 || buf.length >= 44 + 32 + 2)) fine(buf);
    });
    sock.once("error", () => fine(buf.length ? buf : null));
    sock.once("close", () => fine(buf.length ? buf : null));
  });
}

export interface EsitoTlsAttivo {
  vecchi: string[];
  deboli: string[];
}

export async function provaTlsAttivo(ip: string, porta: number, ms: number, casuale: Buffer): Promise<EsitoTlsAttivo> {
  const vecchi: string[] = [];
  for (const v of VERSIONI) {
    const r = await scambia(ip, porta, clientHello(v.codice, CIFRARI_LARGHI, casuale), ms);
    const sh = r ? leggiServerHello(r) : null;
    if (sh && sh.versione === v.codice) vecchi.push(v.nome);
  }
  const deboli: string[] = [];
  const r = await scambia(ip, porta, clientHello(0x0303, Object.keys(CIFRARI_DEBOLI).map(Number), casuale), ms);
  const sh = r ? leggiServerHello(r) : null;
  const nome = sh ? CIFRARI_DEBOLI[sh.cifrario] : undefined;
  if (nome) deboli.push(nome);
  return { vecchi, deboli };
}
