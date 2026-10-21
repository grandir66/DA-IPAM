/**
 * Pezzi puri della scheda storage e NAS (21/10): ordine degli alloggiamenti, stato di ogni disco (buono o
 * attenzione col motivo), volumi e pool con le percentuali, totale dello spazio, livello e stato del RAID.
 * Legge `device_info.nas_inventory` così come lo scrive `nas-acquisition.ts`: i valori SNMP arrivano come
 * stringhe, spesso codici numerici (Synology: 1 = normale) o testo (QNAP: «GOOD», «Ready»). Senza dato, null:
 * la casella o il riquadro non si rende. Nessun accesso a database né a React.
 */
import type { NasInventorySnapshot } from "@/lib/devices/device-info";
import type { Casella } from "@/components/scheda/striscia-numeri";

type Snmp = NonNullable<NasInventorySnapshot["snmp"]>;
export type DiscoNas = NonNullable<Snmp["disks"]>[number];
export type VendorNas = NasInventorySnapshot["vendor"];

export type StatoDisco = { stato: "buono" | "attenzione" | "vuoto"; motivi: string[] };
export type Alloggiamento = { numero: number; disco: DiscoNas | null; stato: StatoDisco };

const OK_TESTO = /^(ok|normal|ready|good|active|healthy|online|clean|running)/i;
const VUOTO_TESTO = /no\s*disk|empty|absent|not\s*present/i;

/** Numero dell'alloggiamento: «Disk 3» → 3, altrimenti l'indice, altrimenti lo slot se è un numero. */
export function numeroSlot(d: DiscoNas): number | null {
  const daId = /(\d+)\s*$/.exec((d.id ?? "").trim());
  if (daId) return parseInt(daId[1], 10);
  for (const v of [d.index, d.slot]) {
    if (v && /^\d+$/.test(v.trim())) return parseInt(v.trim(), 10);
  }
  return null;
}

const SYNO_DISCO: Record<string, string | null> = {
  "1": null, "2": null, "3": "non inizializzato", "4": "partizione di sistema guasta", "5": "guasto (crashed)",
};
const SYNO_SALUTE: Record<string, string | null> = { "1": null, "2": "SMART: avviso", "3": "SMART: critico", "4": "SMART: in errore" };
const QNAP_DISCO: Record<string, string> = { "-6": "disco non valido", "-9": "errore di lettura/scrittura", "-4": "stato sconosciuto" };

/** Stato di un disco: «vuoto» se l'alloggiamento non ha disco, «attenzione» con i motivi, altrimenti «buono». */
export function statoDisco(d: DiscoNas, vendor: VendorNas): StatoDisco {
  const st = (d.status ?? "").trim();
  const smart = (d.smart_health ?? "").trim();
  if ((vendor === "qnap" && st === "-5") || VUOTO_TESTO.test(st)) return { stato: "vuoto", motivi: [] };
  const motivi: string[] = [];
  if (st !== "") {
    if (/^-?\d+$/.test(st)) {
      const m = vendor === "synology" ? SYNO_DISCO[st] : st === "0" ? null : QNAP_DISCO[st] ?? `stato ${st}`;
      if (m) motivi.push(m);
      else if (vendor === "synology" && !(st in SYNO_DISCO)) motivi.push(`stato ${st}`);
    } else if (!OK_TESTO.test(st)) motivi.push(`stato: ${st}`);
  }
  if (smart !== "") {
    if (/^\d+$/.test(smart) && vendor === "synology") {
      const m = SYNO_SALUTE[smart];
      if (m) motivi.push(m);
      else if (!(smart in SYNO_SALUTE)) motivi.push(`SMART ${smart}`);
    } else if (!OK_TESTO.test(smart)) motivi.push(`SMART: ${smart.toLowerCase()}`);
  }
  return { stato: motivi.length > 0 ? "attenzione" : "buono", motivi };
}

/** Gli alloggiamenti nell'ordine dello slot; i buchi nella numerazione sono alloggiamenti vuoti, i dischi senza numero vanno in coda. */
export function alloggiamenti(dischi: DiscoNas[] | undefined, vendor: VendorNas): Alloggiamento[] {
  if (!dischi || dischi.length === 0) return [];
  const numerati: Array<{ n: number; d: DiscoNas }> = [];
  const senza: DiscoNas[] = [];
  for (const d of dischi) {
    const n = numeroSlot(d);
    if (n == null) senza.push(d); else numerati.push({ n, d });
  }
  numerati.sort((a, b) => a.n - b.n);
  const out: Alloggiamento[] = [];
  const max = numerati.length ? numerati[numerati.length - 1].n : 0;
  // Una numerazione assurda (indici enormi) non deve generare centinaia di riquadri vuoti.
  const riempi = max <= 32;
  let n = 1;
  for (const x of numerati) {
    if (riempi) while (n < x.n) { out.push({ numero: n, disco: null, stato: { stato: "vuoto", motivi: [] } }); n++; }
    out.push({ numero: x.n, disco: x.d, stato: statoDisco(x.d, vendor) });
    n = x.n + 1;
  }
  let prossimo = max + 1;
  for (const d of senza) out.push({ numero: prossimo++, disco: d, stato: statoDisco(d, vendor) });
  return out;
}

export function riepilogoDischi(a: Alloggiamento[]): { presenti: number; buoni: number; attenzione: number; primoMotivo: string | null } {
  const presenti = a.filter((x) => x.stato.stato !== "vuoto");
  const att = presenti.filter((x) => x.stato.stato === "attenzione");
  return {
    presenti: presenti.length,
    buoni: presenti.length - att.length,
    attenzione: att.length,
    primoMotivo: att.length ? `disco ${att[0].numero}: ${att[0].stato.motivi[0] ?? "da controllare"}` : null,
  };
}

export function temperaturaMassimaDischi(dischi: DiscoNas[] | undefined): number | null {
  const t = (dischi ?? []).map((d) => d.temperature_c).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  return t.length ? Math.max(...t) : null;
}

const SYNO_RAID: Record<string, string> = {
  "1": "normale", "2": "ricostruzione", "3": "migrazione", "4": "espansione", "5": "in eliminazione", "6": "in creazione",
  "7": "sincronizzazione", "8": "controllo parità", "9": "assemblaggio", "10": "annullamento", "11": "degradato", "12": "guasto",
  "13": "scrubbing",
};

/** Stato di RAID, volume o pool: normale oppure attenzione con la parola (codice Synology o testo QNAP). */
export function statoStorage(valore: string | null | undefined, vendor: VendorNas): { ok: boolean; testo: string } | null {
  const v = (valore ?? "").trim();
  if (v === "") return null;
  if (/^\d+$/.test(v) && vendor === "synology") return { ok: v === "1", testo: SYNO_RAID[v] ?? `in corso (${v})` };
  if (OK_TESTO.test(v)) return { ok: true, testo: v.toLowerCase() === "ready" ? "pronto" : "normale" };
  return { ok: false, testo: v.toLowerCase() };
}

export type VoceSpazio = {
  nome: string;
  totaleGb: number | null;
  usatoGb: number | null;
  /** 0-100; null se non si può calcolare. */
  percento: number | null;
  stato: { ok: boolean; testo: string } | null;
  raid: string | null;
};

const perc = (usato: number | null, totale: number | null): number | null =>
  usato != null && totale != null && totale > 0 ? Math.max(0, Math.min(100, (usato / totale) * 100)) : null;

const num = (x: number | null | undefined): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** I volumi (QNAP: volumes_snmp); i pool (Synology: storage_pools, QNAP QTS 5 non li dà); i gruppi RAID come ripiego. */
export function volumiNas(nas: NasInventorySnapshot): VoceSpazio[] {
  const s = nas.snmp;
  if (!s) return [];
  return (s.volumes_snmp ?? []).map((v) => {
    const totale = num(v.size_gb);
    const libero = num(v.free_gb);
    const usato = totale != null && libero != null ? Math.max(0, totale - libero) : null;
    return { nome: v.name ?? "volume", totaleGb: totale, usatoGb: usato, percento: perc(usato, totale), stato: statoStorage(v.status, nas.vendor), raid: v.raid_type ?? null };
  });
}

export function poolNas(nas: NasInventorySnapshot): VoceSpazio[] {
  const s = nas.snmp;
  if (!s) return [];
  return (s.storage_pools ?? []).map((p) => {
    const totale = num(p.total_gb);
    const usato = num(p.used_gb);
    return { nome: p.name ?? "pool", totaleGb: totale, usatoGb: usato, percento: perc(usato, totale), stato: statoStorage(p.status, nas.vendor), raid: null };
  });
}

export function gruppiRaidNas(nas: NasInventorySnapshot): VoceSpazio[] {
  const s = nas.snmp;
  if (!s) return [];
  return (s.raids ?? []).map((r) => {
    const totale = num(r.total_gb);
    const libero = num(r.free_gb);
    const usato = totale != null && libero != null ? Math.max(0, totale - libero) : null;
    return { nome: r.name ?? "RAID", totaleGb: totale, usatoGb: usato, percento: perc(usato, totale), stato: statoStorage(r.status, nas.vendor), raid: null };
  });
}

/**
 * Spazio totale e usato: dai pool se ci sono, altrimenti dai volumi, altrimenti dai gruppi RAID (mai somme
 * incrociate: pool e volumi descrivono gli stessi dischi). Null se nessuna fonte ha totale e usato.
 */
export function spazioTotale(nas: NasInventorySnapshot): { totaleGb: number; usatoGb: number; percento: number; fonte: "pool" | "volumi" | "raid" } | null {
  const fonti: Array<["pool" | "volumi" | "raid", VoceSpazio[]]> = [["pool", poolNas(nas)], ["volumi", volumiNas(nas)], ["raid", gruppiRaidNas(nas)]];
  for (const [fonte, voci] of fonti) {
    const buone = voci.filter((v) => v.totaleGb != null && v.usatoGb != null);
    if (buone.length === 0) continue;
    const totaleGb = buone.reduce((a, v) => a + (v.totaleGb as number), 0);
    const usatoGb = buone.reduce((a, v) => a + (v.usatoGb as number), 0);
    if (totaleGb <= 0) continue;
    return { totaleGb, usatoGb, percento: (usatoGb / totaleGb) * 100, fonte };
  }
  return null;
}

/** md di sistema (firmware, swap): non sono i dati dell'utente. */
const MD_DI_SISTEMA = new Set(["md0", "md1", "md9", "md13", "md256", "md322"]);

/** Livello RAID: dal tipo dei volumi (QNAP) o dalle righe di /proc/mdstat dei dati (SSH). */
export function livelloRaid(nas: NasInventorySnapshot): string | null {
  const dai = [...new Set((nas.snmp?.volumes_snmp ?? []).map((v) => (v.raid_type ?? "").trim()).filter(Boolean))];
  if (dai.length > 0) return dai.join(" · ");
  const md = nas.ssh?.mdstat_summary;
  if (!md) return null;
  const livelli = new Set<string>();
  for (const riga of md.split("\n")) {
    const m = /^(md\d+)\s*:\s*\S+\s+(raid\d+|linear)/i.exec(riga.trim());
    if (m && !MD_DI_SISTEMA.has(m[1])) livelli.add(m[2].toUpperCase().replace(/^RAID(\d)/, "RAID $1"));
  }
  return livelli.size > 0 ? [...livelli].join(" · ") : null;
}

/** Stato complessivo del RAID: attenzione se un gruppo, un pool o un volume non è normale. */
export function statoRaid(nas: NasInventorySnapshot): { ok: boolean; testo: string } | null {
  const tutti = [...gruppiRaidNas(nas), ...poolNas(nas), ...volumiNas(nas)].map((v) => v.stato).filter((x): x is { ok: boolean; testo: string } => x != null);
  if (tutti.length === 0) return null;
  const male = tutti.find((x) => !x.ok);
  return male ?? { ok: true, testo: "normale" };
}

/** «49,6 TB» da GB (1 TB = 1024 GB, come li scrive l'acquisizione). */
export function formattaGb(gb: number): string {
  if (gb >= 1024) return `${(gb / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} TB`;
  return `${gb.toLocaleString("it-IT", { maximumFractionDigits: 0 })} GB`;
}

/** Bit al secondo che l'apparato scrive come stringa («123456») in testo leggibile; il resto resta com'è. */
export function formattaBps(v: string | null | undefined): string {
  const t = (v ?? "").trim();
  if (t === "") return "—";
  if (!/^\d+$/.test(t)) return t;
  const n = parseInt(t, 10);
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toLocaleString("it-IT", { maximumFractionDigits: 1 })} MB/s`;
  if (n >= 1024) return `${(n / 1024).toLocaleString("it-IT", { maximumFractionDigits: 0 })} KB/s`;
  return `${n} B/s`;
}

/** Striscia dei numeri: solo le caselle di cui c'è il dato. */
export function caselleStorage(nas: NasInventorySnapshot, acceso: string | null): Casella[] {
  const caselle: Casella[] = [];
  const spazio = spazioTotale(nas);
  if (spazio) {
    caselle.push({
      etichetta: "Spazio usato",
      valore: `${Math.round(spazio.percento)}%`,
      sotto: `${formattaGb(spazio.usatoGb)} di ${formattaGb(spazio.totaleGb)}`,
      tab: "volumi",
      ...(spazio.percento >= 85 ? { attenzione: true } : {}),
    });
  }
  const al = alloggiamenti(nas.snmp?.disks, nas.vendor);
  const r = riepilogoDischi(al);
  if (r.presenti > 0) {
    caselle.push({
      etichetta: "Dischi",
      valore: r.attenzione > 0 ? `${r.buoni} ✓ · ${r.attenzione}` : `${r.presenti} ✓`,
      // La striscia mette già ▲ davanti al valore in attenzione: il segno del singolo disco sta nella riga sotto.
      ...(r.primoMotivo ? { sotto: `▲ ${r.primoMotivo}`, attenzione: true } : {}),
      tab: "dischi",
    });
  }
  const livello = livelloRaid(nas);
  const sr = statoRaid(nas);
  if (livello || sr) {
    caselle.push({
      etichetta: "RAID",
      valore: livello ?? "RAID",
      sotto: [sr ? `${sr.ok ? "✓" : "▲"} ${sr.testo}` : null, r.presenti > 0 ? `${r.presenti} dischi` : null].filter(Boolean).join(" · "),
      tab: "dischi",
      ...(sr && !sr.ok ? { attenzione: true } : {}),
    });
  }
  const nVol = volumiNas(nas).length || poolNas(nas).length || gruppiRaidNas(nas).length;
  if (nVol > 0) {
    const nPool = poolNas(nas).length;
    caselle.push({ etichetta: "Volumi", valore: String(nVol), ...(nPool > 0 && volumiNas(nas).length > 0 ? { sotto: `${nPool} pool` } : {}), tab: "volumi" });
  }
  const tMax = temperaturaMassimaDischi(nas.snmp?.disks);
  const tSis = nas.snmp?.temperature_c ?? null;
  if (tSis != null || tMax != null) {
    caselle.push({ etichetta: "Temperatura", valore: `${tSis ?? tMax} °C`, ...(tSis != null && tMax != null ? { sotto: `dischi max ${tMax} °C` } : tSis == null ? { sotto: "dischi, max" } : {}) });
  }
  if (acceso) caselle.push({ etichetta: "Acceso da", valore: acceso });
  return caselle;
}

/** Un servizio NAS: attivo, spento o (stato non riconosciuto) col testo com'è. */
export function statoServizio(state: string | null | undefined): { segno: "✓" | "●"; testo: string } {
  const t = (state ?? "").trim();
  if (t === "") return { segno: "●", testo: "stato non noto" };
  if (/^(running|active|ok|enabled|on|started)/i.test(t)) return { segno: "✓", testo: "attivo" };
  if (/^(stopped|inactive|disabled|off|down)/i.test(t)) return { segno: "●", testo: "spento" };
  return { segno: "●", testo: t };
}
