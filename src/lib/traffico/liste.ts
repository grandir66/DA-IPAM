/**
 * Liste di DA-GEO dentro IPAM (24/11/2026, Riccardo: «estendere questa logica … sfruttando lo stesso URL»).
 * DA-GEO pubblica le liste che i firewall dei clienti scaricano: paesi (`geo`), reputazione (Spamhaus e simili) ed
 * eccezioni (`ammessi`). IPAM si registra come un dispositivo qualunque, scarica le SUE liste e le confronta in locale.
 *
 * Regole da non rompere:
 * - verso DA-GEO non parte mai un indirizzo del cliente: si scaricano le liste intere;
 * - il codice del dispositivo sta nel percorso dell'indirizzo: non si scrive mai nei giornali né negli errori;
 * - una lista vale solo se le voci lette sono quante ne dichiara la configurazione; altrimenti si tiene quella di prima;
 * - `geo` dice cosa taglierebbe il firewall, non dove sta una macchina (sono registrazioni, il paese resta DB-IP);
 * - chi sta in una lista `ammessi` non è né compromesso né bloccato: nel firewall le eccezioni passano davanti.
 */
import type Database from "better-sqlite3";
import { decrypt, encrypt } from "@/lib/crypto";
import type { AnomaliaNuova } from "./anomalie";
import { dbTraffico } from "./lettura";

export const URL_DI_SERIE = "https://survey.domarc.it/geo";
export const TIPI_LISTA = ["geo", "reputazione", "ammessi"] as const;
export type TipoLista = (typeof TIPI_LISTA)[number];
/** Oltre questi giorni dalla generazione una lista si dichiara vecchia. */
export const GIORNI_VECCHIA = 7;
const MASSIMO_BYTE = 12 * 1024 * 1024;
const MASSIMO_LISTE = 20;
const NOME = /^[A-Za-z0-9_-]{1,32}$/;
const CODICE = /^[0-9a-f]{32}$/;
const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

export interface ListaDichiarata { nome: string; tipo: TipoLista; titolo: string; fonte: string; voci: number; generato: string; in_errore: boolean }
export interface StatoLista extends ListaDichiarata { scaricata_il: string; vecchia: boolean }
export interface StatoListe { configurato: boolean; url: string; ultimo_giro: string | null; errore: string | null; liste: StatoLista[] }
export interface SegnoLista { nome: string; titolo: string; tipo: TipoLista }

/** `https://host/percorso` senza barra finale. Null se non è https o porta credenziali, parametri o frammenti. */
export function urlListe(testo: string): string | null {
  try {
    const u = new URL(testo.trim());
    if (u.protocol !== "https:" || !u.hostname || u.username || u.password || u.search || u.hash) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}
export const codiceValido = (c: string): boolean => CODICE.test(c);

/** Gli intervalli di una lista `.txt`. Null se una riga non è un prefisso IPv4: un file storto non si usa a metà. Pura. */
export function leggiPrefissi(testo: string): [number, number][] | null {
  const esito: [number, number][] = [];
  for (const riga of testo.split("\n")) {
    const r = riga.trim();
    if (!r || r.startsWith("#")) continue;
    const m = CIDR.exec(r);
    if (!m) return null;
    const ottetti = m.slice(1, 5).map(Number);
    const bit = Number(m[5]);
    if (ottetti.some((o) => o > 255) || bit > 32) return null;
    const quanti = 2 ** (32 - bit);
    const inizio = Math.floor(ottetti.reduce((n, o) => n * 256 + o, 0) / quanti) * quanti;
    esito.push([inizio, inizio + quanti - 1]);
  }
  return esito;
}

/** Le liste dichiarate da `config.json`. Le voci storte fanno rifiutare tutto: meglio le liste di prima. */
export function leggiConfigurazione(corpo: unknown): ListaDichiarata[] | null {
  const c = corpo as { formato?: unknown; liste?: unknown } | null;
  if (!c || c.formato !== 1 || !Array.isArray(c.liste) || c.liste.length > MASSIMO_LISTE) return null;
  const esito: ListaDichiarata[] = [];
  for (const v of c.liste as Record<string, unknown>[]) {
    if (!v || typeof v.nome !== "string" || !NOME.test(v.nome) || !(TIPI_LISTA as readonly unknown[]).includes(v.tipo)
      || !Number.isInteger(v.voci) || (v.voci as number) < 1 || (v.voci as number) > 300_000 || typeof v.generato !== "string") return null;
    esito.push({
      nome: v.nome, tipo: v.tipo as TipoLista, titolo: typeof v.titolo === "string" ? v.titolo.slice(0, 80) : v.nome,
      fonte: typeof v.fonte === "string" ? v.fonte.slice(0, 40) : "", voci: v.voci as number, generato: v.generato.slice(0, 32), in_errore: v.in_errore === true,
    });
  }
  return esito;
}

/** Scarica un testo. Gli errori non contengono mai l'indirizzo, che porta il codice. */
async function scaricaTesto(url: string): Promise<string> {
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: "error", headers: { "User-Agent": "Mozilla/5.0" } });
  } catch {
    throw new Error("DA-GEO non risponde");
  }
  if (r.status === 404) throw new Error("DA-GEO non riconosce il codice, o non lo accetta da questo indirizzo");
  if (!r.ok || !r.body) throw new Error(`DA-GEO risponde ${r.status}`);
  const pezzi: Uint8Array[] = [];
  let letti = 0;
  for await (const p of r.body as unknown as AsyncIterable<Uint8Array>) {
    letti += p.byteLength;
    if (letti > MASSIMO_BYTE) throw new Error("Lista troppo grande");
    pezzi.push(p);
  }
  return Buffer.concat(pezzi).toString("utf8");
}

interface RigaFonte { url: string; codice_enc: string; ultimo_giro: string | null; errore: string | null }
const fonte = (d: Database.Database): RigaFonte | undefined => d.prepare("SELECT url, codice_enc, ultimo_giro, errore FROM traffico_liste_fonte WHERE id = 1").get() as RigaFonte | undefined;

/** Registra (o cambia) l'indirizzo e il codice. Il codice si salva cifrato e non esce più. */
export function impostaFonte(url: string, codice: string): void {
  dbTraffico().prepare(`INSERT INTO traffico_liste_fonte (id, url, codice_enc) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET url = excluded.url, codice_enc = excluded.codice_enc, errore = NULL`).run(url, encrypt(codice));
}

export function togliFonte(): void {
  const d = dbTraffico();
  d.transaction(() => {
    d.prepare("DELETE FROM traffico_liste_reti").run();
    d.prepare("DELETE FROM traffico_liste").run();
    d.prepare("DELETE FROM traffico_liste_fonte").run();
  })();
  memoria.delete(d);
}

/** Le liste dichiarate e il loro contenuto, scaricati e controllati. Non tocca il database: si usa anche per provare un codice. */
export async function scaricaListe(url: string, codice: string): Promise<{ lista: ListaDichiarata; reti: [number, number][] | null }[]> {
  let corpo: unknown = null;
  try {
    corpo = JSON.parse(await scaricaTesto(`${url}/l/${codice}/config.json`));
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("DA-GEO ha risposto qualcosa che non è una configurazione");
    throw e;
  }
  const dichiarate = leggiConfigurazione(corpo);
  if (!dichiarate) throw new Error("Configurazione di DA-GEO non riconosciuta");
  const esito: { lista: ListaDichiarata; reti: [number, number][] | null }[] = [];
  for (const lista of dichiarate) {
    let reti: [number, number][] | null = null;
    try {
      reti = leggiPrefissi(await scaricaTesto(`${url}/l/${codice}/lista/${lista.nome}.txt`));
    } catch {
      reti = null;
    }
    esito.push({ lista, reti: reti && reti.length === lista.voci ? reti : null });
  }
  return esito;
}

/** Il giro: scarica e sostituisce. Una lista non arrivata intera resta com'era; una non più dichiarata si toglie. */
export async function aggiornaListe(adesso: Date = new Date()): Promise<StatoListe> {
  const d = dbTraffico();
  const f = fonte(d);
  if (!f) return statoListe(adesso);
  const quando = adesso.toISOString().slice(0, 19).replace("T", " ");
  try {
    let codice: string;
    try {
      codice = decrypt(f.codice_enc);
    } catch {
      throw new Error("Il codice salvato non si legge: va reinserito");
    }
    const scaricate = await scaricaListe(f.url, codice);
    const saltate = scaricate.filter((s) => s.reti === null).map((s) => s.lista.nome);
    d.transaction(() => {
      const nomi = new Set(scaricate.map((s) => s.lista.nome));
      for (const { nome } of d.prepare("SELECT nome FROM traffico_liste").all() as { nome: string }[]) {
        if (nomi.has(nome)) continue;
        d.prepare("DELETE FROM traffico_liste_reti WHERE lista = ?").run(nome);
        d.prepare("DELETE FROM traffico_liste WHERE nome = ?").run(nome);
      }
      const metti = d.prepare(`INSERT INTO traffico_liste (nome, tipo, titolo, fonte, voci, generato, in_errore, scaricata_il) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(nome) DO UPDATE SET tipo = excluded.tipo, titolo = excluded.titolo, fonte = excluded.fonte, voci = excluded.voci,
          generato = excluded.generato, in_errore = excluded.in_errore, scaricata_il = excluded.scaricata_il`);
      const rete = d.prepare("INSERT OR REPLACE INTO traffico_liste_reti (lista, inizio, fine) VALUES (?, ?, ?)");
      for (const { lista: l, reti } of scaricate) {
        if (!reti) continue;
        metti.run(l.nome, l.tipo, l.titolo, l.fonte, l.voci, l.generato, l.in_errore ? 1 : 0, quando);
        d.prepare("DELETE FROM traffico_liste_reti WHERE lista = ?").run(l.nome);
        for (const [a, b] of reti) rete.run(l.nome, a, b);
      }
      d.prepare("UPDATE traffico_liste_fonte SET ultimo_giro = ?, errore = ? WHERE id = 1").run(quando, saltate.length ? `Liste non arrivate intere, tengo quelle di prima: ${saltate.join(", ")}` : null);
    })();
  } catch (e) {
    d.prepare("UPDATE traffico_liste_fonte SET errore = ? WHERE id = 1").run((e instanceof Error ? e.message : "Errore").slice(0, 200));
  }
  return statoListe(adesso);
}

export function statoListe(adesso: Date = new Date()): StatoListe {
  const d = dbTraffico();
  const f = fonte(d);
  const righe = d.prepare("SELECT nome, tipo, titolo, fonte, voci, generato, in_errore, scaricata_il FROM traffico_liste ORDER BY tipo DESC, nome").all() as (Omit<StatoLista, "in_errore" | "vecchia"> & { in_errore: number })[];
  const limite = adesso.getTime() - GIORNI_VECCHIA * 86_400_000;
  return {
    configurato: f !== undefined, url: f?.url ?? URL_DI_SERIE, ultimo_giro: f?.ultimo_giro ?? null, errore: f?.errore ?? null,
    liste: righe.map((r) => {
      const t = Date.parse(`${r.generato.slice(0, 10)}T${r.generato.slice(11, 16) || "00:00"}:00Z`);
      // una data che non si legge vale come vecchia: una lista senza data è indistinguibile da una morta
      return { ...r, in_errore: r.in_errore === 1, vecchia: !(t >= limite) };
    }),
  };
}

interface Memoria { giro: string; liste: { segno: SegnoLista; inizi: Float64Array; fini: Float64Array }[] }
const memoria = new WeakMap<Database.Database, Memoria>();

function carica(d: Database.Database): Memoria["liste"] {
  const righe = d.prepare("SELECT nome, tipo, titolo, scaricata_il FROM traffico_liste ORDER BY nome").all() as { nome: string; tipo: TipoLista; titolo: string; scaricata_il: string }[];
  const giro = righe.map((r) => `${r.nome}@${r.scaricata_il}`).join("|");
  const m = memoria.get(d);
  if (m && m.giro === giro) return m.liste;
  const q = d.prepare("SELECT inizio, fine FROM traffico_liste_reti WHERE lista = ? ORDER BY inizio");
  const liste = righe.map((r) => {
    const reti = q.all(r.nome) as { inizio: number; fine: number }[];
    return { segno: { nome: r.nome, titolo: r.titolo, tipo: r.tipo }, inizi: Float64Array.from(reti, (x) => x.inizio), fini: Float64Array.from(reti, (x) => x.fine) };
  });
  memoria.set(d, { giro, liste });
  return liste;
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

/** In quali liste sta un indirizzo. Dentro una lista `ammessi` le altre non valgono. Le liste DA-GEO non si sovrappongono al loro interno. */
export function creaCercaListe(d: Database.Database): (ip: string) => SegnoLista[] {
  const liste = carica(d);
  if (liste.length === 0) return () => [];
  return (ip) => {
    if (!IPV4.test(ip)) return [];
    const n = ip.split(".").reduce((a, p) => a * 256 + Number(p), 0);
    const trovate: SegnoLista[] = [];
    for (const l of liste) {
      let a = 0;
      let b = l.inizi.length - 1;
      while (a <= b) {
        const m = (a + b) >> 1;
        if (l.inizi[m] <= n) a = m + 1;
        else b = m - 1;
      }
      if (b >= 0 && l.fini[b] >= n) trovate.push(l.segno);
    }
    const ammesse = trovate.filter((s) => s.tipo === "ammessi");
    return ammesse.length > 0 ? ammesse : trovate;
  };
}

/** Gli host che APRONO una connessione verso un indirizzo di una lista di reputazione. Chi bussa da fuori si vede nella vista, non avvisa. Pura. */
export function versoCompromessi(righe: { interno: string; ip: string; verso: string; proto: number; porta: number }[], cerca: (ip: string) => SegnoLista[]): AnomaliaNuova[] {
  const uscite = new Map<string, AnomaliaNuova>();
  for (const r of righe) {
    if (r.verso !== "fuori") continue;
    const lista = cerca(r.ip).find((s) => s.tipo === "reputazione");
    if (!lista) continue;
    uscite.set(`${r.interno}|${r.ip}|${r.proto}|${r.porta}`, {
      tipo: "indirizzo_compromesso", gravita: 3, client: r.interno, server: r.ip, proto: r.proto, porta: r.porta, dettaglio: { lista: lista.titolo },
    });
  }
  return [...uscite.values()];
}
