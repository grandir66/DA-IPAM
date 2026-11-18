/**
 * Il DNS di Active Directory visto da un host o da un apparato di DA-IPAM (Riccardo, 18/11/2026:
 * «sarebbe bello integrarlo con le modifiche delle voci di subnet e apparati»).
 *
 * Due cose: lo STATO di un IP nel DNS (c'è, manca, è diverso), letto solo dall'archivio e mai dal
 * DC, e due richieste di correzione legate a un IP. Come per `nuova.ts` la richiesta viaggia come
 * id (`host:allinea:<ip>`, `host:togli:<ip>`) e i passi si ricostruiscono QUI dai dati di adesso;
 * poi anteprima, conferma, convalida, registro e annulla sono quelli di ogni correzione. Salvare o
 * eliminare un host non scrive mai sul DC. Va chiamato dentro il contesto del cliente.
 */
import { getAdIntegrations, getHostPerDnsAd, getRecordDnsAd, getStatoDnsAd, getZoneDnsAd } from "@/lib/db-tenant";
import { ETICHETTE_ANOMALIA_DNS, type TipoAnomaliaDns } from "./anomalie";
import { nodoPtr, type Correzione, type PassoDns, type TipoPassoDns } from "./correzioni";
import type { ZonaDns } from "./record";
import { vistaDnsAd, type VistaDnsAd } from "./vista";

export const PREFISSO_HOST = "host:";

/** `ok`: nome e reverse a posto · `manca`: DA-IPAM lo conosce per nome, il DNS no · `diverso`: nel DNS c'è qualcosa che non torna. */
export type StatoDnsHost = "ok" | "manca" | "diverso";

export interface DnsDiHost {
  integrazione: number;
  dominio: string;
  /** Ultima lettura riuscita del DNS: lo stato vale a quell'ora. */
  lettoIl: string | null;
  correzioniAccese: boolean;
  /** `null`: nel DNS non c'è niente su questo IP e niente da segnalare. */
  stato: StatoDnsHost | null;
  nomi: string[];
  reverse: string[];
  anomalie: { tipo: TipoAnomaliaDns; etichetta: string; dettaglio: string }[];
  /** Id della correzione da chiedere, se ce n'è una: porta il DNS al nome che DA-IPAM ha per questo IP. */
  allinea: string | null;
  /** Id della correzione che toglie le voci di questo IP: c'è se nel DNS ha dei record (serve dopo un'eliminazione). */
  togli: string | null;
}

const ETICHETTA = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const corto = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().split(".")[0] ?? "";

/** Le anomalie che «allinea» sa sistemare: il resto (doppioni, alias) si sceglie a mano nella scheda «DNS». */
const ALLINEABILI: ReadonlySet<TipoAnomaliaDns> = new Set(["nome_diverso", "host_senza_nome", "a_senza_ptr", "ptr_altro_nome"]);
/**
 * Più nomi (o più reverse) sullo stesso IP sono spesso voluti (Riccardo, 18/11/2026: «spesso su un IP ci
 * sono diversi record registrati per motivi reali»): per un host non sono un difetto. Restano nella scheda
 * «DNS», dove si scelgono a mano o si segnano «È voluto».
 */
const SOLO_NOTIZIA: ReadonlySet<TipoAnomaliaDns> = new Set(["ip_piu_nomi", "ip_piu_ptr"]);

interface Quadro {
  integrazione: { id: number; domain: string };
  vista: VistaDnsAd;
  zone: ZonaDns[];
  record: ReturnType<typeof getRecordDnsAd>;
  host: ReturnType<typeof getHostPerDnsAd>;
}

/** Le integrazioni che hanno un DNS letto, ognuna col suo quadro: una sola passata, anche per una subnet intera. */
function quadri(soloIntegrazione?: number): Quadro[] {
  const host = getHostPerDnsAd();
  const esce: Quadro[] = [];
  for (const i of getAdIntegrations()) {
    if (soloIntegrazione !== undefined && i.id !== soloIntegrazione) continue;
    const zone = getZoneDnsAd(i.id).map((z) => ({ nome: z.nome, inversa: z.inversa === 1, partizione: z.partizione as ZonaDns["partizione"] }));
    if (zone.length === 0) continue;
    esce.push({ integrazione: { id: i.id, domain: (i.domain ?? "").toLowerCase() }, vista: vistaDnsAd(i.id), zone, record: getRecordDnsAd(i.id), host });
  }
  return esce;
}

function ordinati(passi: PassoDns[]): PassoDns[] {
  const visti = new Set<string>();
  const unici = passi.filter((p) => {
    const k = `${p.azione}|${p.zona}|${p.nome}|${p.tipo}|${p.dato}`;
    if (visti.has(k)) return false;
    visti.add(k);
    return true;
  });
  // Prima gli «aggiungi»; fra i «togli» prima i reverse (il DNS di Windows, tolto un A, toglie da solo il suo PTR).
  const togli = unici.filter((p) => p.azione === "togli");
  return [...unici.filter((p) => p.azione === "aggiungi"), ...togli.filter((p) => p.tipo === "PTR"), ...togli.filter((p) => p.tipo !== "PTR")];
}

const togliVoce = (v: { zona: string; nome: string; tipo: string; dato: string }): PassoDns => ({ azione: "togli", zona: v.zona, nome: v.nome, tipo: v.tipo as TipoPassoDns, dato: v.dato });

/** I passi che portano il DNS al nome che DA-IPAM ha per quell'IP. Vuoto = niente da fare (o niente che si possa fare). */
function passiAllinea(q: Quadro, ip: string): PassoDns[] {
  // Con più nomi sull'IP la rinomina non toglie niente: il nome di DA-IPAM si aggiunge, gli altri restano.
  const piuNomi = new Set(q.record.filter((r) => r.tipo === "A" && r.dato === ip).map((r) => r.fqdn)).size > 1;
  const passi = q.vista.anomalie
    .filter((a) => a.ip === ip && ALLINEABILI.has(a.tipo))
    .flatMap((a) => a.correzioni.flatMap((c) => c.passi).filter((p) => !(piuNomi && a.tipo === "nome_diverso" && p.azione === "togli")));
  if (passi.length > 0) return ordinati(passi);

  // L'host ha cambiato IP: il suo nome nel DNS punta ancora al vecchio. Si aggiunge sul nuovo; il vecchio
  // si toglie solo se a quell'indirizzo DA-IPAM non ha più nessuno (potrebbe essere ormai di un altro host).
  // In quel caso lo seguono anche gli altri nomi e i reverse registrati sul vecchio indirizzo.
  const nome = corto(q.host.find((h) => h.ip === ip)?.hostname);
  const zona = q.integrazione.domain;
  if (!ETICHETTA.test(nome) || !q.zone.some((z) => !z.inversa && z.nome === zona)) return [];
  const fqdn = `${nome}.${zona}`;
  const vecchi = q.record.filter((r) => r.tipo === "A" && r.fqdn === fqdn && r.dato !== ip);
  if (vecchi.length === 0 || q.record.some((r) => r.tipo === "A" && r.fqdn === fqdn && r.dato === ip)) return [];
  const inverso = nodoPtr(ip, q.zone);
  const esce: PassoDns[] = [{ azione: "aggiungi", zona, nome, tipo: "A", dato: ip }];
  if (inverso && !q.record.some((r) => r.tipo === "PTR" && r.ip === ip)) esce.push({ azione: "aggiungi", zona: inverso.zona, nome: inverso.nome, tipo: "PTR", dato: fqdn });
  for (const v of vecchi) {
    if (q.host.some((h) => h.ip === v.dato)) continue;
    const ptrVecchi = q.record.filter((r) => r.tipo === "PTR" && r.ip === v.dato);
    for (const c of q.record.filter((r) => r.tipo === "A" && r.dato === v.dato && r.fqdn !== fqdn)) {
      esce.push({ azione: "aggiungi", zona: c.zona, nome: c.nome, tipo: "A", dato: ip }, togliVoce(c));
    }
    for (const p of ptrVecchi) {
      if (inverso && p.dato !== fqdn) esce.push({ azione: "aggiungi", zona: inverso.zona, nome: inverso.nome, tipo: "PTR", dato: p.dato });
      esce.push(togliVoce(p));
    }
    esce.push(togliVoce(v));
  }
  return ordinati(esce);
}

/** I record A e PTR di quell'IP, da togliere. Solo se in DA-IPAM a quell'indirizzo non c'è più nessuno. */
function passiTogli(q: Quadro, ip: string): PassoDns[] {
  if (q.host.some((h) => h.ip === ip)) return [];
  return ordinati(q.record.filter((r) => (r.tipo === "A" && r.dato === ip) || (r.tipo === "PTR" && r.ip === ip)).map(togliVoce));
}

function diUnIp(q: Quadro, ip: string): DnsDiHost {
  const nomi = q.record.filter((r) => r.tipo === "A" && r.dato === ip).map((r) => r.fqdn);
  const reverse = q.record.filter((r) => r.tipo === "PTR" && r.ip === ip).map((r) => r.dato);
  const anomalie = q.vista.anomalie.filter((a) => a.ip === ip && !SOLO_NOTIZIA.has(a.tipo));
  // Il nome dell'host nel DNS c'è, ma su un altro indirizzo: non «manca», è rimasto indietro dopo un cambio di IP.
  const nomeHost = corto(q.host.find((h) => h.ip === ip)?.hostname);
  const altrove = nomeHost !== "" && nomi.length === 0 && q.record.some((r) => r.tipo === "A" && r.fqdn === `${nomeHost}.${q.integrazione.domain}` && r.dato !== ip);
  const stato: StatoDnsHost | null =
    altrove ? "diverso"
      : anomalie.some((a) => a.tipo === "host_senza_nome") ? "manca"
      : anomalie.length > 0 ? "diverso"
        : nomi.length > 0 || reverse.length > 0 ? "ok" : null;
  return {
    integrazione: q.integrazione.id, dominio: q.integrazione.domain, lettoIl: getStatoDnsAd(q.integrazione.id).letto_il,
    correzioniAccese: q.vista.scrittura.accesa, stato, nomi, reverse,
    anomalie: anomalie.map((a) => ({ tipo: a.tipo, etichetta: ETICHETTE_ANOMALIA_DNS[a.tipo], dettaglio: a.dettaglio })),
    allinea: passiAllinea(q, ip).length > 0 ? `${PREFISSO_HOST}allinea:${ip}` : null,
    togli: nomi.length + reverse.length > 0 ? `${PREFISSO_HOST}togli:${ip}` : null,
  };
}

/** Com'è messo un IP nel DNS, per ogni dominio che ne sa qualcosa. Vuoto: nessun DNS letto, o niente su questo IP. */
export function dnsDiIp(ip: string): DnsDiHost[] {
  if (!IPV4.test(ip)) return [];
  return quadri().map((q) => diUnIp(q, ip)).filter((d) => d.stato !== null);
}

/** Lo stato di tanti IP in una passata sola (tabella di una subnet). Con più domini vale il peggiore. */
export function statoDnsDi(ips: readonly string[]): Record<string, StatoDnsHost> {
  const peso: Record<StatoDnsHost, number> = { ok: 0, manca: 1, diverso: 2 };
  const esce: Record<string, StatoDnsHost> = {};
  for (const q of quadri()) {
    for (const ip of ips) {
      const s = diUnIp(q, ip).stato;
      if (s && (!esce[ip] || peso[s] > peso[esce[ip]])) esce[ip] = s;
    }
  }
  return esce;
}

export type EsitoCorrezioneHost = { ok: true; correzione: Correzione } | { ok: false; motivo: string };

/** `host:allinea:<ip>` · `host:togli:<ip>`: i passi si rifanno dai dati di adesso, mai da quello che manda il browser. */
export function correzioneHostDa(id: string, integrationId: number): EsitoCorrezioneHost {
  const [, azione, ip, ...resto] = id.split(":");
  if (!id.startsWith(PREFISSO_HOST) || resto.length > 0 || !ip || !IPV4.test(ip)) return { ok: false, motivo: "Richiesta non leggibile" };
  const q = quadri(integrationId)[0];
  if (!q) return { ok: false, motivo: "Il DNS di questo dominio non è ancora stato letto" };
  if (azione === "allinea") {
    const passi = passiAllinea(q, ip);
    if (passi.length === 0) return { ok: false, motivo: "Per questo indirizzo non c'è niente da allineare: il DNS è cambiato, ricarica" };
    return { ok: true, correzione: { id, chiaveAnomalia: id, titolo: `Allinea il DNS a DA-IPAM per ${ip}`, passi, toglieDati: passi.some((p) => p.azione === "togli") } };
  }
  if (azione === "togli") {
    if (q.host.some((h) => h.ip === ip)) return { ok: false, motivo: "In DA-IPAM a questo indirizzo c'è ancora un host: le sue voci non si tolgono da qui" };
    const passi = passiTogli(q, ip);
    if (passi.length === 0) return { ok: false, motivo: "Nel DNS non ci sono voci per questo indirizzo" };
    return { ok: true, correzione: { id, chiaveAnomalia: id, titolo: `Togli dal DNS le voci di ${ip}`, passi, toglieDati: true } };
  }
  return { ok: false, motivo: "Richiesta non prevista" };
}
