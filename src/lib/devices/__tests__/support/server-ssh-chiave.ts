/**
 * Server SSH in memoria (ssh2 su 127.0.0.1, niente rete) per le prove della
 * chiave SSH (tappa 2 credenziali, T14, 16/10).
 *
 * Accetta le chiavi pubbliche elencate, con la firma verificata come fa un
 * sshd vero, e, se data, una password. Registra i metodi tentati, le chiavi
 * presentate e i comandi; ogni `exec` risponde con `risposta(comando)`.
 *
 * Le righe pubbliche delle chiavi PEM si calcolano con `node:crypto` (JWK),
 * non con ssh2: così la prova non usa lo stesso lettore del codice che prova.
 */
import { Server, utils, type AuthenticationType, type Connection, type ServerConfig } from "ssh2";
import type { AddressInfo } from "node:net";
import { createPrivateKey, createPublicKey, type JsonWebKey } from "node:crypto";

export interface ServerSshProva {
  porta: number;
  /** Metodi d'autenticazione tentati dai client, nell'ordine (`none` compreso). */
  metodi: string[];
  /** Chiavi pubbliche presentate, in base64 (blob SSH). */
  chiaviViste: string[];
  comandi: string[];
  connessioni: number;
  chiudi: () => Promise<void>;
}

export interface OpzioniServer {
  /** Righe pubbliche OpenSSH ammesse («ssh-ed25519 AAAA…»). */
  chiavi?: string[];
  /** Password ammessa (per qualunque utente). */
  password?: string;
  /** Metodi che il server dichiara. Default: `publickey` più `password` se c'è. */
  offerti?: AuthenticationType[];
  risposta?: (comando: string) => string;
  /** Algoritmi del server (ssh2 `algorithms`): per simulare un firmware vecchio. Default: quelli di ssh2. */
  algoritmi?: ServerConfig["algorithms"];
  /** Chiave host RSA invece di ed25519 (firmware che offrono solo `ssh-rsa`). */
  chiaveHostRsa?: boolean;
}

type OpzioniEd25519 = { passphrase: string; cipher: string; rounds: number };

/**
 * Una coppia ed25519 di ssh2 che ssh2 stesso sa rileggere. `utils.generateKeyPairSync`
 * scrive male circa una chiave su 256: quando la pubblica comincia con un byte 0 lo
 * toglie (31 byte invece di 32), e poi `parseKey` e `new Server` rifiutano la privata
 * con «Malformed OpenSSH private key». Era la prova «instabile» `ssh-chiave` in CI
 * (18/10): non il carico, la chiave. Si rigenera finché non è leggibile.
 */
export function ed25519Prova(cifra?: OpzioniEd25519): { private: string; public: string } {
  for (let i = 0; i < 64; i++) {
    const k = cifra ? utils.generateKeyPairSync("ed25519", cifra) : utils.generateKeyPairSync("ed25519");
    if (!(utils.parseKey(k.private, cifra?.passphrase) instanceof Error) && !(utils.parseKey(k.public) instanceof Error)) return k;
  }
  throw new Error("ssh2 non ha prodotto una chiave ed25519 leggibile in 64 tentativi");
}

export async function serverSshProva(o: OpzioniServer): Promise<ServerSshProva> {
  const chiaveHost = o.chiaveHostRsa ? utils.generateKeyPairSync("rsa", { bits: 2048 }) : ed25519Prova();
  const ammesse = (o.chiavi ?? []).map((riga) => {
    const k = utils.parseKey(riga);
    if (k instanceof Error) throw k;
    return k;
  });
  const offerti: AuthenticationType[] = o.offerti ?? ["publickey", ...(o.password != null ? (["password"] as const) : [])];
  const stato: ServerSshProva = { porta: 0, metodi: [], chiaviViste: [], comandi: [], connessioni: 0, chiudi: async () => {} };
  const client: Connection[] = [];

  const srv = new Server({ hostKeys: [chiaveHost.private], ...(o.algoritmi ? { algorithms: o.algoritmi } : {}) }, (c) => {
    stato.connessioni += 1;
    client.push(c);
    c.on("authentication", (ctx) => {
      stato.metodi.push(ctx.method);
      if (ctx.method === "publickey" && offerti.includes("publickey")) {
        stato.chiaviViste.push(ctx.key.data.toString("base64"));
        const k = ammesse.find((a) => a.getPublicSSH().equals(ctx.key.data));
        if (k) {
          if (!ctx.signature) return ctx.accept(); // «questa chiave va bene?»
          if (ctx.blob && k.verify(ctx.blob, ctx.signature, ctx.hashAlgo) === true) return ctx.accept();
        }
      }
      if (ctx.method === "password" && offerti.includes("password") && o.password != null && ctx.password === o.password) {
        return ctx.accept();
      }
      ctx.reject(offerti);
    });
    c.on("ready", () => {
      c.on("session", (accetta) => {
        const s = accetta();
        s.on("exec", (acc, _rif, info) => {
          stato.comandi.push(info.command);
          const canale = acc();
          canale.write(o.risposta ? o.risposta(info.command) : "ok\n");
          canale.exit(0);
          canale.end();
        });
      });
    });
    c.on("error", () => { /* il client che chiude per primo */ });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  stato.porta = (srv.address() as AddressInfo).port;
  stato.chiudi = () =>
    new Promise<void>((r) => {
      for (const c of client) {
        try { c.end(); } catch { /* già chiusa */ }
      }
      srv.close(() => r());
    });
  return stato;
}

const stringaSsh = (b: Buffer): Buffer => {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(b.length);
  return Buffer.concat([l, b]);
};
const mpint = (b: Buffer): Buffer => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  return stringaSsh(v[0] & 0x80 ? Buffer.concat([Buffer.from([0]), v]) : v);
};

/** Riga pubblica OpenSSH di una chiave privata PEM (PKCS#1, SEC1, PKCS#8, anche cifrata), calcolata con node:crypto. */
export function rigaPubblicaDaPem(pem: string, passphrase?: string): string {
  const jwk = createPublicKey(createPrivateKey({ key: pem, format: "pem", passphrase })).export({ format: "jwk" }) as JsonWebKey;
  const b = (s: string | undefined): Buffer => Buffer.from(s ?? "", "base64url");
  let tipo: string;
  let blob: Buffer;
  if (jwk.kty === "OKP" && jwk.crv === "Ed25519") {
    tipo = "ssh-ed25519";
    blob = Buffer.concat([stringaSsh(Buffer.from(tipo)), stringaSsh(b(jwk.x))]);
  } else if (jwk.kty === "RSA") {
    tipo = "ssh-rsa";
    blob = Buffer.concat([stringaSsh(Buffer.from(tipo)), mpint(b(jwk.e)), mpint(b(jwk.n))]);
  } else if (jwk.kty === "EC" && jwk.crv === "P-256") {
    tipo = "ecdsa-sha2-nistp256";
    blob = Buffer.concat([stringaSsh(Buffer.from(tipo)), stringaSsh(Buffer.from("nistp256")), stringaSsh(Buffer.concat([Buffer.from([4]), b(jwk.x), b(jwk.y)]))]);
  } else {
    throw new Error(`chiave di prova non prevista: ${jwk.kty} ${jwk.crv ?? ""}`);
  }
  return `${tipo} ${blob.toString("base64")}`;
}
