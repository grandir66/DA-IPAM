/**
 * Involucri GSS/SPNEGO e CredSSP intorno a un messaggio NTLM.
 * Servono quando il server offre solo Negotiate (HTTP) o parla CredSSP (RDP):
 * il contenuto resta Type 1 / Type 2, senza Type 3 e senza password.
 */
function derLen(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
}

function der(tag: number, contenuto: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(contenuto.length), contenuto]);
}

/** OID 1.3.6.1.5.5.2 (SPNEGO). */
const OID_SPNEGO = Buffer.from([0x06, 0x06, 0x2b, 0x06, 0x01, 0x05, 0x05, 0x02]);
/** OID 1.3.6.1.4.1.311.2.2.10 (NTLMSSP). */
const OID_NTLM = Buffer.from([0x06, 0x0a, 0x2b, 0x06, 0x01, 0x04, 0x01, 0x82, 0x37, 0x02, 0x02, 0x0a]);

/** NegTokenInit GSS-API: SPNEGO che offre NTLM e porta il Type 1 (o il Type 2 in risposta). */
export function wrapNtlmInSpnego(ntlm: Buffer): Buffer {
  const mechTypes = der(0xa0, der(0x30, OID_NTLM));
  const mechToken = der(0xa2, der(0x04, ntlm));
  const negInit = der(0x30, Buffer.concat([mechTypes, mechToken]));
  return der(0x60, Buffer.concat([OID_SPNEGO, der(0xa0, negInit)]));
}

/** TSRequest CredSSP (MS-CSSP): version 2, un negoToken. Accettato da Windows 2008+. */
export function credsspTsRequest(negoToken: Buffer, versione = 2): Buffer {
  const ver = der(0x02, Buffer.from([versione]));
  const item = der(0x30, der(0xa0, der(0x04, negoToken)));
  const nego = der(0xa0, der(0x30, item));
  return der(0x30, Buffer.concat([ver, nego]));
}

/** Trova il blob NTLMSSP in un GSS/SPNEGO, CredSSP o raw. */
export function ntlmDaGssORaw(buf: Buffer): Buffer | null {
  const i = buf.indexOf("NTLMSSP\0", 0, "latin1");
  if (i < 0) return null;
  return buf.subarray(i);
}
