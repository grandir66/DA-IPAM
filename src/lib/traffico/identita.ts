/**
 * Chi è un indirizzo (23/11/2026, tappa 2 dei «dati in più»): il collector legge dalla copia del
 * traffico quale MAC ha quale IP e come l'apparato si presenta (ARP, DHCP, mDNS, NetBIOS, SSDP,
 * LLDP, CDP). Qui IPAM lo tiene, riempie MAC e nome degli host dove mancano e dà due avvisi.
 *
 * Regole da non rompere:
 * - un dato che l'host ha già non si tocca mai: si riempie solo il vuoto (MAC, nome);
 * - lo stesso fatto visto da più collector è una riga per collector: chi legge prende il più recente;
 * - `ip_doppio` vale solo fra due MAC visti in ARP sulla stessa VLAN a pochi minuti l'uno dall'altro:
 *   un indirizzo che cambia padrone col DHCP non è un doppione. I MAC virtuali (VRRP, HSRP) non contano;
 * - `mac_cambiato`, `mac_mai_visto` e `mac_altrove` non correggono l'host: lo dicono e basta. Le scansioni di IPAM restano la fonte del MAC.
 * - `vlan_sbagliata` (tappa 6) guarda solo l'ARP con un tag: un indirizzo che si annuncia su una VLAN diversa da quella
 *   della sua rete censita. Senza tag (VLAN nativa) o in una rete senza VLAN non si dice niente.
 */
import type Database from "better-sqlite3";
import type { AnomaliaNuova } from "./anomalie";
import { isIpInCidr } from "@/lib/utils";
import { macSenzaProduttore } from "@/lib/classification/forma";

export const FONTI_IDENTITA = ["arp", "dhcp", "mdns", "netbios", "ssdp", "lldp", "cdp"] as const;
export type FonteIdentita = (typeof FONTI_IDENTITA)[number];
/** Due MAC per lo stesso IP contano come doppione se visti entro questi secondi. */
export const FINESTRA_DOPPIO_S = 600;
export const GIORNI_IDENTITA = 90;

export interface IdentitaCollector {
  seq: number;
  visto: string;
  mac: string;
  ip: string;
  vlan: number;
  fonte: string;
  nome: string;
  tipo: string;
}

const DATA = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
const MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function identitaValida(r: IdentitaCollector): boolean {
  return (
    !!r && Number.isInteger(r.seq) && typeof r.visto === "string" && DATA.test(r.visto) &&
    typeof r.mac === "string" && MAC.test(r.mac) &&
    typeof r.ip === "string" && (r.ip === "" || IPV4.test(r.ip)) &&
    Number.isInteger(r.vlan) && r.vlan >= 0 && r.vlan <= 4095 &&
    (FONTI_IDENTITA as readonly string[]).includes(r.fonte) &&
    typeof r.nome === "string" && r.nome.length <= 253 && typeof r.tipo === "string" && r.tipo.length <= 200
  );
}

/** VRRP/CARP (00:00:5e:00:01, :02) e HSRP (00:00:0c:07:ac, 00:00:0c:9f:f): un IP con due MAC è il loro mestiere. */
export function macVirtuale(mac: string): boolean {
  const m = mac.toLowerCase();
  return m.startsWith("00:00:5e:00:01:") || m.startsWith("00:00:5e:00:02:") || m.startsWith("00:00:0c:07:ac:") || m.startsWith("00:00:0c:9f:f");
}

const secondi = (data: string): number => Date.parse(`${data.replace(" ", "T")}Z`) / 1000;

/** I tre avvisi di `macCambiati`. */
export type TipoMac = "mac_cambiato" | "mac_mai_visto" | "mac_altrove";
export interface VistaArp { ip: string; mac: string; vlan: number; ultima_vista: string }

/** Gli IP che in ARP hanno due MAC diversi sulla stessa VLAN, visti a pochi minuti l'uno dall'altro. Pura. */
export function ipDoppi(viste: VistaArp[], finestraS = FINESTRA_DOPPIO_S): AnomaliaNuova[] {
  const perIp = new Map<string, Map<string, number>>();
  for (const v of viste) {
    if (!v.ip || macVirtuale(v.mac)) continue;
    const k = `${v.ip}|${v.vlan}`;
    let m = perIp.get(k);
    if (!m) perIp.set(k, (m = new Map()));
    // lo stesso MAC visto da più collector: vale la volta più recente
    m.set(v.mac, Math.max(m.get(v.mac) ?? 0, secondi(v.ultima_vista)));
  }
  const uscite = new Map<string, AnomaliaNuova>();
  for (const [k, m] of perIp) {
    if (m.size < 2) continue;
    const recenti = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const vicini = recenti.filter(([, t]) => recenti[0][1] - t <= finestraS).map(([mac]) => mac).sort();
    if (vicini.length < 2) continue;
    const ip = k.slice(0, k.indexOf("|"));
    uscite.set(ip, { tipo: "ip_doppio", gravita: 3, client: ip, server: "", proto: 0, porta: 0, dettaglio: { mac_a: vicini[0], mac_b: vicini[1], quanti: vicini.length } });
  }
  return [...uscite.values()];
}

/** Stesso produttore vero: le prime tre coppie uguali, e il prefisso dice davvero chi ha fatto la scheda. */
const stessoProduttore = (a: string, b: string): boolean => a.slice(0, 8) === b.slice(0, 8) && !macSenzaProduttore(a);

/**
 * Gli host censiti che in ARP rispondono con un MAC diverso da quello che IPAM conosce. Pura. `viste` ha anche i MAC
 * di prima: conta solo l'ultimo. Regole del 24/11/2026, dagli avvisi veri di due giorni:
 * - il MAC nuovo è censito su un altro indirizzo → `mac_altrove` (un apparato con due indirizzi, o una scheda IPAM sbagliata);
 * - stesso produttore e MAC censito mai visto in ARP su quell'indirizzo → niente: gli switch rispondono col MAC della
 *   gestione. Non vale coi prefissi delle macchine virtuali, che sono gli stessi per tutte (una VM clonata si dice);
 * - MAC censito mai visto su quell'indirizzo → `mac_mai_visto`, anagrafe vecchia; visto e poi sostituito → `mac_cambiato`.
 */
export function macCambiati(viste: VistaArp[], macNoti: Map<string, string>, censitiSu: Map<string, string[]> = new Map()): AnomaliaNuova[] {
  const perIp = new Map<string, VistaArp[]>();
  for (const v of viste) perIp.set(v.ip, [...(perIp.get(v.ip) ?? []), v]);
  const uscite: AnomaliaNuova[] = [];
  for (const [ip, sue] of perIp) {
    const ora = sue.reduce((m, v) => (v.ultima_vista > m.ultima_vista ? v : m)).mac;
    const noto = (macNoti.get(ip) ?? "").toLowerCase();
    if (!noto || noto === ora || macVirtuale(ora) || macVirtuale(noto)) continue;
    const altrove = (censitiSu.get(ora) ?? []).find((x) => x !== ip);
    const maiVisto = !sue.some((v) => v.mac === noto);
    if (!altrove && maiVisto && stessoProduttore(noto, ora)) continue;
    const tipo = altrove ? "mac_altrove" : maiVisto ? "mac_mai_visto" : "mac_cambiato";
    uscite.push({ tipo, gravita: 1, client: ip, server: "", proto: 0, porta: 0, dettaglio: { prima: noto, ora, ...(altrove ? { altrove } : {}) } });
  }
  return uscite;
}

/** Scrive le righe di una pagina: una per (collector, mac, ip, fonte). Un nome già visto non si cancella con un vuoto. */
/** Gli indirizzi visti in ARP con un tag diverso dalla VLAN della rete censita che li contiene. Pura. */
export function vlanSbagliate(viste: { ip: string; mac: string; vlan: number }[], reti: { cidr: string; vlan_id: number }[]): AnomaliaNuova[] {
  const uscite = new Map<string, AnomaliaNuova>();
  for (const v of viste) {
    if (v.vlan <= 0 || uscite.has(v.ip)) continue;
    const rete = reti.find((r) => isIpInCidr(v.ip, r.cidr));
    if (!rete || rete.vlan_id <= 0 || rete.vlan_id === v.vlan) continue;
    uscite.set(v.ip, { tipo: "vlan_sbagliata", gravita: 2, client: v.ip, server: "", proto: 0, porta: 0, dettaglio: { vista: v.vlan, attesa: rete.vlan_id, mac: v.mac, rete: rete.cidr } });
  }
  return [...uscite.values()];
}

export function scriviIdentita(d: Database.Database, collectorId: number, righe: IdentitaCollector[]): void {
  const ins = d.prepare(`
    INSERT INTO traffico_identita (collector_id, mac, ip, fonte, vlan, nome, tipo, prima_vista, ultima_vista) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(collector_id, mac, ip, fonte) DO UPDATE SET
      vlan = excluded.vlan,
      nome = CASE WHEN excluded.nome <> '' THEN excluded.nome ELSE traffico_identita.nome END,
      tipo = CASE WHEN excluded.tipo <> '' THEN excluded.tipo ELSE traffico_identita.tipo END,
      prima_vista = MIN(traffico_identita.prima_vista, excluded.prima_vista),
      ultima_vista = MAX(traffico_identita.ultima_vista, excluded.ultima_vista)`);
  for (const r of righe) ins.run(collectorId, r.mac, r.ip, r.fonte, r.vlan, r.nome, r.tipo, r.visto, r.visto);
}

const aBlocchi = <T,>(tutti: T[], n = 400): T[][] => Array.from({ length: Math.ceil(tutti.length / n) }, (_, i) => tutti.slice(i * n, (i + 1) * n));

/**
 * Riempie MAC e nome degli host dove mancano. Il MAC viene solo da ARP e DHCP (lì è scritto nel
 * messaggio); il nome da DHCP, mDNS e NetBIOS. Un campo già pieno non si tocca, chiunque l'abbia messo.
 */
export function agganciaHost(d: Database.Database, righe: IdentitaCollector[]): { mac: number; nomi: number } {
  const esito = { mac: 0, nomi: 0 };
  const perIp = new Map<string, { mac?: string; nome?: string }>();
  for (const r of righe) {
    if (!r.ip || macVirtuale(r.mac)) continue;
    const v = perIp.get(r.ip) ?? {};
    if (r.fonte === "arp" || r.fonte === "dhcp") v.mac = r.mac;
    if (r.nome && (r.fonte === "dhcp" || r.fonte === "mdns" || r.fonte === "netbios")) v.nome = r.nome;
    perIp.set(r.ip, v);
  }
  const mettiMac = d.prepare("UPDATE hosts SET mac = ? WHERE id = ? AND (mac IS NULL OR mac = '')");
  const mettiNome = d.prepare("UPDATE hosts SET hostname = ?, hostname_source = 'collector' WHERE id = ? AND (hostname IS NULL OR hostname = '') AND (custom_name IS NULL OR custom_name = '')");
  for (const blocco of aBlocchi([...perIp.keys()])) {
    const host = d.prepare(`SELECT id, ip, mac, hostname, custom_name FROM hosts WHERE ip IN (${blocco.map(() => "?").join(",")})`).all(...blocco) as
      { id: number; ip: string; mac: string | null; hostname: string | null; custom_name: string | null }[];
    for (const h of host) {
      const v = perIp.get(h.ip)!;
      if (v.mac && !h.mac) esito.mac += mettiMac.run(v.mac.toUpperCase(), h.id).changes;
      if (v.nome && !h.hostname && !h.custom_name) esito.nomi += mettiNome.run(v.nome, h.id).changes;
    }
  }
  return esito;
}

/** Gli avvisi che le righe appena scritte fanno nascere. `spento(ip, tipo)`: il controllo è spento per la rete di quell'indirizzo. */
export function anomalieIdentita(d: Database.Database, righe: IdentitaCollector[], spento: (ip: string, tipo: "ip_doppio" | TipoMac | "vlan_sbagliata") => boolean): AnomaliaNuova[] {
  const ip = [...new Set(righe.filter((r) => r.fonte === "arp" && r.ip).map((r) => r.ip))];
  const reti = d.prepare("SELECT cidr, vlan_id FROM networks WHERE vlan_id IS NOT NULL AND vlan_id > 0").all() as { cidr: string; vlan_id: number }[];
  const uscite: AnomaliaNuova[] = vlanSbagliate(righe.filter((r) => r.fonte === "arp" && r.ip), reti).filter((a) => !spento(a.client, "vlan_sbagliata"));
  for (const blocco of aBlocchi(ip)) {
    const q = blocco.map(() => "?").join(",");
    const viste = d.prepare(`SELECT ip, mac, vlan, MAX(ultima_vista) AS ultima_vista FROM traffico_identita WHERE fonte = 'arp' AND ip IN (${q}) GROUP BY ip, mac, vlan`).all(...blocco) as VistaArp[];
    const doppi = ipDoppi(viste).filter((a) => !spento(a.client, "ip_doppio"));
    const conDoppio = new Set(doppi.map((a) => a.client));
    const noti = new Map((d.prepare(`SELECT ip, mac FROM hosts WHERE mac IS NOT NULL AND mac <> '' AND ip IN (${q})`).all(...blocco) as { ip: string; mac: string }[]).map((h) => [h.ip, h.mac]));
    const macVisti = [...new Set(viste.map((v) => v.mac))];
    const censitiSu = new Map<string, string[]>();
    for (const gruppo of aBlocchi(macVisti)) {
      const righeMac = d.prepare(`SELECT LOWER(mac) AS mac, ip FROM hosts WHERE LOWER(mac) IN (${gruppo.map(() => "?").join(",")}) ORDER BY ip`).all(...gruppo) as { mac: string; ip: string }[];
      for (const h of righeMac) censitiSu.set(h.mac, [...(censitiSu.get(h.mac) ?? []), h.ip]);
    }
    // un IP conteso fra due MAC è già detto da `ip_doppio`, che è più grave
    const cambiati = macCambiati(viste, noti, censitiSu).filter((a) => !conDoppio.has(a.client) && !spento(a.client, a.tipo as TipoMac));
    uscite.push(...doppi, ...cambiati);
  }
  return uscite;
}

export interface IdentitaDiIp { mac: string; vlan: number; nome: string; tipo: string; fonti: string; prima_vista: string; ultima_vista: string }

/** Cosa il traffico dice di un indirizzo: i MAC che ha avuto (il più recente per primo), coi nomi con cui si è presentato. */
export function identitaDiIp(d: Database.Database, ip: string): IdentitaDiIp[] {
  return d.prepare(`
    SELECT mac, MAX(vlan) AS vlan, MAX(nome) AS nome, MAX(tipo) AS tipo, GROUP_CONCAT(DISTINCT fonte) AS fonti,
           MIN(prima_vista) AS prima_vista, MAX(ultima_vista) AS ultima_vista
    FROM traffico_identita WHERE ip = ? GROUP BY mac ORDER BY ultima_vista DESC LIMIT 20`).all(ip) as IdentitaDiIp[];
}

/**
 * Per gli IP dati, l'host che ha il MAC visto per ultimo con quell'indirizzo (caso 3 del piano: col DHCP un
 * IP cambia padrone, e l'host giusto è quello del MAC, non quello che in IPAM ha ancora quell'IP).
 * Ritorna solo gli IP dove il MAC porta a un host diverso da quello censito su quell'IP, o dove su quell'IP non c'è nessuno.
 */
export function hostPerMacDegliIp(d: Database.Database, ip: string[]): Map<string, { id: number; nome: string | null }> {
  const esito = new Map<string, { id: number; nome: string | null }>();
  for (const blocco of aBlocchi(ip)) {
    const q = blocco.map(() => "?").join(",");
    const righe = d.prepare(`
      SELECT v.ip AS ip, h.id AS id, COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, '')) AS nome
      FROM (SELECT ip, mac, MAX(ultima_vista) AS ultima_vista FROM traffico_identita
            WHERE fonte IN ('arp', 'dhcp') AND ip IN (${q}) GROUP BY ip, mac) v
      JOIN hosts h ON LOWER(h.mac) = v.mac AND h.ip <> v.ip
      WHERE v.ultima_vista = (SELECT MAX(ultima_vista) FROM traffico_identita t WHERE t.ip = v.ip AND t.fonte IN ('arp', 'dhcp'))`).all(...blocco) as
      { ip: string; id: number; nome: string | null }[];
    for (const r of righe) esito.set(r.ip, { id: r.id, nome: r.nome });
  }
  return esito;
}
