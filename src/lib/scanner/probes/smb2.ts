/**
 * VINCOLO DI SICUREZZA NON NEGOZIABILE (fase 3, probe attribuzione):
 * questo probe si ferma a NEGOTIATE + SESSION_SETUP con NTLMSSP NEGOTIATE
 * **anonimo** e legge la CHALLENGE restituita dal server. NON invia MAI
 * credenziali, hash o un secondo SESSION_SETUP con NTLMSSP AUTHENTICATE:
 * non viene completata alcuna autenticazione. Un tentativo di logon fallito
 * genera allarmi MDR/XDR e rischio lockout AD sul cliente — esattamente ciò
 * che è stato vietato (vedi Global Constraints del piano fase 3 e vincolo
 * `project-credential-validate-selection-only`). Ogni anomalia nel parsing
 * produce `null`, mai un'eccezione propagata: un pacchetto malformato non è
 * un errore del probe, è semplicemente "nessuna evidenza".
 */
import net from "net";

export interface Smb2Finding {
  osVersion: string | null; // "major.minor.build" da NTLMSSP Version
  netbiosName: string | null; // AV_PAIR MsvAvNbComputerName
  dnsDomain: string | null; // AV_PAIR MsvAvDnsDomainName
  signingRequired: boolean; // SecurityMode del NEGOTIATE response
}

const DEFAULT_TIMEOUT_MS = 2000;
const SMB_PORT = 445;
const MAX_FRAME_BYTES = 128 * 1024; // difesa: mai bufferizzare oltre questo per una risposta

// 0x0311 (SMB 3.1.1) DELIBERATAMENTE ESCLUSO: MS-SMB2 §2.2.3 richiede che un
// client che lo propone allei anche un NegotiateContextList (almeno
// SMB2_PREAUTH_INTEGRITY_CAPABILITIES) subito dopo l'array Dialects. Senza
// quel contesto, Samba/Synology DSM rifiuta l'INTERA richiesta NEGOTIATE con
// STATUS_INVALID_PARAMETER (0xC000000D) — confermato byte-per-byte contro
// 192.168.40.23 (evidenza rete reale, VM 533): con 0x0311 nella lista,
// NESSUNA risposta utile arriva mai, anche per i dialetti piu' vecchi
// regolarmente proposti nello stesso messaggio. Implementare i negotiate
// context e' fuori scope per un probe passivo minimale: si rinuncia a 3.1.1,
// il probe resta comunque valido per 2.0.2/2.1/3.0/3.0.2.
const SMB2_DIALECTS = [0x0202, 0x0210, 0x0300, 0x0302] as const;

// NTLMSSP_NEGOTIATE_UNICODE | REQUEST_TARGET | NTLM | ALWAYS_SIGN | EXTENDED_SESSIONSECURITY
const NTLM_NEGOTIATE_FLAGS =
  0x00000001 | 0x00000004 | 0x00000200 | 0x00008000 | 0x00080000; // 0x00088205
const NTLMSSP_NEGOTIATE_VERSION = 0x02000000;

const NTLMSSP_SIGNATURE = Buffer.from("NTLMSSP\0", "latin1");

// ---------------------------------------------------------------------------
// Costruzione richieste (buffer statici/deterministici: nessuna dipendenza da
// stato precedente, coerente con "solo NEGOTIATE anonimo").
// ---------------------------------------------------------------------------

function nbssFrame(payload: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt8(0x00, 0); // session message
  header.writeUIntBE(payload.length, 1, 3); // lunghezza 24 bit big-endian
  return Buffer.concat([header, payload]);
}

/** Header SMB2 fisso a 64 byte (sync, nessun compounding). */
function smb2Header(command: number, messageId: number): Buffer {
  const h = Buffer.alloc(64);
  h.write("\xfeSMB", 0, "latin1"); // ProtocolId
  h.writeUInt16LE(64, 4); // StructureSize
  h.writeUInt16LE(0, 6); // CreditCharge
  h.writeUInt32LE(0, 8); // Status/ChannelSequence+Reserved (request)
  h.writeUInt16LE(command, 12); // Command
  h.writeUInt16LE(1, 14); // CreditRequest
  h.writeUInt32LE(0, 16); // Flags (client request)
  h.writeUInt32LE(0, 20); // NextCommand
  h.writeUInt32LE(messageId, 24); // MessageId (low 32 bit)
  h.writeUInt32LE(0, 28); // MessageId (high 32 bit) - valori piccoli, sempre 0
  h.writeUInt32LE(0, 32); // Reserved
  h.writeUInt32LE(0, 36); // TreeId
  h.writeUInt32LE(0, 40); // SessionId (low)
  h.writeUInt32LE(0, 44); // SessionId (high)
  // Signature (16 byte) resta a 0: nessun signing richiesto lato client
  return h;
}

function buildNegotiateRequest(): Buffer {
  const body = Buffer.alloc(36 + SMB2_DIALECTS.length * 2);
  body.writeUInt16LE(36, 0); // StructureSize (costante di spec)
  body.writeUInt16LE(SMB2_DIALECTS.length, 2); // DialectCount
  body.writeUInt16LE(0x0001, 4); // SecurityMode: signing enabled (non required)
  body.writeUInt16LE(0, 6); // Reserved
  body.writeUInt32LE(0, 8); // Capabilities
  // ClientGuid (16 byte, offset 12-27) a 0: probe anonimo, nessun bisogno di un
  // GUID reale. ClientStartTime (8 byte, offset 28-35) a 0. Il fixed body e'
  // quindi 12 + 16 + 8 = 36 byte: i Dialects iniziano a offset 36, MAI 32 (bug
  // precedente: scriveva i Dialects 4 byte troppo presto, dentro il campo
  // ClientStartTime, disallineando l'intero array agli occhi del server).
  let off = 36;
  for (const dialect of SMB2_DIALECTS) {
    body.writeUInt16LE(dialect, off);
    off += 2;
  }
  const message = Buffer.concat([smb2Header(0x0000, 0), body]);
  return nbssFrame(message);
}

/** NTLMSSP NEGOTIATE_MESSAGE anonimo: 32 byte, nessun dominio/workstation, nessuna Version. */
function buildNtlmNegotiateMessage(): Buffer {
  const msg = Buffer.alloc(32);
  NTLMSSP_SIGNATURE.copy(msg, 0);
  msg.writeUInt32LE(1, 8); // MessageType = NEGOTIATE
  msg.writeUInt32LE(NTLM_NEGOTIATE_FLAGS, 12);
  msg.writeUInt16LE(0, 16); // DomainNameLen
  msg.writeUInt16LE(0, 18); // DomainNameMaxLen
  msg.writeUInt32LE(32, 20); // DomainNameOffset
  msg.writeUInt16LE(0, 24); // WorkstationLen
  msg.writeUInt16LE(0, 26); // WorkstationMaxLen
  msg.writeUInt32LE(32, 28); // WorkstationOffset
  return msg;
}

/**
 * Avvolge la NEGOTIATE_MESSAGE NTLMSSP in un token SPNEGO (RFC 4178) minimale:
 * GSSAPI InitialContextToken → NegotiationToken [0] negTokenInit → mechTypes
 * [0] (solo l'OID NTLMSSP) + mechToken [2] (la NEGOTIATE_MESSAGE). Struttura
 * fissa e deterministica: nessun parsing, solo ASN.1 DER scritto a mano una
 * volta sola (lunghezze costanti perché la NEGOTIATE_MESSAGE è sempre 32 byte).
 */
function buildSpnegoNtlmNegotiateBlob(): Buffer {
  const ntlm = buildNtlmNegotiateMessage(); // 32 byte
  const SPNEGO_OID = Buffer.from([0x06, 0x06, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x02]);
  const NTLMSSP_OID = Buffer.from([
    0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a,
  ]);
  const mechTypesSeq = Buffer.concat([Buffer.from([0x30, NTLMSSP_OID.length]), NTLMSSP_OID]);
  const mechTypesTagged = Buffer.concat([Buffer.from([0xa0, mechTypesSeq.length]), mechTypesSeq]);
  const mechTokenOctet = Buffer.concat([Buffer.from([0x04, ntlm.length]), ntlm]);
  const mechTokenTagged = Buffer.concat([Buffer.from([0xa2, mechTokenOctet.length]), mechTokenOctet]);
  const negTokenInitContent = Buffer.concat([mechTypesTagged, mechTokenTagged]);
  const negTokenInitSeq = Buffer.concat([Buffer.from([0x30, negTokenInitContent.length]), negTokenInitContent]);
  const negotiationToken = Buffer.concat([Buffer.from([0xa0, negTokenInitSeq.length]), negTokenInitSeq]);
  const outerContent = Buffer.concat([SPNEGO_OID, negotiationToken]);
  return Buffer.concat([Buffer.from([0x60, outerContent.length]), outerContent]);
}

function buildSessionSetupRequest(): Buffer {
  const securityBuffer = buildSpnegoNtlmNegotiateBlob();
  const FIXED_BODY_LEN = 24; // StructureSize+Flags+SecurityMode+Capabilities+Channel+SecBufOff+SecBufLen+PrevSessionId
  const body = Buffer.alloc(FIXED_BODY_LEN + securityBuffer.length);
  body.writeUInt16LE(25, 0); // StructureSize (costante di spec)
  body.writeUInt8(0, 2); // Flags
  body.writeUInt8(0x01, 3); // SecurityMode: signing enabled
  body.writeUInt32LE(0, 4); // Capabilities
  body.writeUInt32LE(0, 8); // Channel
  body.writeUInt16LE(64 + FIXED_BODY_LEN, 12); // SecurityBufferOffset (relativo all'header SMB2)
  body.writeUInt16LE(securityBuffer.length, 14); // SecurityBufferLength
  body.writeUInt32LE(0, 16); // PreviousSessionId (low)
  body.writeUInt32LE(0, 20); // PreviousSessionId (high)
  securityBuffer.copy(body, FIXED_BODY_LEN);
  const message = Buffer.concat([smb2Header(0x0001, 1), body]);
  return nbssFrame(message);
}

// ---------------------------------------------------------------------------
// Parsing difensivo delle risposte: ogni lettura verifica prima i limiti del
// buffer. Qualunque anomalia → null, mai un'eccezione propagata.
// ---------------------------------------------------------------------------

function isValidSmb2Message(msg: Buffer): boolean {
  return msg.length >= 64 && msg[0] === 0xfe && msg[1] === 0x53 && msg[2] === 0x4d && msg[3] === 0x42;
}

/**
 * Status della risposta (offset 8-11 dell'header, 4 byte LE). Va SEMPRE
 * controllato prima di interpretare il body come una risposta di successo:
 * un body di errore (StructureSize=9, MS-SMB2 §2.2.2) ha un layout diverso e
 * leggerlo come se fosse il body di successo produce campi spazzatura invece
 * di `null` (bug osservato in produzione: NEGOTIATE rifiutato con
 * STATUS_INVALID_PARAMETER veniva comunque letto come se SecurityMode fosse
 * valido, e il probe proseguiva con un SESSION_SETUP su una connessione mai
 * negoziata).
 */
function readSmb2Status(msg: Buffer): number {
  return msg.readUInt32LE(8);
}

const STATUS_SUCCESS = 0x00000000;
// Atteso per un SESSION_SETUP anonimo NTLMSSP NEGOTIATE riuscito: il server
// non ha completato la sessione e restituisce la CHALLENGE nel security
// buffer. Qualunque altro status (es. STATUS_LOGON_FAILURE 0xC000006D se il
// device ha l'accesso anonimo/guest disabilitato — comune sui NAS, confermato
// su 192.168.40.23) non contiene una CHALLENGE utilizzabile: nessuna evidenza,
// mai un'autenticazione reale (vedi vincolo di sicurezza di testa file).
const STATUS_MORE_PROCESSING_REQUIRED = 0xc0000016;

/**
 * SecurityMode del body NEGOTIATE response (offset 2-3 del body, cioè 66-67
 * del messaggio). Esportata per i test: e' qui che si e' verificato in
 * produzione il bug reale contro rete 192.168.40.0/24 (Synology/QNAP) — un
 * NEGOTIATE rifiutato con STATUS_INVALID_PARAMETER veniva letto come se il
 * body fosse quello di una risposta di successo.
 */
export function parseNegotiateSigningRequired(msg: Buffer): boolean | null {
  if (!isValidSmb2Message(msg) || msg.length < 68) return null;
  if (readSmb2Status(msg) !== STATUS_SUCCESS) return null;
  const securityMode = msg.readUInt16LE(66);
  return (securityMode & 0x0002) !== 0; // NEGOTIATE_SIGNING_REQUIRED
}

/**
 * SecurityBuffer del body SESSION_SETUP response (offsets relativi all'header
 * a 64 byte). Esportata per i test per lo stesso motivo di
 * `parseNegotiateSigningRequired`: un device con accesso anonimo disabilitato
 * (comune sui NAS) risponde STATUS_LOGON_FAILURE, mai una CHALLENGE.
 */
export function extractSessionSetupSecurityBuffer(msg: Buffer): Buffer | null {
  if (!isValidSmb2Message(msg) || msg.length < 64 + 8) return null;
  if (readSmb2Status(msg) !== STATUS_MORE_PROCESSING_REQUIRED) return null;
  const bodyOffset = 64;
  const secBufOffset = msg.readUInt16LE(bodyOffset + 4);
  const secBufLength = msg.readUInt16LE(bodyOffset + 6);
  if (secBufLength === 0) return null;
  const end = secBufOffset + secBufLength;
  if (secBufOffset < 0 || end > msg.length || secBufOffset < bodyOffset) return null;
  return msg.subarray(secBufOffset, end);
}

interface NtlmChallengeInfo {
  version: string | null;
  nbComputerName: string | null;
  dnsDomainName: string | null;
}

function parseAvPairs(buf: Buffer): Map<number, string> {
  const result = new Map<number, string>();
  let offset = 0;
  const MAX_ITERATIONS = 64; // difesa da loop su buffer malformati
  for (let i = 0; i < MAX_ITERATIONS && offset + 4 <= buf.length; i++) {
    const avId = buf.readUInt16LE(offset);
    const avLen = buf.readUInt16LE(offset + 2);
    const valueStart = offset + 4;
    const valueEnd = valueStart + avLen;
    if (avId === 0x0000) break; // MsvAvEOL
    if (valueEnd > buf.length) break; // AV_PAIR troncata: fermarsi, non leggere oltre
    if (avId === 0x0001 || avId === 0x0004) {
      try {
        result.set(avId, buf.subarray(valueStart, valueEnd).toString("utf16le"));
      } catch {
        // valore illeggibile: ignora la singola coppia, non propagare
      }
    }
    offset = valueEnd;
  }
  return result;
}

/**
 * Estrae Version e AV_PAIRS (MsvAvNbComputerName, MsvAvDnsDomainName) da una
 * NTLMSSP CHALLENGE_MESSAGE. Cerca la signature "NTLMSSP\0" nel buffer invece
 * di decodificare l'ASN.1 SPNEGO che la avvolge: più robusto e difensivo di
 * un parser ASN.1 completo, e sufficiente perché ci serve solo il payload
 * NTLM, non la busta SPNEGO. Esportata per i test (helper di parsing più
 * fragile, va testata con buffer costruiti a mano).
 */
export function parseNtlmChallenge(buf: Buffer): NtlmChallengeInfo | null {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  const base = buf.indexOf(NTLMSSP_SIGNATURE);
  if (base === -1) return null;
  if (base + 12 > buf.length) return null;
  const messageType = buf.readUInt32LE(base + 8);
  if (messageType !== 2) return null; // non è una CHALLENGE_MESSAGE

  if (base + 48 > buf.length) return null;
  const negotiateFlags = buf.readUInt32LE(base + 20);
  const targetInfoLen = buf.readUInt16LE(base + 40);
  const targetInfoOffset = buf.readUInt32LE(base + 44); // relativo a `base`

  let version: string | null = null;
  if ((negotiateFlags & NTLMSSP_NEGOTIATE_VERSION) !== 0 && base + 56 <= buf.length) {
    const major = buf.readUInt8(base + 48);
    const minor = buf.readUInt8(base + 49);
    const build = buf.readUInt16LE(base + 50);
    version = `${major}.${minor}.${build}`;
  }

  let nbComputerName: string | null = null;
  let dnsDomainName: string | null = null;
  if (targetInfoLen > 0) {
    const start = base + targetInfoOffset;
    const end = start + targetInfoLen;
    if (start >= 0 && start < end && end <= buf.length) {
      const avPairs = parseAvPairs(buf.subarray(start, end));
      nbComputerName = avPairs.get(0x0001) ?? null;
      dnsDomainName = avPairs.get(0x0004) ?? null;
    }
  }

  return { version, nbComputerName, dnsDomainName };
}

// ---------------------------------------------------------------------------
// I/O socket: connessione TCP:445, un frame NBSS alla volta. Mai eccezioni
// propagate: ogni fallimento risolve a `null`.
// ---------------------------------------------------------------------------

function connect(ip: string, timeoutMs: number): Promise<net.Socket | null> {
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host: ip, port: SMB_PORT });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(null);
    }, timeoutMs);
    socket.once("connect", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });
  });
}

/** Legge un frame NBSS completo (4 byte header + payload) entro il timeout. */
function readNbssFrame(socket: net.Socket, timeoutMs: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    let settled = false;
    let buf = Buffer.alloc(0);
    const finish = (result: Buffer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("error", onError);
      socket.removeListener("close", onClose);
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    const onData = (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length < 4) return;
      const payloadLen = buf.readUIntBE(1, 3);
      if (payloadLen > MAX_FRAME_BYTES) {
        finish(null);
        return;
      }
      if (buf.length >= 4 + payloadLen) {
        finish(buf.subarray(4, 4 + payloadLen));
      }
    };
    const onError = () => finish(null);
    const onClose = () => finish(null);
    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function writeAsync(socket: net.Socket, data: Buffer): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      socket.write(data, (err) => resolve(!err));
    } catch {
      resolve(false);
    }
  });
}

/**
 * NEGOTIATE + SESSION_SETUP (NTLMSSP NEGOTIATE anonimo) su porta 445, poi
 * legge la CHALLENGE e chiude. Non invia MAI un secondo SESSION_SETUP con
 * AUTHENTICATE: nessuna password, nessun tentativo di login (vedi commento
 * di testa al file). Qualunque anomalia di rete o di parsing → null.
 */
export async function probeSmb2(ip: string, opts?: { timeoutMs?: number }): Promise<Smb2Finding | null> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let socket: net.Socket | null = null;
  try {
    socket = await connect(ip, timeoutMs);
    if (!socket) return null;

    const negOk = await writeAsync(socket, buildNegotiateRequest());
    if (!negOk) return null;
    const negotiateResp = await readNbssFrame(socket, timeoutMs);
    if (!negotiateResp) return null;
    const signingRequired = parseNegotiateSigningRequired(negotiateResp);
    if (signingRequired === null) return null;

    const setupOk = await writeAsync(socket, buildSessionSetupRequest());
    if (!setupOk) return null;
    const sessionSetupResp = await readNbssFrame(socket, timeoutMs);
    if (!sessionSetupResp) return null;

    const securityBuffer = extractSessionSetupSecurityBuffer(sessionSetupResp);
    if (!securityBuffer) return null;
    const challenge = parseNtlmChallenge(securityBuffer);
    if (!challenge) return null;

    return {
      osVersion: challenge.version,
      netbiosName: challenge.nbComputerName,
      dnsDomain: challenge.dnsDomainName,
      signingRequired,
    };
  } catch {
    return null;
  } finally {
    // Chiusura esplicita: qui il probe SI FERMA, nessun secondo giro con
    // AUTHENTICATE. Il socket non deve restare aperto in attesa di altro.
    socket?.destroy();
  }
}
