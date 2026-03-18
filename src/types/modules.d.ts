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
    get(oids: string[], callback: (error: Error | null, varbinds: Varbind[]) => void): void;
    close(): void;
  }

  const SecurityLevel: { authNoPriv: number; authPriv: number; noAuthNoPriv: number };
  const AuthProtocols: { md5: number; sha: number };

  function createSession(host: string, community: string, options?: SessionOptions): Session;
  function createV3Session(host: string, user: { name: string; level: number; authProtocol: number; authKey: string }, options?: SessionOptions): Session;
}

declare module "oui" {
  function oui(mac: string): string | null;
  export = oui;
}
