/**
 * Porte fisiche di un MikroTik: chi è attaccato a quale porta (topologia, fase 2b, Task 1b).
 *
 * Perché esiste: fino alla v0.3.279 i MAC per porta di un router venivano dalla
 * tabella ARP (`/ip arp print terse`), la cui `interface=` è l'interfaccia L3 su
 * cui sta l'IP — `bridge`, una VLAN, una VRRP — e non la porta del cavo. Sul
 * cliente A 747 righe su 753 erano di quel tipo: non provavano nessun cavo. La
 * porta vera sta nella bridge host (`/interface bridge host print terse`,
 * `on-interface=`), e il tipo della porta in `/interface print terse` (`type=`).
 *
 * Si tengono solo le righe su porte di tipo `ether` (anche gli sfp, che RouterOS
 * chiama ether) o `bond` (un fascio di cavi verso un apparato solo). Bridge,
 * VLAN, VRRP, eoip, wlan/wifi e gli altri tunnel non sono cavi. Logica pura.
 */
import type { MacTableEntry } from "@/lib/devices/switch-client";

/** Tipi di interfaccia RouterOS che sono un cavo verso un apparato. */
const TIPI_FISICI = new Set(["ether", "bond"]);

/** Coppie chiave=valore di una riga `print terse` (valori fra virgolette compresi). */
function campi(riga: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of riga.matchAll(/([A-Za-z0-9][\w-]*)=("([^"]*)"|\S*)/g)) {
    if (!out.has(m[1])) out.set(m[1], m[3] ?? m[2]);
  }
  return out;
}

/** Le lettere dei flag fra l'indice e il primo campo (` 3 DL mac-address=…` → «DL»). */
function flag(riga: string): string {
  const m = riga.match(/^\s*\d+\s+([A-Z]+)\s+[A-Za-z0-9-]+=/);
  return m ? m[1] : "";
}

/**
 * `/interface bridge host print terse` (e la stessa forma sugli switch MikroTik).
 * Scarta le righe locali (flag L o `local=yes`: sono i MAC dell'apparato stesso,
 * uno per porta), disabilitate (X) e non valide (I). `vid=` diventa la VLAN.
 */
export function parseMikrotikMacTable(output: string): MacTableEntry[] {
  const entries: MacTableEntry[] = [];
  for (const riga of output.split("\n")) {
    const c = campi(riga);
    const mac = c.get("mac-address");
    if (!mac || !/^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac)) continue;
    if (/[LXI]/.test(flag(riga)) || c.get("local") === "yes") continue;
    const vid = Number.parseInt(c.get("vid") ?? "", 10);
    entries.push({
      mac: mac.toUpperCase(),
      port_name: c.get("on-interface") || "unknown",
      vlan: Number.isFinite(vid) ? vid : null,
      port_status: null,
      speed: null,
    });
  }
  return entries;
}

/** `/interface print terse` → nome dell'interfaccia → tipo (`ether`, `bridge`, `vlan`, …). */
export function parseMikrotikInterfaceTypes(output: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const riga of output.split("\n")) {
    const c = campi(riga);
    const nome = c.get("name");
    const tipo = c.get("type");
    if (nome && tipo) out.set(nome, tipo.toLowerCase());
  }
  return out;
}

/**
 * Le righe della bridge host che stanno su una porta fisica (tipo `ether` o
 * `bond`), una per coppia MAC-porta (con `vlan-filtering` lo stesso MAC compare
 * una volta per VLAN: si tiene la prima). Una porta che `/interface print` non
 * elenca non si salva: senza il tipo non si sa se è un cavo.
 */
export function macPorteFisiche(hosts: MacTableEntry[], tipi: ReadonlyMap<string, string>): MacTableEntry[] {
  const viste = new Set<string>();
  const out: MacTableEntry[] = [];
  for (const h of hosts) {
    const tipo = tipi.get(h.port_name);
    if (!tipo || !TIPI_FISICI.has(tipo)) continue;
    const k = `${h.mac}|${h.port_name}`;
    if (viste.has(k)) continue;
    viste.add(k);
    out.push(h);
  }
  return out;
}

/** Ciò che serve del client del router per leggere le porte fisiche. */
export interface LettorePorteRouter {
  getBridgeHosts?(): Promise<MacTableEntry[]>;
  getInterfaceTypes?(): Promise<Map<string, string>>;
}

/** Codice dell'errore, mai il messaggio: quello di ssh porta IP e porte del server. */
export function codiceErrore(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z0-9_]{2,40}$/.test(code)) return code;
  if (err instanceof Error && /timed? ?out/i.test(err.message)) return "timeout";
  return "errore";
}

/**
 * Legge bridge host e tipi delle interfacce e restituisce le righe da salvare.
 * `righe: null` se il client non sa leggerle (non MikroTik SSH) o se la lettura
 * fallisce; in quel caso `errore` porta il solo codice, per il resoconto.
 */
export async function leggiMacPorteRouter(
  client: LettorePorteRouter,
): Promise<{ righe: MacTableEntry[] | null; errore: string | null }> {
  if (!client.getBridgeHosts || !client.getInterfaceTypes) return { righe: null, errore: null };
  try {
    const [hosts, tipi] = await Promise.all([client.getBridgeHosts(), client.getInterfaceTypes()]);
    return { righe: macPorteFisiche(hosts, tipi), errore: null };
  } catch (err) {
    return { righe: null, errore: codiceErrore(err) };
  }
}
