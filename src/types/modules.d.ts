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
    close(): void;
  }

  function createSession(host: string, community: string, options?: SessionOptions): Session;
}

declare module "oui" {
  function oui(mac: string): string | null;
  export = oui;
}
