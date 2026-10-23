/**
 * La pagina «Abbinamenti» (piano 2026-10-23-abbinamenti; tavola 4, ⑲-㉕): per ogni host con accessi, chi lo usa e cosa
 * manca per abbinarlo (l'asset, l'assegnatario, l'assegnazione). Una lettura sola di accessi e persone per tutti gli
 * host; la conferma ricalcola ogni voce dentro la transazione e scrive solo quelle che valgono ancora.
 *
 * Gruppi: `proposto` (persona prevalente, asset senza assegnatario o da creare) · `da_rivedere` (asset assegnato a un
 * altro: mai spuntato di serie) · `abbinato` (già assegnato a chi lo usa) · `pochi_dati` · `escluso` (server,
 * apparati, PC condivisi o segnati come tali).
 */
import type Database from "better-sqlite3";
import { mapHostClassificationToInventoryCategoria } from "@/lib/db-tenant";
import type { InventoryAssetCategoria } from "@/types";
import { personeAd, soglieDelCliente } from "./db";
import { assegnatarioDaUtente, utenteAdPerAccount } from "./importa";
import { CATEGORIE_SENZA_PROPOSTA, calcolaProposta, type AccessoAggregato, type Proposta } from "./proposta";

export type GruppoAbbinamento = "proposto" | "da_rivedere" | "abbinato" | "pochi_dati" | "escluso";
export const GRUPPI: readonly GruppoAbbinamento[] = ["proposto", "da_rivedere", "abbinato", "pochi_dati", "escluso"];

/** Le categorie che si possono scegliere per un asset nuovo quando la classificazione non basta. */
export const CATEGORIE_NUOVO_ASSET: readonly InventoryAssetCategoria[] = ["Desktop", "Laptop", "VM", "Other"];

export interface VoceAbbinamento {
  hostId: number;
  pc: string;
  ip: string;
  classificazione: string | null;
  asset: { id: number; categoria: string | null } | null;
  /** Senza asset: la categoria che avrà; null = da scegliere nella riga. */
  categoriaProposta: InventoryAssetCategoria | null;
  gruppo: GruppoAbbinamento;
  /** Perché è escluso o ha pochi dati, a parole. */
  motivo: string | null;
  persona: { account: string; nome: string; reparto: string | null; ruolo: string | null } | null;
  /** L'assegnatario già legato alla persona (per guid), o null: si importerà da AD. */
  assegnatarioPersona: number | null;
  assegnato: { id: number; nome: string; origine: string | null } | null;
  accessi: number;
  totale: number;
  base: Proposta["base"];
  ultimo: string | null;
}

export interface Abbinamenti {
  contatori: Record<GruppoAbbinamento, number>;
  voci: VoceAbbinamento[];
  totale: number;
  pagina: number;
  perPagina: number;
  /** Per ogni proposto (tutte le pagine): cosa creerebbe la conferma. Serve al riepilogo ㉔ della selezione. */
  proposti: Record<number, { account: string; creaAsset: boolean; importaAssegnatario: boolean; categoriaDaScegliere: boolean }>;
  giorni: number;
}

interface RigaHost {
  id: number;
  pc: string;
  ip: string;
  classification: string | null;
  asset_id: number | null;
  categoria: string | null;
  proposta_off: number | null;
  assegnato_id: number | null;
  assegnato_nome: string | null;
  assegnato_origine: string | null;
}

function hostConAccessi(db: Database.Database, giorni: number, soloHost?: number): RigaHost[] {
  // `network_devices.host_id` lo aggiunge un ALTER all'apertura del tenant: nei DB di prova può mancare.
  const conHostApparato = (db.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>).some((c) => c.name === "host_id");
  const legame = conHostApparato ? "(a.host_id = h.id OR nd.host_id = h.id)" : "a.host_id = h.id";
  return db.prepare(
    `WITH hh AS (
       SELECT h.id, COALESCE(NULLIF(h.custom_name, ''), NULLIF(h.hostname, ''), h.ip) AS pc, h.ip, h.classification,
              (SELECT a.id FROM inventory_assets a LEFT JOIN network_devices nd ON nd.id = a.network_device_id
               WHERE ${legame} ORDER BY (a.host_id IS NULL), a.id LIMIT 1) AS asset_id
       FROM hosts h
       WHERE h.id IN (SELECT DISTINCT host_id FROM host_accessi_utente WHERE giorno >= date('now', ?))
         ${soloHost !== undefined ? "AND h.id = ?" : ""}
     )
     SELECT hh.id, hh.pc, hh.ip, hh.classification, hh.asset_id, x.categoria, x.proposta_assegnatario_off AS proposta_off,
            aa.id AS assegnato_id, aa.name AS assegnato_nome, aa.origine AS assegnato_origine
     FROM hh
     LEFT JOIN inventory_assets x ON x.id = hh.asset_id
     LEFT JOIN asset_assignees aa ON aa.id = x.asset_assignee_id
     ORDER BY lower(hh.pc)`,
  ).all(`-${giorni} days`, ...(soloHost !== undefined ? [soloHost] : [])) as RigaHost[];
}

const nomeBreve = (pc: string, ip: string): string => (pc === ip ? pc : pc.split(".")[0] || pc);

/** Tutte le voci, calcolate. `soloHost`: una voce sola (la conferma). */
function calcolaVoci(db: Database.Database, soloHost?: number): { voci: VoceAbbinamento[]; giorni: number } {
  const soglie = soglieDelCliente(db);
  const host = hostConAccessi(db, soglie.giorni, soloHost);
  if (host.length === 0) return { voci: [], giorni: soglie.giorni };
  const ids = host.map((h) => h.id);
  const accessi = new Map<number, AccessoAggregato[]>();
  for (let i = 0; i < ids.length; i += 500) {
    const parte = ids.slice(i, i + 500);
    const righe = db.prepare(
      `SELECT host_id, account, fonte, SUM(conteggio) AS conteggio, MAX(ultimo) AS ultimo FROM host_accessi_utente
       WHERE giorno >= date('now', ?) AND host_id IN (${parte.map(() => "?").join(",")}) GROUP BY host_id, account, fonte`,
    ).all(`-${soglie.giorni} days`, ...parte) as Array<AccessoAggregato & { host_id: number }>;
    for (const r of righe) (accessi.get(r.host_id) ?? accessi.set(r.host_id, []).get(r.host_id)!).push(r);
  }
  const persone = personeAd(db, [...new Set([...accessi.values()].flat().map((a) => a.account))]);
  const perGuid = new Map<string, number>();
  for (const r of db.prepare("SELECT id, ad_integration_id, ad_object_guid FROM asset_assignees WHERE ad_object_guid IS NOT NULL").all() as Array<{ id: number; ad_integration_id: number; ad_object_guid: string }>) {
    perGuid.set(`${r.ad_integration_id}:${r.ad_object_guid}`, r.id);
  }

  const voci = host.map((h): VoceAbbinamento => {
    const daClassificazione = mapHostClassificationToInventoryCategoria(h.classification);
    // Senza asset vale la classificazione dell'host: un server resta escluso anche se non è in inventario.
    const categoria = h.asset_id !== null ? h.categoria : daClassificazione;
    const p = calcolaProposta({
      accessi: accessi.get(h.id) ?? [],
      persone,
      categoria,
      propostaOff: h.proposta_off === 1,
      soglie,
    });
    const pers = p.persona;
    const assegnatarioPersona = pers ? perGuid.get(`${pers.integrationId}:${pers.guid}`) ?? null : null;
    let gruppo: GruppoAbbinamento;
    let motivo: string | null = null;
    if (p.esito === "esclusa") {
      gruppo = "escluso";
      motivo = p.perche === "segnato_condiviso"
        ? "segnato come PC condiviso"
        : h.asset_id !== null ? `categoria ${h.categoria} nell'inventario` : `${h.classification ?? "classificazione"} (classificazione dell'host)`;
    } else if (p.esito === "condiviso") {
      gruppo = "escluso";
      motivo = "condiviso: nessuno sopra la soglia";
    } else if (p.esito === "pochi_dati" || p.esito === "nessuna_fonte") {
      gruppo = "pochi_dati";
      motivo = `meno di ${soglie.minimo} accessi di persone`;
    } else if (h.assegnato_id === null) {
      gruppo = "proposto";
    } else if (assegnatarioPersona !== null && h.assegnato_id === assegnatarioPersona) {
      gruppo = "abbinato";
    } else {
      gruppo = "da_rivedere";
    }
    const nome = pers ? ([pers.nome, pers.cognome].filter(Boolean).join(" ") || pers.nomeVisualizzato || pers.account) : null;
    return {
      hostId: h.id,
      pc: nomeBreve(h.pc, h.ip),
      ip: h.ip,
      classificazione: h.classification,
      asset: h.asset_id !== null ? { id: h.asset_id, categoria: h.categoria } : null,
      categoriaProposta: h.asset_id === null && daClassificazione && !CATEGORIE_SENZA_PROPOSTA.has(daClassificazione)
        && daClassificazione !== "Other" && daClassificazione !== "VM" ? daClassificazione : null,
      gruppo,
      motivo,
      persona: pers && nome ? { account: pers.account, nome, reparto: pers.reparto, ruolo: pers.ruolo } : null,
      assegnatarioPersona,
      assegnato: h.assegnato_id !== null ? { id: h.assegnato_id, nome: h.assegnato_nome ?? "", origine: h.assegnato_origine } : null,
      accessi: p.accessiPersona,
      totale: p.totale,
      base: p.base,
      ultimo: p.ultimoPersona,
    };
  });
  return { voci, giorni: soglie.giorni };
}

export function elencoAbbinamenti(db: Database.Database, f: { gruppo: GruppoAbbinamento | "tutti"; soloSenzaAsset: boolean; cerca: string | null; pagina: number; perPagina: number }): Abbinamenti {
  const { voci, giorni } = calcolaVoci(db);
  const contatori = { proposto: 0, da_rivedere: 0, abbinato: 0, pochi_dati: 0, escluso: 0 };
  for (const v of voci) contatori[v.gruppo]++;
  const q = f.cerca?.trim().toLowerCase() ?? "";
  const filtrate = voci.filter((v) =>
    (f.gruppo === "tutti" || v.gruppo === f.gruppo)
    && (!f.soloSenzaAsset || v.asset === null)
    && (!q || v.pc.toLowerCase().includes(q) || v.ip.includes(q) || (v.persona?.nome.toLowerCase().includes(q) ?? false)));
  const da = (f.pagina - 1) * f.perPagina;
  const proposti: Abbinamenti["proposti"] = {};
  for (const v of voci) {
    if (v.gruppo !== "proposto" || !v.persona) continue;
    proposti[v.hostId] = {
      account: v.persona.account,
      creaAsset: v.asset === null,
      importaAssegnatario: v.assegnatarioPersona === null,
      categoriaDaScegliere: v.asset === null && v.categoriaProposta === null,
    };
  }
  return { contatori, voci: filtrate.slice(da, da + f.perPagina), totale: filtrate.length, pagina: f.pagina, perPagina: f.perPagina, proposti, giorni };
}

export interface RichiestaAbbinamento {
  hostId: number;
  account: string;
  /** Solo per gli asset da creare senza categoria proposta. */
  categoria?: InventoryAssetCategoria;
}

export interface EsitoConferma {
  assegnati: number;
  assetCreati: number;
  assegnatariCreati: number;
  saltati: Array<{ hostId: number; motivo: string }>;
}

/**
 * Conferma in UNA transazione. Ogni voce si ricalcola: si scrive solo se è ancora `proposto` o `da_rivedere` con la
 * stessa persona; altrimenti si salta col motivo (la pagina lo dice). Crea l'assegnatario da AD e l'asset se mancano.
 */
export function confermaAbbinamenti(db: Database.Database, richieste: readonly RichiestaAbbinamento[], utente: number | null): EsitoConferma {
  const esito: EsitoConferma = { assegnati: 0, assetCreati: 0, assegnatariCreati: 0, saltati: [] };
  const audit = db.prepare("INSERT INTO inventory_audit_log (asset_id, user_id, action, field_name, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)");
  db.transaction(() => {
    for (const r of richieste) {
      const v = calcolaVoci(db, r.hostId).voci[0];
      const salta = (motivo: string) => esito.saltati.push({ hostId: r.hostId, motivo });
      if (!v) { salta("nessun accesso nel periodo"); continue; }
      if (v.gruppo !== "proposto" && v.gruppo !== "da_rivedere") { salta(v.gruppo === "abbinato" ? "già abbinato" : `non più proposto (${v.motivo ?? v.gruppo})`); continue; }
      if (!v.persona || v.persona.account !== r.account.toLowerCase()) { salta("la persona proposta è cambiata"); continue; }
      const categoria = v.asset ? null : v.categoriaProposta ?? r.categoria ?? null;
      if (!v.asset && !categoria) { salta("categoria dell'asset da scegliere"); continue; }
      const u = utenteAdPerAccount(db, r.account);
      if (!u) { salta("utente non trovato in AD"); continue; }

      const { id: assegnatarioId, creato } = assegnatarioDaUtente(db, u);
      if (creato) esito.assegnatariCreati++;
      let assetId = v.asset?.id ?? null;
      if (assetId === null) {
        const h = db.prepare("SELECT id, ip, hostname, custom_name, vendor, model, serial_number, mac, os_info FROM hosts WHERE id = ?").get(r.hostId) as
          { id: number; ip: string; hostname: string | null; custom_name: string | null; vendor: string | null; model: string | null; serial_number: string | null; mac: string | null; os_info: string | null };
        const nome = h.custom_name || h.hostname || h.ip;
        assetId = Number(db.prepare(
          `INSERT INTO inventory_assets (host_id, hostname, nome_prodotto, categoria, marca, modello, serial_number, ip_address, mac_address, sistema_operativo, stato)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Attivo')`,
        ).run(h.id, nome, h.model || nome, categoria, h.vendor, h.model, h.serial_number, h.ip, h.mac, h.os_info).lastInsertRowid);
        audit.run(assetId, utente, "create", null, null, "da Abbinamenti");
        esito.assetCreati++;
      }
      db.prepare("UPDATE inventory_assets SET asset_assignee_id = ?, updated_at = datetime('now') WHERE id = ?").run(assegnatarioId, assetId);
      audit.run(assetId, utente, "update", "asset_assignee_id", v.assegnato ? String(v.assegnato.id) : null, String(assegnatarioId));
      esito.assegnati++;
    }
  })();
  return esito;
}
