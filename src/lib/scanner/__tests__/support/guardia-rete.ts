// Guardia di rete per le prove delle scansioni (T3-16, strumento per INV-1/INV-2).
//
// Si importa PRIMA dei moduli dello scanner: `ping.ts` e `arp-cache.ts` legano
// `execFile` quando si caricano (promisify), quindi una sostituzione fatta dopo
// arriverebbe tardi. Da quel momento ogni uscita verso la rete — socket TCP,
// socket UDP, processi esterni (ping, nmap, arp), richieste DNS — lancia e
// lascia una riga in `tentativiBloccati` (anche le varianti sincrone e le
// scorciatoie DNS del resolver predefinito). La prova asserisce che l'elenco è
// vuoto: una scansione che ingoia l'errore (ping «morto» invece di fallire) si
// vede lo stesso.
import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

export const tentativiBloccati: string[] = [];

type Ripristino = () => void;
const ripristini: Ripristino[] = [];

function blocca<T extends object>(obj: T, nome: keyof T & string, etichetta: string): void {
  const proprio = Object.prototype.hasOwnProperty.call(obj, nome);
  const originale = obj[nome];
  (obj as Record<string, unknown>)[nome] = function bloccato(...args: unknown[]): never {
    const primo = typeof args[0] === "string" ? ` ${args[0]}` : "";
    tentativiBloccati.push(`${etichetta}${primo}`);
    throw new Error(`guardia di rete: ${etichetta} vietato durante la prova`);
  };
  ripristini.push(() => {
    // Un metodo ereditato si toglie, non si copia: resterebbe sopra al prototipo.
    if (proprio) (obj as Record<string, unknown>)[nome] = originale;
    else delete (obj as Record<string, unknown>)[nome];
  });
}

const METODI_DNS = [
  "reverse",
  "resolve",
  "resolve4",
  "resolve6",
  "resolveAny",
  "resolveCaa",
  "resolveCname",
  "resolveMx",
  "resolveNaptr",
  "resolveNs",
  "resolvePtr",
  "resolveSoa",
  "resolveSrv",
  "resolveTxt",
] as const;

function installa(): void {
  blocca(net.Socket.prototype, "connect", "net.Socket.connect");
  blocca(dgram, "createSocket", "dgram.createSocket");
  blocca(childProcess, "execFile", "child_process.execFile");
  blocca(childProcess, "spawn", "child_process.spawn");
  blocca(childProcess, "exec", "child_process.exec");
  blocca(childProcess, "fork", "child_process.fork");
  blocca(childProcess, "execFileSync", "child_process.execFileSync");
  blocca(childProcess, "execSync", "child_process.execSync");
  blocca(childProcess, "spawnSync", "child_process.spawnSync");
  blocca(dns, "lookup", "dns.lookup");
  blocca(dns.promises, "lookup", "dns.promises.lookup");
  // Le scorciatoie `dns.reverse`/`dns.resolve*` sono legate al resolver
  // predefinito quando il modulo si carica (c-ares, non dgram): la patch sul
  // prototipo non le tocca, vanno sostituite una per una.
  for (const m of METODI_DNS) {
    blocca(dns, m, `dns.${m}`);
    blocca(dns.promises, m, `dns.promises.${m}`);
    blocca(dns.Resolver.prototype, m, `dns.Resolver.${m}`);
    blocca(dns.promises.Resolver.prototype, m, `dns.promises.Resolver.${m}`);
  }
  syncBuiltinESMExports();
}

/** Toglie la guardia (per il `after` della prova). */
export function togliGuardiaRete(): void {
  while (ripristini.length) ripristini.pop()!();
  syncBuiltinESMExports();
}

installa();
