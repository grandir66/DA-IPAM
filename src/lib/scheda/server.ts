/**
 * Pezzi puri della scheda dei server Windows e Linux (21/10): servizi del ruolo e «da guardare», dischi
 * normalizzati (Windows e Linux scrivono `disks` in modo diverso), porte in ascolto, hotfix e le caselle della
 * striscia. Nessun accesso a database né a React: si provano da soli (`__tests__/server.test.ts`).
 *
 * Incidenti evitati: un volume Linux da 56 KB (efivarfs) o da 1 GB arrotondato a 0 libero non deve diventare
 * «disco peggiore al 100%»; un servizio Windows a partenza manuale e fermo non è un guasto.
 */
import type { Casella } from "@/components/scheda/striscia-numeri";
import { accesoDa } from "./panoramica";

export interface ServizioSrv { name?: string; display_name?: string; state?: string; start_mode?: string }
export interface DiscoGrezzo { device?: string; size_gb?: number; free_gb?: number; filesystem?: string; label?: string; mountpoint?: string }
export interface PortaGrezza { protocol?: string; port?: number; process?: string; bind_address?: string }

const it1 = (n: number): string => n.toLocaleString("it-IT", { maximumFractionDigits: 1 });

// ─── Servizi ──────────────────────────────────────────────────────────────

export type LivelloServizio = "ok" | "guasto" | "attenzione" | "neutro";
export interface EsitoServizio { segno: "✓" | "✕" | "▲" | "●"; testo: string; livello: LivelloServizio }

/** Partenza automatica (Windows: «Auto», «Automatic (Delayed Start)»). Su Linux `start_mode` non c'è: false. */
export function eAutomatico(s: ServizioSrv): boolean {
  return /^auto/i.test((s.start_mode ?? "").trim());
}

/** Stato di un servizio con segno e parola. Un servizio manuale fermo è neutro: non è un guasto. */
export function esitoServizio(s: ServizioSrv): EsitoServizio {
  const stato = (s.state ?? "").trim().toLowerCase();
  if (stato === "running" || stato === "active" || stato === "started") return { segno: "✓", testo: "attivo", livello: "ok" };
  if (stato === "failed") return { segno: "✕", testo: "fallito", livello: "guasto" };
  if (stato === "stopped") {
    return eAutomatico(s)
      ? { segno: "✕", testo: "fermo", livello: "guasto" }
      : { segno: "●", testo: "fermo", livello: "neutro" };
  }
  if (stato === "inactive" || stato === "dead" || stato === "exited") return { segno: "●", testo: "inattivo", livello: "neutro" };
  if (/pending|activating|deactivating|paused|reload/.test(stato)) return { segno: "▲", testo: stato, livello: "attenzione" };
  return { segno: "●", testo: stato || "stato non letto", livello: "neutro" };
}

const PESO: Record<LivelloServizio, number> = { guasto: 0, attenzione: 1, neutro: 2, ok: 3 };
const perNome = (a: ServizioSrv, b: ServizioSrv): number => (a.name ?? "").localeCompare(b.name ?? "", "it", { sensitivity: "base" });

/**
 * «Da guardare»: gli automatici che non girano (Windows) e i falliti (Linux). I manuali fermi no.
 * Prima i guasti, poi le attese, per nome.
 */
export function serviziDaGuardare(servizi: ServizioSrv[]): ServizioSrv[] {
  return servizi
    .filter((s) => {
      const e = esitoServizio(s);
      if (e.livello === "ok") return false;
      return (eAutomatico(s) && e.livello !== "neutro") || (s.state ?? "").trim().toLowerCase() === "failed";
    })
    .sort((a, b) => PESO[esitoServizio(a).livello] - PESO[esitoServizio(b).livello] || perNome(a, b));
}

/** Servizi che appartengono a un ruolo (nome del servizio di sistema). */
const PER_RUOLO: Record<string, RegExp> = {
  dc: /^(ntds|netlogon|kdc|dns|dfsr|adws)$/i,
  dns: /^dns$/i,
  dhcp: /^dhcpserver$/i,
  database: /^(mssql|sqlserveragent|sqlbrowser|sqlwriter|postgresql|mysql|mariadb|mongod)/i,
  web: /^(w3svc|was|iisadmin|nginx|apache2|httpd)$/i,
  mail: /^(msexchange|postfix|dovecot|exim)/i,
  backup: /^(veeam|backupexec|acronis)/i,
  nfs: /^(nfs|rpc-statd|nfsd)/i,
};

/** Il ruolo database si deduce anche dai servizi (MSSQL* esiste solo dove c'è SQL Server), gli altri dal catalogo dei ruoli. */
export function ruoliEffettivi(ruoli: string[], servizi: ServizioSrv[]): string[] {
  const r = new Set(ruoli);
  if (servizi.some((s) => /^mssql/i.test(s.name ?? ""))) r.add("database");
  return [...r];
}

export function serviziDelRuolo(servizi: ServizioSrv[], ruoli: string[]): ServizioSrv[] {
  const attivi = ruoliEffettivi(ruoli, servizi).map((r) => PER_RUOLO[r]).filter((x): x is RegExp => !!x);
  if (attivi.length === 0) return [];
  return servizi.filter((s) => attivi.some((re) => re.test(s.name ?? ""))).sort(perNome);
}

const sistemaNome = (n: string | undefined): string => (n ?? "").toLowerCase().replace(/\.service$/, "");

/** Linux: i servizi il cui nome coincide con un processo che ascolta su una porta («ssh» ↔ «sshd»). */
export function serviziInAscolto(servizi: ServizioSrv[], porte: PortaGrezza[]): ServizioSrv[] {
  const processi = [...new Set(porte.map((p) => sistemaNome(p.process)).filter((p) => p !== ""))];
  if (processi.length === 0) return [];
  return servizi
    .filter((s) => {
      const n = sistemaNome(s.name);
      return n !== "" && processi.some((p) => p === n || p.startsWith(n) || n.startsWith(p));
    })
    .sort(perNome);
}

// ─── Porte in ascolto ─────────────────────────────────────────────────────

export interface GruppoPorte { porte: number[]; processo: string | null; raggio: string }

function raggioDi(bind: string | undefined): "tutte le interfacce" | "solo locale" | string {
  const b = (bind ?? "").trim();
  if (b === "" || b === "0.0.0.0" || b === "::" || b === "*" || b === "[::]") return "tutte le interfacce";
  if (b.startsWith("127.") || b === "::1" || b === "[::1]") return "solo locale";
  return b;
}

/**
 * Porte in ascolto, porta e processo insieme: la stessa porta su IPv4 e IPv6 è una; se un processo ha più porte
 * con lo stesso raggio si raggruppano («1514 · 1515»). Senza il nome del processo ogni porta sta da sola.
 */
export function raggruppaPorte(porte: PortaGrezza[]): GruppoPorte[] {
  const perPorta = new Map<string, { porta: number; processo: string | null; raggio: string }>();
  for (const p of porte) {
    if (typeof p.port !== "number") continue;
    const proto = (p.protocol ?? "tcp").toLowerCase();
    const proc = p.process && p.process.trim() !== "" ? p.process.trim() : null;
    const r = raggioDi(p.bind_address);
    const k = `${proto}:${p.port}`;
    const att = perPorta.get(k);
    // Se la stessa porta è anche su tutte le interfacce, vale quella (è la più esposta).
    if (!att || (r === "tutte le interfacce" && att.raggio !== r)) perPorta.set(k, { porta: p.port, processo: proc ?? att?.processo ?? null, raggio: r });
  }
  const gruppi = new Map<string, GruppoPorte>();
  for (const v of [...perPorta.values()].sort((a, b) => a.porta - b.porta)) {
    const chiave = v.processo ? `${v.processo}|${v.raggio}` : `#${v.porta}|${v.raggio}`;
    const g = gruppi.get(chiave);
    if (g) { if (!g.porte.includes(v.porta)) g.porte.push(v.porta); }
    else gruppi.set(chiave, { porte: [v.porta], processo: v.processo, raggio: v.raggio });
  }
  return [...gruppi.values()].sort((a, b) => a.porte[0] - b.porte[0]);
}

// ─── Dischi ───────────────────────────────────────────────────────────────

/** `piccolo`: sotto 5 GB il libero è arrotondato al GB intero e la percentuale è indicativa (non si segnala come «piena»). */
export interface DiscoSrv { nome: string; etichetta: string | null; totaleGb: number | null; liberoGb: number | null; usatoPct: number | null; rete: boolean; piccolo: boolean }

const UNITA: Record<string, number> = { K: 1 / 1024 / 1024, M: 1 / 1024, G: 1, T: 1024, P: 1024 * 1024 };

/** «292G» → 292; «56K» → 0,00005. Testo che non è una misura → null (su Windows `filesystem` è «NTFS»). */
function gbDaTesto(t: string | undefined): number | null {
  const m = /^([\d.,]+)\s*([KMGTP])i?B?$/i.exec((t ?? "").trim());
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  return Number.isFinite(n) ? n * UNITA[m[2].toUpperCase()] : null;
}

/**
 * Windows scrive `device` («C:»), `size_gb`, `free_gb`; Linux ha il punto di mount in `label` e la dimensione
 * come testo in `filesystem`. I volumi virtuali (sotto 100 MB) non sono dischi e si tolgono.
 */
export function normalizzaDischi(disks: DiscoGrezzo[] | null | undefined): DiscoSrv[] {
  const out: DiscoSrv[] = [];
  for (const d of disks ?? []) {
    const totale = typeof d.size_gb === "number" ? d.size_gb : gbDaTesto(d.filesystem);
    if (totale != null && totale < 0.1) continue;
    const libero = typeof d.free_gb === "number" ? d.free_gb : null;
    const linux = typeof d.size_gb !== "number" && totale != null;
    const nome = (linux ? d.mountpoint ?? d.label : d.device) ?? d.device ?? d.mountpoint ?? "?";
    const rete = /^(\d{1,3}(\.\d{1,3}){3}|[\w.-]+):\//.test(d.device ?? "") || (d.device ?? "").startsWith("//");
    out.push({
      nome,
      etichetta: linux ? null : d.label ?? null,
      totaleGb: totale,
      liberoGb: libero,
      usatoPct: totale != null && totale > 0 && libero != null ? Math.max(0, Math.min(100, Math.round(((totale - libero) / totale) * 100))) : null,
      rete,
      piccolo: totale != null && totale < 5,
    });
  }
  return out;
}

/** Il più pieno fra i dischi locali. Sotto 5 GB il libero è arrotondato al GB intero e il rapporto mente; le condivisioni di rete non sono «il disco del server». */
export function discoPeggiore(dischi: DiscoSrv[]): DiscoSrv | null {
  let peggiore: DiscoSrv | null = null;
  for (const d of dischi) {
    if (d.rete || d.usatoPct == null || d.piccolo) continue;
    if (!peggiore || d.usatoPct > (peggiore.usatoPct ?? -1)) peggiore = d;
  }
  return peggiore;
}

export function testoGb(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 1024 ? `${it1(n / 1024)} TB` : `${it1(n)} GB`;
}

// ─── Memoria, carico, hotfix ──────────────────────────────────────────────

export interface RamSrv { pct: number; usataGb: number; totaleGb: number }
export function ramUsata(di: { ram_total_gb?: number; ram_total_mb?: number; ram_free_mb?: number } | null | undefined): RamSrv | null {
  if (!di) return null;
  const totale = di.ram_total_gb ?? (di.ram_total_mb != null ? di.ram_total_mb / 1024 : null);
  if (totale == null || totale <= 0 || di.ram_free_mb == null) return null;
  const libera = di.ram_free_mb / 1024;
  const usata = Math.max(0, totale - libera);
  return { pct: Math.min(100, Math.round((usata / totale) * 100)), usataGb: usata, totaleGb: totale };
}

/** Primo valore di «0.00, 0.01, 0.05» (carico a 1 minuto). */
export function caricoUnMinuto(load: string | null | undefined): number | null {
  const t = (load ?? "").trim().split(/[\s,]+/)[0];
  const n = Number(t.replace(",", "."));
  return t !== "" && Number.isFinite(n) ? n : null;
}

export interface UltimoHotfix { id: string; quando: string; giorni: number }
/** L'hotfix installato più di recente, con i giorni trascorsi; date illeggibili ignorate. */
export function ultimoHotfix(hotfixes: Array<{ id?: string; installed_on?: string }> | null | undefined, adesso: Date): UltimoHotfix | null {
  let best: { id: string; quando: string; t: number } | null = null;
  for (const h of hotfixes ?? []) {
    const t = Date.parse(h.installed_on ?? "");
    if (!Number.isFinite(t) || !h.id) continue;
    if (!best || t > best.t) best = { id: h.id, quando: h.installed_on as string, t };
  }
  return best ? { id: best.id, quando: best.quando, giorni: Math.max(0, Math.floor((adesso.getTime() - best.t) / 86_400_000)) } : null;
}

// ─── Active Directory ─────────────────────────────────────────────────────

export interface RilievoAd { gravita: string; titolo: string }
export interface GravitaAd { segno: "✕" | "▲" | "●"; testo: string; peso: number }

export function gravitaAd(g: string): GravitaAd {
  switch (g.trim().toLowerCase()) {
    case "critical": case "critico": return { segno: "✕", testo: "critico", peso: 0 };
    case "high": case "alto": return { segno: "✕", testo: "alto", peso: 1 };
    case "medium": case "medio": return { segno: "▲", testo: "medio", peso: 2 };
    case "low": case "basso": return { segno: "●", testo: "basso", peso: 3 };
    default: return { segno: "●", testo: g || "n/d", peso: 4 };
  }
}

export function ordinaRilievi(r: RilievoAd[]): RilievoAd[] {
  return [...r].sort((a, b) => gravitaAd(a.gravita).peso - gravitaAd(b.gravita).peso || a.titolo.localeCompare(b.titolo, "it"));
}

// ─── Caselle della striscia ───────────────────────────────────────────────

/** Il pezzo di `device_info` che serve alle caselle (tipi larghi: si prova con oggetti piccoli). */
export interface InfoSrv {
  pending_updates_count?: number | null;
  installed_hotfixes?: Array<{ id?: string; installed_on?: string }>;
  disks?: DiscoGrezzo[];
  cpu_cores?: number;
  ram_total_gb?: number;
  ram_total_mb?: number;
  ram_free_mb?: number;
  antivirus?: Array<{ name?: string; status?: string } | string>;
  firewall_active?: boolean;
  uptime_days?: number;
  uptime?: string;
  last_boot?: string;
  load_average?: string | null;
  packages_count?: number | null;
  important_services?: ServizioSrv[];
}

const ggMm = (iso: string | undefined): string | null => {
  const t = Date.parse(iso ?? "");
  return Number.isFinite(t) ? new Date(t).toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) : null;
};

/**
 * «Acceso da»: i giorni se la scansione li dà; il testo di `uptime -p` («up 2 weeks, 7 hours, 58 minutes»)
 * si riduce a «14 g» / «7 h» / «58 min», perché in una casella non entra; altro testo resta com'è.
 */
export function uptimeBreve(di: { uptime_days?: number | null; uptime?: string | null } | null | undefined): string | null {
  if (!di) return null;
  if (typeof di.uptime_days === "number" && Number.isFinite(di.uptime_days)) return `${di.uptime_days} g`;
  const t = typeof di.uptime === "string" ? di.uptime.trim() : "";
  if (t === "") return null;
  const n = (re: RegExp): number => Number(re.exec(t)?.[1] ?? 0);
  const giorni = n(/(\d+)\s*week/i) * 7 + n(/(\d+)\s*day/i);
  const ore = n(/(\d+)\s*hour/i);
  const minuti = n(/(\d+)\s*min/i);
  if (!/week|day|hour|min/i.test(t)) return accesoDa(di);
  return giorni > 0 ? `${giorni} g` : ore > 0 ? `${ore} h` : `${minuti} min`;
}

function casellaAcceso(di: InfoSrv | null): Casella | null {
  const acceso = uptimeBreve(di);
  if (!acceso) return null;
  const riavvio = ggMm(di?.last_boot);
  return { etichetta: "Acceso da", valore: acceso, ...(riavvio ? { sotto: `riavvio ${riavvio}` } : {}) };
}

function casellaDisco(di: InfoSrv | null): Casella | null {
  const peggiore = discoPeggiore(normalizzaDischi(di?.disks));
  if (!peggiore || peggiore.usatoPct == null) return null;
  return {
    etichetta: "Disco peggiore",
    valore: `${peggiore.nome} ${peggiore.usatoPct}%`,
    ...(peggiore.totaleGb != null && peggiore.liberoGb != null
      ? { sotto: `${it1(peggiore.totaleGb - peggiore.liberoGb)} di ${it1(peggiore.totaleGb)} GB` } : {}),
    ...(peggiore.usatoPct >= 85 ? { attenzione: true } : {}),
    tab: "sistema",
  };
}

export function caselleWindows(i: { di: InfoSrv | null; ad: { n: number; alti: number; controllo?: string | null } | null; adesso: Date }): Casella[] {
  const { di } = i;
  const c: Casella[] = [];
  const hf = ultimoHotfix(di?.installed_hotfixes, i.adesso);
  if (di?.pending_updates_count != null) {
    const n = di.pending_updates_count;
    c.push({
      etichetta: "Aggiornamenti",
      valore: String(n),
      sotto: `${n === 1 ? "mancante" : "mancanti"}${hf ? ` · ultimo ${hf.giorni} g fa` : ""}`,
      ...(n > 0 ? { attenzione: true } : {}),
      tab: "aggiornamenti",
    });
  } else if (hf) {
    c.push({ etichetta: "Ultimo aggiornamento", valore: `${hf.giorni} g fa`, sotto: hf.id, tab: "aggiornamenti" });
  }
  const disco = casellaDisco(di);
  if (disco) c.push(disco);
  const ram = ramUsata(di);
  const ramTot = di?.ram_total_gb ?? (di?.ram_total_mb != null ? di.ram_total_mb / 1024 : null);
  if (ram) {
    c.push({ etichetta: "RAM", valore: `${ram.pct}%`, sotto: `${it1(ram.usataGb)} di ${it1(ram.totaleGb)} GB${di?.cpu_cores ? ` · ${di.cpu_cores} vCPU` : ""}`, ...(ram.pct >= 90 ? { attenzione: true } : {}), tab: "sistema" });
  } else if (ramTot || di?.cpu_cores) {
    c.push({ etichetta: "CPU · RAM", valore: [di?.cpu_cores ? `${di.cpu_cores} vCPU` : null, ramTot ? `${it1(ramTot)} GB` : null].filter(Boolean).join(" · "), tab: "sistema" });
  }
  const av = (di?.antivirus ?? []).map((a) => (typeof a === "string" ? a : a.name ?? "")).filter((n) => n !== "");
  if (di?.antivirus !== undefined || di?.firewall_active != null) {
    const senzaAv = di?.antivirus !== undefined && av.length === 0;
    c.push({
      etichetta: "Protezione",
      valore: av.length > 0 ? av[0] : senzaAv ? "nessun antivirus" : "antivirus non letto",
      ...(di?.firewall_active == null ? {} : { sotto: `firewall ${di.firewall_active ? "attivo" : "spento"}` }),
      ...(senzaAv || di?.firewall_active === false ? { attenzione: true } : {}),
      tab: "sistema",
    });
  }
  if (i.ad) {
    c.push({
      etichetta: "Active Directory",
      valore: `${i.ad.n} ${i.ad.n === 1 ? "rilievo" : "rilievi"}`,
      sotto: `${i.ad.alti} ${i.ad.alti === 1 ? "alto" : "alti"}${i.ad.controllo ? ` · controllo ${i.ad.controllo}` : ""}`,
      ...(i.ad.n > 0 ? { attenzione: true } : {}),
      tab: "ad",
    });
  }
  const acceso = casellaAcceso(di);
  if (acceso) c.push(acceso);
  return c;
}

export function caselleLinux(i: { di: InfoSrv | null }): Casella[] {
  const { di } = i;
  const c: Casella[] = [];
  const carico = caricoUnMinuto(di?.load_average);
  if (carico != null) {
    const core = di?.cpu_cores;
    c.push({ etichetta: "Carico", valore: carico.toLocaleString("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), ...(core ? { sotto: `${core} vCPU` } : {}), ...(core && carico > core ? { attenzione: true } : {}), tab: "sistema" });
  }
  const ram = ramUsata(di);
  if (ram) c.push({ etichetta: "RAM", valore: `${ram.pct}%`, sotto: `${it1(ram.usataGb)} di ${it1(ram.totaleGb)} GB`, ...(ram.pct >= 90 ? { attenzione: true } : {}), tab: "sistema" });
  const disco = casellaDisco(di);
  if (disco) c.push({ ...disco, etichetta: "Filesystem peggiore" });
  if (di?.pending_updates_count != null) {
    c.push({ etichetta: "Pacchetti", valore: String(di.pending_updates_count), sotto: "da aggiornare", ...(di.pending_updates_count > 0 ? { attenzione: true } : {}), tab: "aggiornamenti" });
  } else if (di?.packages_count) {
    c.push({ etichetta: "Pacchetti", valore: String(di.packages_count), sotto: "installati", tab: "aggiornamenti" });
  }
  const servizi = di?.important_services ?? [];
  if (servizi.length > 0) {
    const falliti = servizi.filter((s) => (s.state ?? "").toLowerCase() === "failed").length;
    c.push({ etichetta: "Servizi falliti", valore: String(falliti), sotto: `su ${servizi.length} letti`, ...(falliti > 0 ? { attenzione: true } : {}), tab: "servizi" });
  }
  const acceso = casellaAcceso(di);
  if (acceso) c.push(acceso);
  return c;
}
