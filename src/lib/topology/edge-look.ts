/**
 * Come si disegna un collegamento (spec §11.4, stile A della bozza approvata il
 * 14/10). Mai il solo colore: lo spessore dice la velocità (con l'etichetta),
 * la forma dice tipo e stato (ondulata = wireless, doppia = ridondanza,
 * tratteggiata grigia = non vista, puntinata = a mano non confermata) e ogni
 * stato ha la sua parola o il suo simbolo sulla linea. Logica pura: il
 * componente della linea (map-edge.tsx) disegna quello che dice qui.
 */
import type { LinkSource, MapLink } from "@/lib/topology/model-types";

/** Spessore del tratto in px dalla velocità in Mbps. */
export function speedWidth(mbps: number | null): number {
  if (mbps === null) return 2.4;
  if (mbps >= 10000) return 6;
  if (mbps >= 2500) return 4;
  if (mbps >= 1000) return 2.4;
  return 1.2;
}

const num = (v: number): string => String(Math.round(v * 10) / 10).replace(".", ",");

/** «10G», «2,5G», «1G», «100M»; null se la velocità non è nota. */
export function speedLabel(mbps: number | null): string | null {
  if (mbps === null || mbps <= 0) return null;
  return mbps >= 1000 ? `${num(mbps / 1000)}G` : `${Math.round(mbps)}M`;
}

/** «⚡ 7,5 W»; null senza PoE. */
export function poeLabel(w: number | null): string | null {
  return w !== null && w > 0 ? `⚡ ${num(w)} W` : null;
}

export interface EdgeLook {
  width: number;
  /** strokeDasharray, null = continua. */
  dash: string | null;
  /** Grigia: solo per «non vista» (con il tratteggio e la parola). */
  grey: boolean;
  wavy: boolean;
  double: boolean;
  /** Le parole sulla linea, in ordine: velocità, tipo, PoE, a mano, ★, ridondanza, non vista. */
  tokens: string[];
}

/**
 * `inTree`: la linea con cui un riquadro è appeso al genitore. Lì il «non visto»
 * lo dice già l'etichetta delle porte sopra il riquadro: la linea non lo ripete.
 */
export function edgeLook(l: MapLink, opts: { inTree: boolean }): EdgeLook {
  const tokens: string[] = [];
  const speed = speedLabel(l.speedMbps);
  if (speed) tokens.push(speed);
  if (l.medium === "wireless") tokens.push("≋ Wi-Fi");
  else if (l.medium === "fibra") tokens.push("fibra");
  const poe = poeLabel(l.poeW);
  if (poe) tokens.push(poe);
  if (l.manual) tokens.push(l.manual.confirmed ? "✎ ✓" : "✎ ?");
  if (l.primary === "user") tokens.push("★");
  if (l.redundant) tokens.push("ridondanza");
  if (l.stale && !opts.inTree) tokens.push(`▲ non visto da ${l.daysUnseen ?? "?"} g`);
  return {
    width: speedWidth(l.speedMbps),
    dash: l.stale ? "6 4" : l.manual && !l.manual.confirmed ? "1.5 4" : null,
    grey: l.stale,
    wavy: l.medium === "wireless",
    double: l.redundant,
    tokens,
  };
}

export interface Pt { x: number; y: number }

/** I vertici di un percorso SVG fatto di M/L/Q (come getSmoothStepPath con raggio 0): senza doppi né punti in linea. */
export function pathPoints(path: string): Pt[] {
  const raw: Pt[] = [];
  const re = /(-?\d+(?:\.\d+)?)[ ,]+(-?\d+(?:\.\d+)?)/g;
  for (let m = re.exec(path); m; m = re.exec(path)) raw.push({ x: Number(m[1]), y: Number(m[2]) });
  const out: Pt[] = [];
  for (const p of raw) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    const prev = out[out.length - 2];
    // Tre punti in linea (stessa x o stessa y): quello in mezzo non è un vertice.
    if (prev && last && ((prev.x === last.x && last.x === p.x) || (prev.y === last.y && last.y === p.y))) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

const f = (v: number): string => String(Math.round(v * 10) / 10);

/** Un tracciato ondulato lungo la spezzata: archi alterni di ampiezza `amp` ogni `wave` px. Stessi punti, stesso tracciato. */
export function wavyPath(points: readonly Pt[], amp = 3, wave = 12): string {
  if (points.length === 0) return "";
  let d = `M${f(points[0].x)} ${f(points[0].y)}`;
  let sign = 1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    const n = Math.max(1, Math.round(len / wave));
    const nx = -dy / len, ny = dx / len;
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, tm = (t0 + t1) / 2;
      const cx = a.x + dx * tm + nx * amp * 2 * sign, cy = a.y + dy * tm + ny * amp * 2 * sign;
      d += ` Q${f(cx)} ${f(cy)} ${f(a.x + dx * t1)} ${f(a.y + dy * t1)}`;
      sign = -sign;
    }
  }
  return d;
}

/**
 * Le fonti di un collegamento in parole (dettagli, menu della linea, pagina dei dati). Una riga `mndp` scritta da un
 * router o da SNMP è un annuncio di rete: MNDP oppure il CDP di un MikroTik, che il lettore scrive `mndp` perché
 * attraversa gli switch (spec §13.5.2): finché `discovered_by` (T2) non dice quale, a schermo «annuncio di rete».
 */
export const SOURCE_WORDS: Readonly<Record<LinkSource, string>> = {
  manual: "a mano", unifi_uplink: "uplink UniFi", lldp: "LLDP", cdp: "CDP", mndp: "annuncio di rete (MNDP o CDP)", mac_table: "tabella MAC", vm_mac: "dalle VM",
};

/** Per un collegamento «dalle VM» (spec §12.5): «N VM di <hypervisor> passano da questa porta»; altrimenti null. */
export function vmPortWords(l: Pick<MapLink, "sources" | "vmCount" | "uplinkFrom">, nameOf: (id: string) => string): string | null {
  if (!l.sources.includes("vm_mac") || !l.vmCount || !l.uplinkFrom) return null;
  return `${l.vmCount} VM di ${nameOf(l.uplinkFrom)} ${l.vmCount === 1 ? "passa" : "passano"} da questa porta`;
}

/**
 * «Altri cavi visti fra questi due oggetti» (spec §13.4.6, T1): le porte dalla parte dell'oggetto scelto, le fonti in
 * parole. Servono all'«Ignora» per cavo: dicono che cosa resta se si ignora la linea.
 */
export function altriCaviDi(l: Pick<MapLink, "a" | "altriCavi">, nodo: string): Array<{ mia: string; sua: string; fonti: string; visto: string | null }> {
  return (l.altriCavi ?? []).map((c) => ({
    mia: l.a === nodo ? c.aPort : c.bPort,
    sua: l.a === nodo ? c.bPort : c.aPort,
    fonti: c.sources.map((s) => SOURCE_WORDS[s]).join(" + "),
    visto: c.lastSeen,
  }));
}

/** La linea in parole, per la barra dei dettagli: velocità, tipo, PoE, a mano (confermata o no), principale o ridondanza. */
export function linkWords(l: MapLink): string[] {
  const out: string[] = [];
  const speed = speedLabel(l.speedMbps);
  if (speed) out.push(`velocità ${speed}`);
  if (l.medium) out.push(`tipo: ${l.medium}`);
  if (l.poeW !== null && l.poeW > 0) out.push(`PoE ${num(l.poeW)} W`);
  if (l.manual) {
    out.push(l.manual.confirmed ? "✎ ✓ a mano, confermato: le letture lo vedono" : "✎ ? solo a mano: le letture non lo vedono sulla porta dichiarata");
  }
  if (l.primary === "user") out.push("★ principale scelto a mano");
  else if (l.primary === "auto") out.push("principale (scelto dal sistema)");
  else if (l.redundant) out.push("ridondanza: non è il collegamento principale");
  return out;
}

/**
 * Quando le letture hanno visto il collegamento, in parole (barra dei dettagli, menu della linea).
 * Senza una data di lettura non si dice «visto oggi»: un collegamento solo a mano nessuno lo ha letto
 * (prima diceva «✓ visto oggi» accanto a «✎ ? le letture non lo vedono», Task 12 della fase 2b).
 */
export function seenWords(l: MapLink): string {
  if (l.stale) return `▲ non visto da ${l.daysUnseen ?? "?"} g`;
  if (l.lastSeen === null) return l.sources.every((s) => s === "manual") ? "dichiarato a mano, nessuna lettura lo vede" : "data della lettura non nota";
  if (!l.daysUnseen) return "✓ visto oggi";
  return `✓ visto ${l.daysUnseen} g fa`;
}
