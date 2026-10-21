/**
 * I vicini di un MikroTik da `/ip neighbor print terse` (spec topologia §13.5.2, lettore di T1). Logica pura.
 *
 * Perché esiste: il lettore di prima (router-client.ts) leggeva ogni valore fino al primo spazio, e nel «terse»
 * RouterOS non mette le virgolette ai valori con gli spazi (uscita vera del router 1 del cliente A, 14/10): «Port 47»
 * diventava «Port», un nome di porta dato dal cliente si fermava alla prima parola. E scriveva sempre `mndp`, anche per
 * le righe LLDP. Qui una riga si divide sul confine « chiave=» (una chiave è `[a-z][a-z0-9-]*`) e un valore va dalla
 * sua chiave alla chiave dopo; un valore fra virgolette (la forma di `print detail`) va fino alla virgoletta che lo
 * chiude. Il protocollo viene da `discovered-by` (RouterOS 7.7 e dopo). Stesso comando di prima: nessun comando nuovo
 * sui router dei clienti in un rilascio leggero (D1, confermato il 14/10 sera).
 * Limite noto: in un valore SENZA virgolette, uno spazio seguito da «parola=» è letto come la chiave dopo (il «terse»
 * non lo può distinguere).
 */
import type { NeighborEntry } from "@/lib/devices/router-client";

const CHIAVE = /(?:^|\s)([a-z][a-z0-9-]*)=/g;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const MAC = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;

/**
 * Le righe di un'uscita, una per vicino. Un vicino comincia con l'indice, che ha al massimo due spazi davanti (la colonna
 * degli indici è larga quanto l'indice più lungo: fino a 999 vicini). Una riga rientrata di tre spazi o più lo continua: il
 * `print detail` va a capo da sé, fra un campo e l'altro (3, 4 o 5 spazi, secondo la larghezza degli indici) e, via ssh a
 * 79 colonne, anche dentro un valore fra virgolette (7 spazi); va a capo sempre su uno spazio, e per questo le righe si
 * uniscono con uno spazio. Una riga che continua un valore può cominciare con «cifre spazio» («24 porte»): con la regola di
 * prima (un numero in testa apre un vicino) il vicino vero perdeva i campi dopo. Commenti («#») e prompt di un'uscita
 * incollata stanno a inizio riga e non contano. La terse incollata da un terminale va a capo a metà parola e senza rientro:
 * il lettore legge ciò che arriva da `sshExec`, e la fixture di una terse incollata la ricompone in una riga.
 */
export function righeDiUscita(output: string): string[] {
  const out: string[] = [];
  for (const riga of output.split(/\r?\n/)) {
    if (/^#/.test(riga) || /^\[[^\]]*\]\s*>/.test(riga)) continue;
    if (/^ {0,2}\d+\s/.test(riga)) out.push(riga.trim());
    else if (/^\s{3,}\S/.test(riga) && out.length > 0) out[out.length - 1] += ` ${riga.trim()}`;
  }
  return out;
}

/** La virgoletta che chiude un valore che comincia a `da` (una `\"` dentro il valore non chiude). */
function chiusa(riga: string, da: number): number {
  for (let i = da; i < riga.length; i++) {
    if (riga[i] === "\\") { i++; continue; }
    if (riga[i] === '"') return i;
  }
  return -1;
}

/** Le coppie chiave=valore di una riga `print terse` o `print detail`. L'indice e i flag in testa non si leggono. */
export function campiTerse(riga: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(CHIAVE.source, "g");
  let m = re.exec(riga);
  while (m) {
    const chiave = m[1];
    const inizio = m.index + m[0].length;
    let valore: string;
    if (riga[inizio] === '"') {
      const fine = chiusa(riga, inizio + 1);
      valore = (fine < 0 ? riga.slice(inizio + 1) : riga.slice(inizio + 1, fine)).replace(/\\"/g, '"');
      re.lastIndex = fine < 0 ? riga.length : fine + 1;
      m = re.exec(riga);
    } else {
      const dopo = re.exec(riga);
      valore = riga.slice(inizio, dopo ? dopo.index : riga.length).trim();
      m = dopo;
    }
    if (!out.has(chiave)) out.set(chiave, valore);
  }
  return out;
}

/**
 * Il protocollo da `discovered-by` (spec §13.5.2): `lldp` se l'elenco lo contiene; altrimenti `mndp`, anche con `cdp`:
 * il CDP di un MikroTik attraversa gli switch che non sono Cisco, e scritto `cdp` confermerebbe un cavo e riporterebbe
 * il falso cavo fra router (revisione M-5). Senza il campo (RouterOS prima della 7.7) resta `mndp`, come prima.
 */
export function mikrotikProtocol(discoveredBy: string | undefined): "lldp" | "mndp" {
  const elenco = (discoveredBy ?? "").split(",").map((s) => s.trim().toLowerCase());
  return elenco.includes("lldp") ? "lldp" : "mndp";
}

/** Un elenco separato da virgole in una forma sola: minuscolo, in ordine, senza vuoti; assente se vuoto. */
function elenco(v: string | undefined): string | undefined {
  const s = (v ?? "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x !== "");
  return s.length > 0 ? [...new Set(s)].sort().join(",") : undefined;
}

/** `/ip neighbor print terse` (o `print detail`) → i vicini, coi valori interi e il protocollo vero. */
export function parseMikrotikNeighbors(output: string): NeighborEntry[] {
  const entries: NeighborEntry[] = [];
  for (const riga of righeDiUscita(output)) {
    const c = campiTerse(riga);
    const iface = c.get("interface") ?? "";
    const remoteName = c.get("identity") ?? "";
    if (!iface && !remoteName) continue;
    const ip = c.get("address4") || c.get("address") || "";
    const mac = c.get("mac-address") ?? "";
    const platform = c.get("platform") ?? "";
    entries.push({
      localPort: iface,
      remoteDevice: remoteName,
      remotePort: c.get("interface-name") ?? "",
      protocol: mikrotikProtocol(c.get("discovered-by")),
      remoteIp: IPV4.test(ip) ? ip : undefined,
      remoteMac: MAC.test(mac) ? mac.toUpperCase() : undefined,
      remotePlatform: platform || undefined,
      ...(elenco(c.get("discovered-by")) ? { discoveredBy: elenco(c.get("discovered-by")) } : {}),
      ...(elenco(c.get("system-caps-enabled")) ? { remoteCaps: elenco(c.get("system-caps-enabled")) } : {}),
      ...(c.get("version") ? { remoteVersion: c.get("version") } : {}),
    });
  }
  return entries;
}
