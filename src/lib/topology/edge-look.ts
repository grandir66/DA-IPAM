/**
 * Come si disegna un collegamento (spec §11.4, stile A della bozza approvata il
 * 14/10). Mai il solo colore: lo spessore dice la velocità (con l'etichetta),
 * la forma dice tipo e stato (ondulata = wireless, doppia = ridondanza,
 * tratteggiata grigia = non vista, puntinata = a mano non confermata) e ogni
 * stato ha la sua parola o il suo simbolo sulla linea. Logica pura: il
 * componente della linea (map-edge.tsx) disegna quello che dice qui.
 */
import type { CavoLinea, LinkSource, MapLink } from "@/lib/topology/model-types";

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
  /** Le parole sulla linea, in ordine: velocità, tipo, stato, PoE, a mano, ★, ridondanza, non vista. */
  tokens: string[];
  /** T3: cavo giù, tratto scuro pieno (mai il grigio di «non visto»). Assente = no. */
  nero?: boolean;
  /** T3: il simbolo scritto a metà linea («⋯» della contrazione via segmento). Assente = nessuno. */
  centro?: string;
}

/** I tratteggi, uno per significato (spec §13.10.3): nessuno si riusa con un altro senso. */
export const TRATTI = { nonVisto: "6 4", aMano: "1.5 4", giu: "10 4", tunnel: "8 3 2 3" } as const;

const NOME_DI_DEFAULT = (id: string): string => id;

/** L'elenco di VLAN in parole: «VLAN 12 attiva», «VLAN 12, 77 attive». */
function vlanAttive(v: readonly number[] | undefined): string | null {
  if (!v || v.length === 0) return null;
  return `VLAN ${v.join(", ")} ${v.length === 1 ? "attiva" : "attive"}`;
}

/** La parola del genere della linea (fascio, tunnel, radio, oltre, contrazione), corta o intera; null se il genere non ne ha. */
export function parolaGenere(c: CavoLinea, forma: "corta" | "intera", nomeDi: (id: string) => string = NOME_DI_DEFAULT): string | null {
  const corta = forma === "corta";
  if (c.genere === "contrazione") {
    if (c.via === "radio") return corta ? "≋ radio" : "via ponte radio";
    return corta ? "segmento" : "via segmento non gestito: non è in questa mappa";
  }
  if (c.genere === "fascio" && c.fascio) {
    const n = c.fascio.membri.length;
    if (corta) return `${n} cavi`;
    if (c.fascio.dedotto) return "fascio dedotto";
    const giu = c.fascio.membri.filter((m) => m.stato === "giu").length;
    if (giu > 0) return `fascio di ${n} cavi, ${giu} giù`;
    const v = c.fascio.membri.map((m) => m.velocitaMbps);
    const uguali = v.length > 0 && v[0] !== null && v.every((x) => x === v[0]);
    const vel = uguali ? speedLabel(v[0]) : null;
    return vel ? `fascio di ${n} cavi · ${n} × ${vel}` : `fascio di ${n} cavi`;
  }
  // Il tipo del tunnel (EoIP…) non è nel modello: la parola resta «tunnel» finché una lettura non lo porta.
  if (c.genere === "tunnel") return "tunnel";
  if (c.genere === "radio") return corta ? "≋ radio" : "≋ ponte radio";
  if (c.genere === "senza_fili") return "≋ Wi-Fi";
  if (c.oltre) return corta ? `oltre ${nomeDi(c.oltre)}` : `dedotto: oltre ${nomeDi(c.oltre)}, salto non letto`;
  return null;
}

/**
 * Le parole intere del genere e dello stato di un cavo, per i dettagli (verifica a schermo di T3, Task 14: «oltre 1…» si
 * accorciava sulla linea e il testo intero non si leggeva da nessuna parte). Vuoto per un cavo che inoltra.
 */
export function paroleDelCavo(c: CavoLinea, nomeDi: (id: string) => string = NOME_DI_DEFAULT): string[] {
  return [parolaGenere(c, "intera", nomeDi), parolaDelloStato(c, "intera", nomeDi)].filter((x): x is string => x !== null);
}

/** La parola dello stato del collegamento (solo lo stato), corta o intera; null se inoltra o non è noto. */
function parolaDelloStato(c: CavoLinea, forma: "corta" | "intera", nomeDi: (id: string) => string): string | null {
  const corta = forma === "corta";
  switch (c.stato) {
    case "bloccato": return corta ? "bloccato" : "⊘ bloccato dallo spanning tree";
    case "bloccato_comune": {
      if (corta) return "in parte";
      const resto = c.istanzeNonLette ? "può portare altre VLAN" : vlanAttive(c.attivoPerVlan);
      return resto ? `⊘ bloccato nell'albero comune · ${resto}` : "⊘ bloccato nell'albero comune";
    }
    case "instradato": return corta ? "instradato" : c.wan ? "instradato: la WAN del gateway" : "instradato, fuori dal bridge";
    case "giu": return corta ? "cavo giù" : c.giuSu ? `cavo giù: la porta ${c.giuSu.porta} di ${nomeDi(c.giuSu.nodo)} è giù` : "cavo giù";
    case "riserva_bond": return corta ? "riserva" : "riserva del bond: si usa se cade l'altra scheda";
    default: return null;
  }
}

/**
 * La parola del collegamento (spec §13.10.3): lo stato se c'è, altrimenti quella del genere. «corta» sulla linea
 * dell'albero, «intera» su una ridondanza e nei dettagli; «giù» intera nomina la porta (`giuSu`).
 */
export function parolaStato(c: CavoLinea, forma: "corta" | "intera", nomeDi: (id: string) => string): string | null {
  return parolaDelloStato(c, forma, nomeDi) ?? parolaGenere(c, forma, nomeDi);
}

/** Un pezzo d'etichetta che non sta nel suo spazio si accorcia con «…» (I32): resta intero al passaggio del mouse. */
export function pezzoNelloSpazio(pezzo: string, maxCaratteri: number): string {
  const chars = Array.from(pezzo);
  if (chars.length <= maxCaratteri) return pezzo;
  return `${chars.slice(0, Math.max(0, maxCaratteri - 1)).join("")}…`;
}

/**
 * `inTree`: la linea con cui un riquadro è appeso al genitore. Lì il «non visto»
 * lo dice già l'etichetta delle porte sopra il riquadro: la linea non lo ripete.
 * Con `l.cavo` (mappa nuova) le parole e le forme sono quelle del §13.10.3; senza, quelle di oggi.
 */
export function edgeLook(l: MapLink, opts: { inTree: boolean; nomeDi?: (id: string) => string }): EdgeLook {
  if (l.cavo) return edgeLookCavo(l, l.cavo, opts.inTree, opts.nomeDi ?? NOME_DI_DEFAULT);
  const tokens: string[] = [];
  const speed = speedLabel(l.speedMbps);
  if (speed) tokens.push(speed);
  if (l.medium === "wireless") tokens.push("≋ Wi-Fi");
  else if (l.medium === "fibra") tokens.push("fibra");
  else if (l.medium === "tunnel") tokens.push("tunnel");
  const poe = poeLabel(l.poeW);
  if (poe) tokens.push(poe);
  if (l.manual) tokens.push(l.manual.confirmed ? "✎ ✓" : "✎ ?");
  if (l.primary === "user") tokens.push("★");
  if (l.redundant) tokens.push("ridondanza");
  if (l.stale && !opts.inTree) tokens.push(`▲ non visto da ${l.daysUnseen ?? "?"} g`);
  return {
    width: speedWidth(l.speedMbps),
    dash: l.stale ? TRATTI.nonVisto : l.manual && !l.manual.confirmed ? TRATTI.aMano : null,
    grey: l.stale,
    wavy: l.medium === "wireless",
    double: l.redundant,
    tokens,
  };
}

function edgeLookCavo(l: MapLink, c: CavoLinea, inTree: boolean, nomeDi: (id: string) => string): EdgeLook {
  const forma = inTree ? "corta" : "intera";
  const giu = c.stato === "giu";
  const tunnel = c.genere === "tunnel";
  const tokens: string[] = [];
  // Velocità (non per «giù»), poi il genere, poi lo stato: al più un pezzo di stato.
  const speed = speedLabel(l.speedMbps);
  if (speed && !giu) tokens.push(speed);
  if (l.medium === "fibra" && c.genere === "cavo") tokens.push("fibra");
  const stato = parolaDelloStato(c, forma, nomeDi);
  const genere = parolaGenere(c, forma, nomeDi);
  // Un tunnel acceso con annunci vecchi: «tunnel ▲» sulla linea dell'albero (la parola dice «non visto»).
  const tunnelVecchio = tunnel && l.stale && !giu && !stato;
  if (genere && !(giu && !tunnel)) tokens.push(tunnelVecchio && inTree ? `${genere} ▲` : genere);
  if (stato) tokens.push(stato);
  const poe = poeLabel(l.poeW);
  if (poe) tokens.push(poe);
  if (l.manual) tokens.push(l.manual.confirmed ? "✎ ✓" : "✎ ?");
  if (l.primary === "user") tokens.push("★");
  if (l.redundant && !stato) tokens.push("ridondanza");
  // Un cavo giù smette di mandare LLDP e diventa anche «non visto»: vale «cavo giù», il resto va nei dettagli.
  if (l.stale && !inTree && !giu) tokens.push(`▲ non visto da ${l.daysUnseen ?? "?"} g`);
  const look: EdgeLook = {
    width: speedWidth(l.speedMbps),
    dash: giu ? TRATTI.giu : tunnel ? TRATTI.tunnel : l.stale ? TRATTI.nonVisto : l.manual && !l.manual.confirmed ? TRATTI.aMano : null,
    grey: l.stale && !giu,
    wavy: c.genere === "radio" || c.genere === "senza_fili" || (c.genere === "contrazione" && c.via === "radio") || l.medium === "wireless",
    double: l.redundant || c.stato === "bloccato" || c.stato === "bloccato_comune" || c.stato === "riserva_bond",
    tokens,
  };
  if (giu) look.nero = true;
  if (c.genere === "contrazione" && c.via === "segmento") look.centro = "⋯";
  return look;
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

/** Il protocollo dentro una frase di «Perché questo collegamento» (spec §13.4.6): «LLDP», «CDP», «un annuncio di rete (MNDP o CDP)». */
export function dettoInFrase(f: LinkSource): string {
  return f === "mndp" ? `un ${SOURCE_WORDS.mndp}` : SOURCE_WORDS[f];
}

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
