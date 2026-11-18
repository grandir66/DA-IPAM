/**
 * Esecuzione delle correzioni al DNS di Active Directory (passo 2, 17/11/2026). Zona rossa: qui
 * si scrive su un apparato del cliente, e solo dopo la conferma di una persona.
 *
 * Per ogni passo, nell'ordine: convalida → rilettura dal DC → riga nel registro (tabella e file)
 * → comando → rilettura → esito. Se il record non è più quello mostrato alla persona il passo si
 * ferma («cambiato»). Se il registro non si scrive, il comando non parte.
 *
 * Tre esiti per ogni comando remoto: riuscito, rifiutato dal DC, non so. Una risposta che non
 * arriva non è un sì: si rilegge il record e vale quello che si trova.
 *
 * Una correzione si ferma al suo primo passo non riuscito (i successivi restano «saltati»); le
 * altre correzioni dello stesso gruppo proseguono, sono indipendenti.
 */
import crypto from "node:crypto";
import {
  apriModificaDnsAd, chiudiModificaDnsAd, getControllerDiDominio, getModificaDnsAd, getRecordDnsAd, getZoneDnsAd, modificaDnsAdGiaAnnullata,
  getCurrentTenantCode, type AdIntegration, type RigaModificaDnsAd,
} from "@/lib/db-tenant";
import { accessoDnsDi, type AccessoDns } from "./accesso";
import { comandoLeggi, comandoPasso, convalidaPasso, leggiEsitoPasso, leggiRisposta, type AmmessiDns, type RecordSulDc } from "./comandi";
import type { Correzione, PassoDns } from "./correzioni";
import { scriviRegistroDns } from "./registro";

export type EsitoDns = "riuscito" | "rifiutato" | "cambiato" | "non_so" | "saltato";

export interface EsitoPasso {
  correzione: string;
  passo: PassoDns;
  esito: EsitoDns;
  messaggio: string | null;
  /** Riga del registro; null se il passo non è arrivato al registro (convalida, rilettura, saltato). */
  modificaId: number | null;
}

/** Lancia un comando PowerShell sul DC e ne ritorna l'uscita. Le prove ne mettono uno finto. */
export type LanciaSulDc = (comando: string) => Promise<string>;

export interface DipendenzeEsecuzione {
  lancia?: LanciaSulDc;
  /** Rilegge tutto il DNS a fine gruppo, per aggiornare archivio e anomalie. */
  rileggi?: (integrazione: AdIntegration) => Promise<unknown>;
  registra?: typeof scriviRegistroDns;
}

/** Zone in archivio e controller di dominio: quello che un passo può e non può toccare. */
export function ammessiDi(integrazione: AdIntegration): AmmessiDns {
  const nomiDc = new Set<string>();
  const ipDc = new Set<string>();
  const dc = integrazione.dc_host.trim().toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(dc)) ipDc.add(dc);
  else if (dc) nomiDc.add(dc.split(".")[0]!);
  for (const c of getControllerDiDominio(integrazione.id)) {
    if (c.nome) nomiDc.add(c.nome);
    if (c.ip) ipDc.add(c.ip);
  }
  // Nome e IP si tirano dietro l'un l'altro dai record in archivio: il DC è protetto anche se AD ne sa solo uno dei due.
  const record = getRecordDnsAd(integrazione.id);
  for (const r of record) {
    if (r.tipo !== "A") continue;
    if (nomiDc.has(r.nome.split(".")[0]!)) ipDc.add(r.dato);
  }
  for (const r of record) {
    if (r.tipo === "A" && ipDc.has(r.dato)) nomiDc.add(r.nome.split(".")[0]!);
  }
  return { zone: new Set(getZoneDnsAd(integrazione.id).map((z) => z.nome)), nomiDc, ipDc };
}

async function lanciatoreVero(integrazione: AdIntegration, accesso: Extract<AccessoDns, { ok: true }>): Promise<LanciaSulDc> {
  const { runWinrmCommand } = await import("@/lib/devices/winrm-run");
  return (comando) => runWinrmCommand(integrazione.dc_host, accesso.port, accesso.username, accesso.password, comando, true, integrazione.domain || undefined, 60_000);
}

const testo = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Legge dal DC i record di un nodo. `null` = non so (rete, tempo scaduto, risposta non leggibile). */
async function leggiDalDc(lancia: LanciaSulDc, p: PassoDns): Promise<{ record: RecordSulDc[] } | { errore: string }> {
  try {
    const r = leggiRisposta(await lancia(comandoLeggi(p.zona, p.nome, p.tipo)));
    return r.ok ? { record: r.record } : { errore: r.motivo };
  } catch (e) {
    return { errore: testo(e) };
  }
}

interface ContestoPasso {
  integrazione: AdIntegration;
  ammessi: AmmessiDns;
  lancia: LanciaSulDc;
  registra: typeof scriviRegistroDns;
  gruppo: string;
  correzione: { id: string; titolo: string };
  utenza: string;
  da: string;
  annullaDi: number | null;
}

async function eseguiPasso(c: ContestoPasso, p: PassoDns): Promise<EsitoPasso> {
  const fuori = (esito: EsitoDns, messaggio: string): EsitoPasso => ({ correzione: c.correzione.id, passo: p, esito, messaggio, modificaId: null });

  const valido = convalidaPasso(p, c.ammessi);
  if (!valido.ok) return fuori("rifiutato", valido.motivo);

  const prima = await leggiDalDc(c.lancia, p);
  if ("errore" in prima) return fuori("non_so", `Il DC non ha risposto alla lettura: ${prima.errore}`);
  const uguali = prima.record.filter((r) => r.dato === p.dato);
  if (p.azione === "togli" && uguali.length !== 1) {
    return fuori("cambiato", uguali.length === 0 ? "Sul DC questo record non c'è più: rileggi il DNS" : "Sul DC questo record è doppio: rileggi il DNS");
  }
  if (p.azione === "aggiungi" && uguali.length > 0) return fuori("cambiato", "Sul DC questo record esiste già: rileggi il DNS");

  // Registro PRIMA del comando. Se lancia, il comando non parte: l'errore sale a chi ha chiamato.
  const recordPrima = p.azione === "togli" ? uguali[0]! : null;
  const comune = { integration_id: c.integrazione.id, gruppo: c.gruppo, correzione: c.correzione.id, titolo: c.correzione.titolo, azione: p.azione, zona: p.zona, nome: p.nome, tipo: p.tipo, dato: p.dato } as const;
  const modificaId = apriModificaDnsAd({ ...comune, prima: recordPrima ? JSON.stringify(recordPrima) : null, utenza: c.utenza, annulla_di: c.annullaDi, da: c.da });
  const riga = (fase: "prima" | "dopo", esito: string, messaggio: string | null) => c.registra({
    fase, tenant: getCurrentTenantCode() ?? null, integrazione: c.integrazione.id, modificaId, gruppo: c.gruppo,
    azione: p.azione, zona: p.zona, nome: p.nome, tipo: p.tipo, dato: p.dato, prima: recordPrima, esito, messaggio, utenza: c.utenza, da: c.da,
  });
  try {
    riga("prima", "in_corso", null);
  } catch (e) {
    chiudiModificaDnsAd(modificaId, "rifiutato", `Registro su file non scrivibile, comando non lanciato: ${testo(e)}`);
    throw new Error(`Registro delle correzioni non scrivibile: nessun comando lanciato (${testo(e)})`);
  }

  let esito: Exclude<EsitoDns, "saltato">;
  let messaggio: string | null = null;
  let risposta: ReturnType<typeof leggiEsitoPasso> | null = null;
  try {
    risposta = leggiEsitoPasso(await c.lancia(comandoPasso(p)));
  } catch (e) {
    messaggio = `Risposta del DC non arrivata: ${testo(e)}`;
  }
  // Rilettura: lo stato vero del record conta più della risposta.
  const dopo = await leggiDalDc(c.lancia, p);
  const presente = "record" in dopo ? dopo.record.some((r) => r.dato === p.dato) : null;
  const voluto = p.azione === "aggiungi";
  if (risposta?.ok) {
    if (presente === null) { esito = "riuscito"; messaggio = "Il DC ha confermato; la rilettura di controllo non è riuscita"; }
    else if (presente === voluto) esito = "riuscito";
    else { esito = "non_so"; messaggio = "Il DC ha confermato, ma rileggendo il record non è come atteso"; }
  } else if (risposta) {
    // Senza rilettura non si sa se il comando ha scritto: un «no» non confermato è un «non so» (revisione del 18/11).
    if (presente === null) { esito = "non_so"; messaggio = `${risposta.motivo}; e la rilettura di controllo non è riuscita`; }
    else if (presente === voluto) { esito = "riuscito"; messaggio = `Il DC ha segnalato un errore ma il record è come atteso: ${risposta.motivo}`; }
    else { esito = "rifiutato"; messaggio = risposta.motivo; }
  } else if (presente === voluto) {
    esito = "riuscito";
    messaggio = `${messaggio}; rileggendo, il record è come atteso`;
  } else {
    esito = "non_so";
    messaggio = `${messaggio}; ${presente === null ? "e la rilettura non è riuscita" : "rileggendo, il record non è cambiato"}`;
  }
  chiudiModificaDnsAd(modificaId, esito, messaggio);
  try { riga("dopo", esito, messaggio); } catch (e) { console.error("[dns-ad] esito non scritto nel registro su file:", testo(e)); }
  return { correzione: c.correzione.id, passo: p, esito, messaggio, modificaId };
}

export interface EsitoGruppo { gruppo: string; esiti: EsitoPasso[]; riletto: boolean }

/** Esegue le correzioni confermate. Va chiamata dentro il contesto del cliente. Lancia se la scrittura è spenta o manca l'utenza. */
export function eseguiCorrezioni(integrazione: AdIntegration, correzioni: readonly Correzione[], da: string, deps: DipendenzeEsecuzione = {}): Promise<EsitoGruppo> {
  return inFila(integrazione.id, () => eseguiCorrezioniInFila(integrazione, correzioni, da, deps));
}

/**
 * Una scrittura alla volta per integrazione: due richieste insieme (doppio clic su «Applica» o su
 * «Annulla») leggerebbero il DC prima che l'altra scriva, e il registro segnerebbe due modifiche
 * riuscite per una sola (revisione del 18/11). Il servizio è un processo solo: basta la memoria.
 */
const file = new Map<number, Promise<unknown>>();
function inFila<T>(integrazioneId: number, lavoro: () => Promise<T>): Promise<T> {
  const prossimo = (file.get(integrazioneId) ?? Promise.resolve()).then(lavoro, lavoro);
  file.set(integrazioneId, prossimo.catch(() => undefined));
  return prossimo;
}

async function eseguiCorrezioniInFila(integrazione: AdIntegration, correzioni: readonly Correzione[], da: string, deps: DipendenzeEsecuzione): Promise<EsitoGruppo> {
  const accesso = accessoDnsDiOLancia(integrazione, deps);
  const lancia = deps.lancia ?? (await lanciatoreVero(integrazione, accesso as Extract<AccessoDns, { ok: true }>));
  const base = {
    integrazione, ammessi: ammessiDi(integrazione), lancia, registra: deps.registra ?? scriviRegistroDns,
    gruppo: crypto.randomUUID(), utenza: accesso.ok ? `${accesso.nome} (${accesso.fonte === "dedicata" ? "dedicata" : "WinRM del DC"})` : "", da, annullaDi: null,
  };
  const esiti: EsitoPasso[] = [];
  for (const cor of correzioni) {
    // Tutti i passi si convalidano PRIMA del primo comando: una correzione non si applica a metà perché l'ultimo passo non è ammesso.
    const nonAmmesso = cor.passi.map((p) => convalidaPasso(p, base.ammessi)).find((v) => !v.ok);
    if (nonAmmesso && !nonAmmesso.ok) {
      for (const p of cor.passi) esiti.push({ correzione: cor.id, passo: p, esito: "rifiutato", messaggio: `Correzione non eseguita, un suo passo non è ammesso: ${nonAmmesso.motivo}`, modificaId: null });
      continue;
    }
    let fermo = false;
    for (const p of cor.passi) {
      if (fermo) { esiti.push({ correzione: cor.id, passo: p, esito: "saltato", messaggio: "Non eseguito: un passo precedente della stessa correzione non è riuscito", modificaId: null }); continue; }
      const e = await eseguiPasso({ ...base, correzione: { id: cor.id, titolo: cor.titolo } }, p);
      esiti.push(e);
      if (e.esito !== "riuscito") fermo = true;
    }
  }
  return { gruppo: base.gruppo, esiti, riletto: await rileggi(integrazione, deps) };
}

function accessoDnsDiOLancia(integrazione: AdIntegration, deps: DipendenzeEsecuzione): AccessoDns {
  const accesso = accessoDnsDi(integrazione);
  // Spenta resta spenta anche nelle prove: l'interruttore viene prima di tutto.
  if (!accesso.ok && (!deps.lancia || !integrazione.dns_scrittura)) throw new Error(accesso.motivo);
  return accesso;
}

async function rileggi(integrazione: AdIntegration, deps: DipendenzeEsecuzione): Promise<boolean> {
  try {
    await (deps.rileggi ?? (async (i) => (await import("@/lib/ad/ad-client")).syncAdDns(i)))(integrazione);
    return true;
  } catch (e) {
    // Solo il tipo dell'errore: il messaggio di WinRM o LDAP può portare il nome del DC.
    console.warn("[dns-ad] rilettura del DNS dopo le correzioni non riuscita:", e instanceof Error ? e.name : "errore");
    return false;
  }
}

/** Il passo che rimette le cose com'erano. Un record tolto torna STATICO: l'ora del rinnovo non si può rimettere. */
export function passoInverso(m: Pick<RigaModificaDnsAd, "azione" | "zona" | "nome" | "tipo" | "dato">): PassoDns {
  return { azione: m.azione === "aggiungi" ? "togli" : "aggiungi", zona: m.zona, nome: m.nome, tipo: m.tipo, dato: m.dato };
}

/** Annulla una modifica riuscita, con le stesse garanzie di una correzione. */
export function annullaModifica(integrazione: AdIntegration, modificaId: number, da: string, deps: DipendenzeEsecuzione = {}): Promise<EsitoGruppo> {
  return inFila(integrazione.id, async () => annullaModificaInFila(integrazione, modificaId, da, deps));
}

async function annullaModificaInFila(integrazione: AdIntegration, modificaId: number, da: string, deps: DipendenzeEsecuzione): Promise<EsitoGruppo> {
  const m = getModificaDnsAd(integrazione.id, modificaId);
  if (!m) throw new Error("Modifica non trovata");
  if (m.esito !== "riuscito") throw new Error("Si annulla solo una modifica riuscita");
  if (modificaDnsAdGiaAnnullata(m.id)) throw new Error("Questa modifica è già stata annullata");
  const accesso = accessoDnsDiOLancia(integrazione, deps);
  const lancia = deps.lancia ?? (await lanciatoreVero(integrazione, accesso as Extract<AccessoDns, { ok: true }>));
  const gruppo = crypto.randomUUID();
  const esito = await eseguiPasso({
    integrazione, ammessi: ammessiDi(integrazione), lancia, registra: deps.registra ?? scriviRegistroDns, gruppo,
    correzione: { id: `annulla:${m.id}`, titolo: `Annulla: ${m.titolo}` },
    utenza: accesso.ok ? `${accesso.nome} (${accesso.fonte === "dedicata" ? "dedicata" : "WinRM del DC"})` : "", da, annullaDi: m.id,
  }, passoInverso(m));
  return { gruppo, esiti: [esito], riletto: await rileggi(integrazione, deps) };
}
