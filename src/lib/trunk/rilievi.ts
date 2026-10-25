/**
 * Rilievi di sicurezza della rete osservata (25/10/2026, fase 1 della valutazione
 * `analisi/2026-10-25-sonda-passiva-sicurezza.html`).
 *
 * Il sensore trunk registra fatti (chi ha parlato, dove, quando); qui DA-IPAM li
 * giudica confrontandoli con l'inventario, le reti e le sorgenti DHCP note.
 * `calcolaRilievi` è una funzione pura (si prova senza DB); `valutaRilievi` legge
 * il DB del tenant, calcola e aggiorna `rete_rilievi` dopo ogni lettura del sensore.
 *
 * Solo ciò che il trunk vede davvero: broadcast, multicast e ARP. Niente contenuti.
 */

import { getCurrentTenantCode, getTenantDb } from "@/lib/db-tenant";
import { assicuraColonnaServerDhcpTrunk } from "@/lib/db-tenant-schema";
import { isIpInCidr, macToHex } from "@/lib/utils";
import { lookupVendorSync } from "@/lib/scanner/mac-vendor";
import { TIPI_RILIEVO, type CategoriaRilievo, type GravitaRilievo, type TipoRilievo } from "@/lib/trunk/rilievi-tipi";

export { TIPI_RILIEVO, type CategoriaRilievo, type GravitaRilievo, type TipoRilievo };

export const FONTE_TRUNK = "sensore-trunk";

export interface OsservazionePerRegole {
  vid: number;
  mac: string;
  ip: string;
  nome: string | null;
  protocolli: string[];
  prima_vista: string;
  ultima_vista: string;
}

export interface VlanPerRegole {
  vid: number;
  vista: boolean;
  dichiarata: boolean;
  reti: Array<{ cidr: string; gateway_ip?: string | null; fonte?: string | null }>;
  server_dhcp: Array<{ mac: string; ip: string; ultima_vista: string | null }>;
}

export interface VicinoPerRegole {
  protocollo: string;
  sistema: string;
  porta: string;
  vid: number;
  indirizzo: string | null;
  vlan_nativa: number | null;
  ultima_vista: string;
}

export interface IngressoRegole {
  adesso: Date;
  osservazioni: OsservazionePerRegole[];
  vlan: VlanPerRegole[];
  vicini: VicinoPerRegole[];
  /** MAC in inventario (host e apparati fisici), in forma esadecimale maiuscola senza separatori. */
  macInventario: Set<string>;
  /** IP dei server DHCP noti: sorgenti DHCP e apparati di rete censiti. */
  serverDhcpNoti: Set<string>;
  retiIpam: Array<{ cidr: string; vlan_id: number | null; gateway: string | null }>;
}

export interface Rilievo {
  chiave: string;
  tipo: TipoRilievo;
  categoria: CategoriaRilievo;
  gravita: GravitaRilievo;
  vid: number | null;
  mac: string | null;
  ip: string | null;
  descrizione: string;
  dettaglio: Record<string, unknown>;
  prima_vista: string | null;
  ultima_vista: string | null;
}

/** Si giudica solo ciò che si è visto di recente: le osservazioni restano in tabella per settimane. */
const FINESTRA_GIORNI = 30;
/** Due MAC sullo stesso IP «insieme»: viste a meno di un'ora l'una dall'altra, nell'ultimo giorno. */
const CONTESO_ENTRO_MS = 60 * 60 * 1000;
const CONTESO_RECENTE_MS = 24 * 60 * 60 * 1000;
const NUOVO_GIORNI = 7;

/** MAC virtuali dei gateway ridondanti (VRRP, HSRP, GLBP): condividono l'IP per mestiere. */
const PREFISSI_MAC_VIRTUALI = ["00005E0001", "00005E0002", "00000C07AC", "00000C9FF", "0007B400"];

const nomeVlan = (vid: number) => (vid === 0 ? "nativa" : `VLAN ${vid}`);

function ms(iso: string | null | undefined): number {
  if (!iso) return Number.NaN;
  return Date.parse(iso.endsWith("Z") || iso.includes("+") ? iso : `${iso}Z`);
}

function macVirtuale(mac: string): boolean {
  const h = macToHex(mac);
  return PREFISSI_MAC_VIRTUALI.some((p) => h.startsWith(p));
}

/** Bit «amministrato localmente»: i telefoni e i portatili moderni cambiano MAC per privacy. */
export function macCasuale(mac: string): boolean {
  const h = macToHex(mac);
  return (Number.parseInt(h.slice(0, 2), 16) & 0x02) === 0x02;
}

const minIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a < b ? a : b);
const maxIso = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);

export function calcolaRilievi(x: IngressoRegole): Rilievo[] {
  const ora = x.adesso.getTime();
  const recenti = x.osservazioni.filter((o) => ora - ms(o.ultima_vista) <= FINESTRA_GIORNI * 86_400_000);
  const out: Rilievo[] = [];
  const crea = (r: Omit<Rilievo, "categoria">) => out.push({ ...r, categoria: TIPI_RILIEVO[r.tipo].categoria });

  // Gateway noti, per VLAN e in tutto: DHCP del sensore, reti in DA-IPAM.
  const gatewayPerVid = new Map<number, Set<string>>();
  const tuttiGateway = new Set<string>();
  for (const v of x.vlan) {
    const g = new Set<string>();
    for (const r of v.reti) if (r.gateway_ip) g.add(r.gateway_ip);
    gatewayPerVid.set(v.vid, g);
    for (const ip of g) tuttiGateway.add(ip);
  }
  for (const n of x.retiIpam) if (n.gateway) tuttiGateway.add(n.gateway);
  const eGateway = (vid: number, ip: string) =>
    gatewayPerVid.get(vid)?.has(ip) || x.retiIpam.some((n) => n.gateway === ip && isIpInCidr(ip, n.cidr));
  const macGateway = new Set(recenti.filter((o) => o.ip && tuttiGateway.has(o.ip)).map((o) => macToHex(o.mac)));

  // 1. Server DHCP non previsti.
  for (const v of x.vlan) {
    const server = v.server_dhcp.filter((s) => !s.ultima_vista || ora - ms(s.ultima_vista) <= FINESTRA_GIORNI * 86_400_000);
    const macDistinti = new Set(server.map((s) => macToHex(s.mac)));
    for (const s of server) {
      const noto = x.serverDhcpNoti.has(s.ip) || eGateway(v.vid, s.ip);
      if (noto) continue;
      const altri = server.filter((o) => macToHex(o.mac) !== macToHex(s.mac));
      crea({
        chiave: `dhcp_non_previsto|${v.vid}|${macToHex(s.mac)}`,
        tipo: "dhcp_non_previsto",
        gravita: macDistinti.size > 1 ? "alta" : "media",
        vid: v.vid, mac: s.mac, ip: s.ip,
        descrizione: macDistinti.size > 1
          ? `${s.ip} distribuisce indirizzi in ${nomeVlan(v.vid)} insieme ad altri ${altri.length} server`
          : `${s.ip} distribuisce indirizzi in ${nomeVlan(v.vid)} e non è fra le sorgenti DHCP né i gateway noti`,
        dettaglio: { produttore: lookupVendorSync(s.mac), altri_server: altri.map((o) => ({ ip: o.ip, mac: o.mac })) },
        prima_vista: null, ultima_vista: s.ultima_vista,
      });
    }
  }

  // 2. IP contesi: due MAC sullo stesso IP nella stessa VLAN, visti insieme.
  const perIp = new Map<string, OsservazionePerRegole[]>();
  for (const o of recenti) {
    if (!o.ip || macVirtuale(o.mac) || ora - ms(o.ultima_vista) > CONTESO_RECENTE_MS) continue;
    const k = `${o.vid}|${o.ip}`;
    perIp.set(k, [...(perIp.get(k) ?? []), o]);
  }
  for (const [k, righe] of perIp) {
    const perMac = new Map<string, OsservazionePerRegole>();
    for (const r of righe) {
      const h = macToHex(r.mac);
      const prima = perMac.get(h);
      if (!prima || r.ultima_vista > prima.ultima_vista) perMac.set(h, r);
    }
    const macs = [...perMac.values()].sort((a, b) => (a.ultima_vista < b.ultima_vista ? 1 : -1));
    if (macs.length < 2) continue;
    const insieme = macs.filter((m) => Math.abs(ms(m.ultima_vista) - ms(macs[0].ultima_vista)) <= CONTESO_ENTRO_MS);
    if (insieme.length < 2) continue;
    const { vid, ip } = insieme[0];
    const gw = eGateway(vid, ip);
    crea({
      chiave: `ip_conteso|${k}`,
      tipo: "ip_conteso",
      gravita: gw ? "alta" : "media",
      vid, mac: null, ip,
      descrizione: `${gw ? "Il gateway " : ""}${ip} in ${nomeVlan(vid)} risponde da ${insieme.length} schede diverse`,
      dettaglio: { gateway: gw, mac: insieme.map((m) => ({ mac: m.mac, produttore: lookupVendorSync(m.mac), ultima_vista: m.ultima_vista })) },
      prima_vista: insieme.reduce<string | null>((a, m) => minIso(a, m.prima_vista), null),
      ultima_vista: insieme[0].ultima_vista,
    });
  }

  // 3. Indirizzi fuori dalla loro rete: l'IP sta in una rete di un'altra VLAN e non in una della sua.
  const retiDi = new Map<number, string[]>();
  const aggiungiRete = (vid: number, cidr: string) => retiDi.set(vid, [...new Set([...(retiDi.get(vid) ?? []), cidr])]);
  for (const v of x.vlan) for (const r of v.reti) if (r.fonte === "dhcp") aggiungiRete(v.vid, r.cidr);
  for (const n of x.retiIpam) if (n.vlan_id != null) aggiungiRete(n.vlan_id, n.cidr);
  for (const o of recenti) {
    if (!o.ip || macGateway.has(macToHex(o.mac))) continue;
    if ((retiDi.get(o.vid) ?? []).some((c) => isIpInCidr(o.ip, c))) continue;
    const altrove = [...retiDi.entries()].find(([vid, cidr]) => vid !== o.vid && cidr.some((c) => isIpInCidr(o.ip, c)));
    if (!altrove) continue;
    const rete = altrove[1].find((c) => isIpInCidr(o.ip, c)) as string;
    crea({
      chiave: `fuori_rete|${o.vid}|${o.ip}|${macToHex(o.mac)}`,
      tipo: "fuori_rete",
      gravita: "media",
      vid: o.vid, mac: o.mac, ip: o.ip,
      descrizione: `${o.ip} parla in ${nomeVlan(o.vid)} ma appartiene a ${rete} di ${nomeVlan(altrove[0])}`,
      dettaglio: { produttore: lookupVendorSync(o.mac), rete_attesa: rete, vlan_attesa: altrove[0], nome: o.nome },
      prima_vista: o.prima_vista, ultima_vista: o.ultima_vista,
    });
  }

  // 4. LLMNR e NetBIOS: un rilievo per scheda e VLAN.
  const perScheda = new Map<string, OsservazionePerRegole[]>();
  for (const o of recenti) {
    if (!o.protocolli.some((p) => p === "llmnr" || p === "nbns")) continue;
    const k = `${o.vid}|${macToHex(o.mac)}`;
    perScheda.set(k, [...(perScheda.get(k) ?? []), o]);
  }
  for (const [k, righe] of perScheda) {
    const prot = new Set(righe.flatMap((r) => r.protocolli).filter((p) => p === "llmnr" || p === "nbns"));
    const ultima = righe.reduce((a, r) => (r.ultima_vista > a.ultima_vista ? r : a));
    const ip = righe.filter((r) => r.ip).reduce<OsservazionePerRegole | null>((a, r) => (!a || r.ultima_vista > a.ultima_vista ? r : a), null)?.ip ?? null;
    const nome = righe.find((r) => r.nome)?.nome ?? null;
    const usa = [prot.has("llmnr") && "LLMNR", prot.has("nbns") && "NetBIOS"].filter(Boolean).join(" e ");
    crea({
      chiave: `nomi_insicuri|${k}`,
      tipo: "nomi_insicuri",
      gravita: "media",
      vid: ultima.vid, mac: ultima.mac, ip,
      descrizione: `${nome ?? ip ?? ultima.mac} usa ${usa} per trovare i nomi`,
      dettaglio: { protocolli: [...prot], nome, produttore: lookupVendorSync(ultima.mac) },
      prima_vista: righe.reduce<string | null>((a, r) => minIso(a, r.prima_vista), null),
      ultima_vista: ultima.ultima_vista,
    });
  }

  // 5 e 7. Per MAC: in più VLAN, non in inventario.
  const perMac = new Map<string, OsservazionePerRegole[]>();
  for (const o of recenti) {
    const h = macToHex(o.mac);
    perMac.set(h, [...(perMac.get(h) ?? []), o]);
  }
  for (const [h, righe] of perMac) {
    const mac = righe[0].mac;
    const vids = [...new Set(righe.map((r) => r.vid))].sort((a, b) => a - b);
    const prima = righe.reduce<string | null>((a, r) => minIso(a, r.prima_vista), null);
    const ultima = righe.reduce<string | null>((a, r) => maxIso(a, r.ultima_vista), null);
    const ip = righe.find((r) => r.ip)?.ip ?? null;
    const nome = righe.find((r) => r.nome)?.nome ?? null;
    if (vids.length > 1 && !macGateway.has(h) && !macCasuale(mac)) {
      crea({
        chiave: `piu_vlan|${h}`,
        tipo: "piu_vlan",
        gravita: "bassa",
        vid: null, mac, ip,
        descrizione: `${nome ?? mac} è visto in ${vids.length} VLAN: ${vids.map(nomeVlan).join(", ")}`,
        dettaglio: { vlan: vids, nome, produttore: lookupVendorSync(mac) },
        prima_vista: prima, ultima_vista: ultima,
      });
    }
    if (!x.macInventario.has(h)) {
      const nuovo = !!prima && ora - ms(prima) <= NUOVO_GIORNI * 86_400_000;
      const casuale = macCasuale(mac);
      crea({
        chiave: `non_in_inventario|${h}`,
        tipo: "non_in_inventario",
        gravita: casuale ? "bassa" : nuovo ? "media" : "bassa",
        vid: vids[0] ?? null, mac, ip,
        descrizione: `${nome ?? ip ?? mac}${casuale ? " (MAC casuale: telefono o portatile)" : ""} non è in inventario`,
        dettaglio: { nuovo, casuale, vlan: vids, nome, produttore: lookupVendorSync(mac) },
        prima_vista: prima, ultima_vista: ultima,
      });
    }
  }

  // 6. Switch che si annunciano.
  for (const v of x.vicini) {
    if (ora - ms(v.ultima_vista) > FINESTRA_GIORNI * 86_400_000) continue;
    crea({
      chiave: `vicino_esposto|${v.protocollo}|${v.sistema}|${v.porta}`,
      tipo: "vicino_esposto",
      gravita: "bassa",
      vid: v.vid, mac: null, ip: v.indirizzo,
      descrizione: `${v.sistema} annuncia con ${v.protocollo.toUpperCase()} la porta ${v.porta}${v.indirizzo ? ` e l'IP di gestione ${v.indirizzo}` : ""}`,
      dettaglio: { protocollo: v.protocollo, sistema: v.sistema, porta: v.porta, vlan_nativa: v.vlan_nativa },
      prima_vista: null, ultima_vista: v.ultima_vista,
    });
  }

  // 8. VLAN che passano sul trunk senza una rete in DA-IPAM né dichiarate al sensore.
  const vidIpam = new Set(x.retiIpam.map((n) => n.vlan_id).filter((v): v is number => v != null));
  for (const v of x.vlan) {
    if (!v.vista || v.dichiarata || v.vid === 0 || vidIpam.has(v.vid)) continue;
    crea({
      chiave: `vlan_inattesa|${v.vid}`,
      tipo: "vlan_inattesa",
      gravita: "media",
      vid: v.vid, mac: null, ip: null,
      descrizione: `La VLAN ${v.vid} passa sul trunk ma non ha una rete in DA-IPAM`,
      dettaglio: { reti: v.reti.map((r) => r.cidr) },
      prima_vista: null, ultima_vista: null,
    });
  }

  return out;
}

// --- DB del tenant ----------------------------------------------------------

function db() {
  return getTenantDb(getCurrentTenantCode() ?? "DEFAULT");
}

function elencoJson<T>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/** Raccoglie i fatti dal DB del tenant e li passa alle regole. */
export function ingressoDalDb(adesso = new Date()): IngressoRegole {
  const d = db();
  assicuraColonnaServerDhcpTrunk(d);
  const osservazioni = (d.prepare(
    "SELECT vid, mac_display AS mac, ip, nome, protocolli, prima_vista, ultima_vista FROM trunk_osservazioni",
  ).all() as Array<Omit<OsservazionePerRegole, "protocolli"> & { protocolli: string | null }>)
    .map((r) => ({ ...r, protocolli: r.protocolli ? r.protocolli.split(",").filter(Boolean) : [] }));
  const vlan = (d.prepare("SELECT vid, vista, dichiarata, reti, server_dhcp FROM trunk_vlan").all() as Array<{
    vid: number; vista: number; dichiarata: number; reti: string; server_dhcp: string | null;
  }>).map((v) => ({
    vid: v.vid, vista: !!v.vista, dichiarata: !!v.dichiarata,
    reti: elencoJson<VlanPerRegole["reti"][number]>(v.reti),
    server_dhcp: elencoJson<VlanPerRegole["server_dhcp"][number]>(v.server_dhcp),
  }));
  const vicini = d.prepare("SELECT * FROM trunk_vicini").all() as VicinoPerRegole[];
  const macInventario = new Set<string>();
  for (const r of d.prepare(`
    SELECT mac FROM hosts WHERE mac IS NOT NULL AND mac != ''
    UNION SELECT primary_mac FROM physical_devices WHERE primary_mac IS NOT NULL AND primary_mac != ''
  `).all() as Array<{ mac: string }>) {
    macInventario.add(macToHex(r.mac));
  }
  const serverDhcpNoti = new Set<string>();
  for (const r of d.prepare(`
    SELECT nd.host AS ip FROM network_devices nd WHERE nd.host IS NOT NULL AND nd.host != ''
  `).all() as Array<{ ip: string }>) {
    serverDhcpNoti.add(r.ip);
  }
  const retiIpam = d.prepare("SELECT cidr, vlan_id, gateway FROM networks").all() as IngressoRegole["retiIpam"];
  return { adesso, osservazioni, vlan, vicini, macInventario, serverDhcpNoti, retiIpam };
}

/**
 * Calcola e salva (una transazione): aggiorna i rilievi presenti, riapre quelli tornati,
 * chiude quelli spariti. «Preso in carico» non si tocca. Ritorna quanti sono aperti.
 */
export function salvaRilievi(rilievi: Rilievo[], adesso = new Date(), fonte = FONTE_TRUNK): { aperti: number; chiusi: number } {
  const d = db();
  const quando = adesso.toISOString();
  const up = d.prepare(`
    INSERT INTO rete_rilievi (chiave, fonte, tipo, categoria, gravita, vid, mac, ip, descrizione, dettaglio, prima_vista, ultima_vista, rilevato_il, aggiornato_il)
    VALUES (@chiave, @fonte, @tipo, @categoria, @gravita, @vid, @mac, @ip, @descrizione, @dettaglio, @prima_vista, @ultima_vista, @quando, @quando)
    ON CONFLICT(chiave) DO UPDATE SET
      tipo = excluded.tipo, categoria = excluded.categoria, gravita = excluded.gravita,
      vid = excluded.vid, mac = excluded.mac, ip = excluded.ip,
      descrizione = excluded.descrizione, dettaglio = excluded.dettaglio,
      prima_vista = COALESCE(rete_rilievi.prima_vista, excluded.prima_vista),
      ultima_vista = COALESCE(excluded.ultima_vista, rete_rilievi.ultima_vista),
      aggiornato_il = excluded.aggiornato_il,
      chiuso_il = NULL
  `);
  let chiusi = 0;
  d.transaction(() => {
    for (const r of rilievi) {
      up.run({ ...r, fonte, dettaglio: JSON.stringify(r.dettaglio), quando });
    }
    const chiavi = new Set(rilievi.map((r) => r.chiave));
    const aperti = d.prepare("SELECT id, chiave FROM rete_rilievi WHERE fonte = ? AND chiuso_il IS NULL").all(fonte) as Array<{ id: number; chiave: string }>;
    const chiudi = d.prepare("UPDATE rete_rilievi SET chiuso_il = ? WHERE id = ?");
    for (const a of aperti) {
      if (chiavi.has(a.chiave)) continue;
      chiudi.run(quando, a.id);
      chiusi++;
    }
  })();
  return { aperti: rilievi.length, chiusi };
}

/** Dopo ogni lettura del sensore. Un errore qui non deve fermare la lettura. */
export function valutaRilievi(adesso = new Date()): { aperti: number; chiusi: number } | null {
  try {
    return salvaRilievi(calcolaRilievi(ingressoDalDb(adesso)), adesso);
  } catch (e) {
    console.error("[rilievi] calcolo non riuscito:", e instanceof Error ? e.message : e);
    return null;
  }
}

// --- Letture per la pagina ----------------------------------------------------

export interface RilievoRiga {
  id: number;
  fonte: string;
  tipo: TipoRilievo;
  categoria: CategoriaRilievo;
  gravita: GravitaRilievo;
  vid: number | null;
  mac: string | null;
  ip: string | null;
  descrizione: string;
  dettaglio: Record<string, unknown>;
  prima_vista: string | null;
  ultima_vista: string | null;
  rilevato_il: string;
  preso_in_carico: number;
  preso_da: string | null;
  preso_il: string | null;
}

export interface RiepilogoRilievi {
  allarmi: number;
  allarmiAlti: number;
  esposizioni: number;
  novita: number;
  daPrendere: number;
  /** Apparati non in inventario visti per la prima volta negli ultimi 7 giorni. */
  nuovi: number;
  perTipo: Array<{ tipo: TipoRilievo; categoria: CategoriaRilievo; gravita: GravitaRilievo; n: number; daPrendere: number }>;
}

const ORDINE_GRAVITA = "CASE gravita WHEN 'alta' THEN 0 WHEN 'media' THEN 1 ELSE 2 END";
const ORDINE_CATEGORIA = "CASE categoria WHEN 'allarme' THEN 0 WHEN 'esposizione' THEN 1 ELSE 2 END";

export function getRiepilogoRilievi(): RiepilogoRilievi {
  const d = db();
  const righe = d.prepare(`
    SELECT tipo, categoria, MIN(${ORDINE_GRAVITA}) AS g, COUNT(*) AS n, SUM(CASE WHEN preso_in_carico = 0 THEN 1 ELSE 0 END) AS dp
    FROM rete_rilievi WHERE chiuso_il IS NULL GROUP BY tipo, categoria
    ORDER BY ${ORDINE_CATEGORIA}, g, n DESC
  `).all() as Array<{ tipo: TipoRilievo; categoria: CategoriaRilievo; g: number; n: number; dp: number }>;
  const alti = d.prepare(
    "SELECT COUNT(*) AS n FROM rete_rilievi WHERE chiuso_il IS NULL AND categoria = 'allarme' AND gravita = 'alta' AND preso_in_carico = 0",
  ).get() as { n: number };
  const nuovi = d.prepare(
    "SELECT COUNT(*) AS n FROM rete_rilievi WHERE chiuso_il IS NULL AND tipo = 'non_in_inventario' AND json_extract(dettaglio, '$.nuovo') = 1",
  ).get() as { n: number };
  const somma = (c: CategoriaRilievo) => righe.filter((r) => r.categoria === c).reduce((a, r) => a + r.n, 0);
  return {
    allarmi: somma("allarme"),
    allarmiAlti: alti.n,
    esposizioni: somma("esposizione"),
    novita: somma("novita"),
    daPrendere: righe.reduce((a, r) => a + r.dp, 0),
    nuovi: nuovi.n,
    perTipo: righe.map((r) => ({
      tipo: r.tipo, categoria: r.categoria, n: r.n, daPrendere: r.dp,
      gravita: (["alta", "media", "bassa"] as const)[r.g] ?? "bassa",
    })),
  };
}

/** Allarmi gravi aperti e non presi in carico: il numero rosso del menu. */
export function contaAllarmiAlti(): number {
  return (db().prepare(
    "SELECT COUNT(*) AS n FROM rete_rilievi WHERE chiuso_il IS NULL AND categoria = 'allarme' AND gravita = 'alta' AND preso_in_carico = 0",
  ).get() as { n: number }).n;
}

export function getRilieviPaginated(opts: {
  categoria?: CategoriaRilievo | null; tipo?: TipoRilievo | null; vid?: number | null; q?: string;
  daPrendere?: boolean; limit?: number; offset?: number;
}): { righe: RilievoRiga[]; totale: number } {
  const where = ["chiuso_il IS NULL"];
  const par: Array<string | number> = [];
  if (opts.categoria) { where.push("categoria = ?"); par.push(opts.categoria); }
  if (opts.tipo) { where.push("tipo = ?"); par.push(opts.tipo); }
  if (opts.vid != null) { where.push("vid = ?"); par.push(opts.vid); }
  if (opts.daPrendere) where.push("preso_in_carico = 0");
  if (opts.q?.trim()) {
    where.push("(ip LIKE ? OR mac LIKE ? OR descrizione LIKE ?)");
    const like = `%${opts.q.trim()}%`;
    par.push(like, like, like);
  }
  const w = `WHERE ${where.join(" AND ")}`;
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const d = db();
  const totale = (d.prepare(`SELECT COUNT(*) AS n FROM rete_rilievi ${w}`).get(...par) as { n: number }).n;
  const righe = (d.prepare(`
    SELECT id, fonte, tipo, categoria, gravita, vid, mac, ip, descrizione, dettaglio, prima_vista, ultima_vista, rilevato_il, preso_in_carico, preso_da, preso_il
    FROM rete_rilievi ${w}
    ORDER BY preso_in_carico, ${ORDINE_CATEGORIA}, ${ORDINE_GRAVITA}, COALESCE(ultima_vista, rilevato_il) DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(...par, limit, offset) as Array<Omit<RilievoRiga, "dettaglio"> & { dettaglio: string | null }>);
  return {
    righe: righe.map((r) => {
      let dettaglio: Record<string, unknown> = {};
      try {
        const v = r.dettaglio ? (JSON.parse(r.dettaglio) as unknown) : {};
        dettaglio = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
      } catch {
        dettaglio = {};
      }
      return { ...r, dettaglio };
    }),
    totale,
  };
}

/** Per l'elenco degli indirizzi: i rilievi aperti di questi MAC (una query sola). */
export function getTipiRilievoPerMac(macs: string[]): Map<string, TipoRilievo[]> {
  const out = new Map<string, TipoRilievo[]>();
  const unici = [...new Set(macs.filter(Boolean))];
  if (!unici.length) return out;
  const righe = db().prepare(
    `SELECT mac, tipo FROM rete_rilievi WHERE chiuso_il IS NULL AND mac IN (${unici.map(() => "?").join(",")})`,
  ).all(...unici) as Array<{ mac: string; tipo: TipoRilievo }>;
  for (const r of righe) out.set(r.mac, [...new Set([...(out.get(r.mac) ?? []), r.tipo])]);
  return out;
}

/** Prende in carico (o rimette da prendere) un rilievo. Il rilievo resta finché la condizione c'è. */
export function prendiInCarico(id: number, preso: boolean, utente: string): boolean {
  const r = db().prepare(
    "UPDATE rete_rilievi SET preso_in_carico = ?, preso_da = ?, preso_il = ? WHERE id = ?",
  ).run(preso ? 1 : 0, preso ? utente : null, preso ? new Date().toISOString() : null, id);
  return r.changes > 0;
}
