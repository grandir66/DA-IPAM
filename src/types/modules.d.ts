declare module "net-snmp" {
  interface SessionOptions {
    port?: number;
    timeout?: number;
  }

  interface Varbind {
    oid: string;
    value: Buffer | string | number;
  }

  interface Session {
    subtree(
      oid: string,
      feedCallback: (varbinds: Varbind[]) => void,
      doneCallback: (error: Error | undefined) => void
    ): void;
    subtree(
      oid: string,
      maxRepetitions: number,
      feedCallback: (varbinds: Varbind[]) => boolean | void,
      doneCallback: (error: Error | undefined) => void
    ): void;
    get(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void;
    close(): void;
  }

  // Fase 4b Task 2 (SNMPv3 authPriv completo): valori allineati a quelli
  // realmente esportati da node_modules/net-snmp/index.js (verificato a
  // mano, la libreria non pubblica un .d.ts né esiste @types/net-snmp nel
  // progetto). `enum` (non `const`) perché il codice li usa sia come TIPO
  // (es. `level: SecurityLevel` in un'interfaccia) sia come VALORE
  // (`SecurityLevel.authPriv`).
  enum SecurityLevel {
    noAuthNoPriv = 1,
    authNoPriv = 2,
    authPriv = 3,
  }

  enum AuthProtocols {
    none = 1,
    md5 = 2,
    sha = 3,
    sha224 = 4,
    sha256 = 5,
    sha384 = 6,
    sha512 = 7,
  }

  /** AES192 NON esiste in questa libreria (solo des/aes(128)/aes256b/aes256r) — vedi src/lib/protocols/snmpv3.ts. */
  enum PrivProtocols {
    none = 1,
    des = 2,
    aes = 4,
    aes256b = 6,
    aes256r = 8,
  }

  interface V3User {
    name: string;
    level: SecurityLevel;
    authProtocol?: AuthProtocols;
    authKey?: string;
    privProtocol?: PrivProtocols;
    privKey?: string;
  }

  function createSession(host: string, community: string, options?: SessionOptions): Session;
  function createV3Session(host: string, user: V3User, options?: SessionOptions): Session;
  function isVarbindError(varbind: Varbind): boolean;
}

declare module "oui" {
  function oui(mac: string): string | null;
  export = oui;
}
