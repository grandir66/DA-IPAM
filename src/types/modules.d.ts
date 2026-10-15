declare module "net-snmp" {
  interface SessionOptions {
    port?: number;
    timeout?: number;
    retries?: number;
    /** Version1 (0) o Version2c (1). Assente = v1: si passa sempre da src/lib/protocols/snmp-sessione.ts. */
    version?: number;
  }

  const Version1: number;
  const Version2c: number;

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

  // Agente (tappa 2 credenziali, T4): solo quello che serve all'agente SNMPv3
  // delle prove (src/lib/protocols/__tests__/support/agente-snmp-v3.ts).
  // Valori verificati su node_modules/net-snmp/index.js 3.26.1.
  enum MibProviderType {
    Scalar = 1,
    Table = 2,
  }

  enum ObjectType {
    OctetString = 4,
    OID = 6,
  }

  enum MaxAccess {
    "read-only" = 2,
  }

  interface MibScalarProvider {
    name: string;
    type: MibProviderType;
    /** OID del nodo sopra l'istanza (senza ".0"). */
    oid: string;
    scalarType: ObjectType;
    maxAccess: MaxAccess;
  }

  interface Mib {
    registerProvider(provider: MibScalarProvider): void;
    setScalarValue(name: string, value: string | number): void;
  }

  interface Authorizer {
    addUser(user: V3User): void;
  }

  interface Agent {
    getAuthorizer(): Authorizer;
    getMib(): Mib;
    close(callback?: () => void): void;
  }

  interface AgentOptions {
    /** Porta 0 o assente = 161: la libreria non sceglie una porta libera. */
    port?: number;
    address?: string | null;
    transport?: "udp4" | "udp6";
    /** Fabbrica del socket: le prove la usano per sapere quando l'agente è in ascolto. */
    dgramModule?: { createSocket(type: "udp4" | "udp6"): import("node:dgram").Socket };
  }

  function createAgent(options: AgentOptions, callback: (error: Error | null, data: unknown) => void): Agent;
}

declare module "oui" {
  function oui(mac: string): string | null;
  export = oui;
}
