/**
 * La proposta di assegnatario sulla scheda dell'asset (piano 2026-10-23-assegnatari-da-ad, passo 5; tavola ⑫-⑱).
 * La lettura non scrive niente; «Accetta» e «PC condiviso» scrivono solo dopo il clic di un amministratore, con una
 * riga nel diario dell'asset. L'assegnazione fatta a mano non si sostituisce mai da sola: la scheda mostra chi si
 * collega davvero accanto (⑮) e lascia il clic a chi guarda.
 */
import type Database from "better-sqlite3";
import { accessiHost, personeAd, soglieDelCliente } from "./db";
import { assegnatarioDaUtente, utenteAdPerAccount } from "./importa";
import { calcolaProposta, type FonteAccesso, type MotivoFuori, type Proposta } from "./proposta";

export interface RigaAccessoAsset {
  account: string;
  assegnatario: string | null;
  persona: string | null;
  accessi: number;
  tastiera: number;
  rete: number;
  ultimo: string | null;
  perFonte: Record<FonteAccesso, number>;
  nelCalcolo: boolean;
  motivo: MotivoFuori | null;
}

export interface PropostaAsset {
  assetId: number;
  hostId: number | null;
  categoria: string | null;
  propostaOff: boolean;
  giorni: number;
  soglia: number;
  minimo: number;
  esito: Proposta["esito"];
  perche: Proposta["perche"];
  base: Proposta["base"];
  /** La persona prevalente (anche con esito «esclusa»), con l'assegnatario già esistente se c'è. */
  prevalente: null | {
    account: string;
    nome: string;
    reparto: string | null;
    ruolo: string | null;
    accessi: number;
    totale: number;
    ultimo: string | null;
    perFonte: Record<FonteAccesso, number>;
    assegnatarioId: number | null;
  };
  assegnato: null | { id: number; nome: string; adAbilitato: number | null; adDisattivatoIl: string | null; origine: string | null };
  righe: RigaAccessoAsset[];
}

interface AssetMinimo {
  id: number;
  host_id: number | null;
  categoria: string | null;
  asset_assignee_id: number | null;
  proposta_assegnatario_off: number;
}

/**
 * L'host dell'asset è il suo `host_id` o, se manca, quello dell'apparato collegato: sull'hub .8 (23/10) 32 asset su 34
 * avevano solo `network_device_id`. `network_devices.host_id` lo aggiunge un ALTER all'apertura del tenant.
 */
function assetMinimo(db: Database.Database, assetId: number): AssetMinimo | undefined {
  const conHostApparato = (db.prepare("PRAGMA table_info(network_devices)").all() as Array<{ name: string }>).some((c) => c.name === "host_id");
  return db.prepare(
    `SELECT a.id, ${conHostApparato ? "COALESCE(a.host_id, nd.host_id)" : "a.host_id"} AS host_id, a.categoria, a.asset_assignee_id,
            a.proposta_assegnatario_off
     FROM inventory_assets a LEFT JOIN network_devices nd ON nd.id = a.network_device_id WHERE a.id = ?`,
  ).get(assetId) as AssetMinimo | undefined;
}

/** null = l'asset non c'è. */
export function propostaPerAsset(db: Database.Database, assetId: number, giorniChiesti?: number): PropostaAsset | null {
  const a = assetMinimo(db, assetId);
  if (!a) return null;
  const soglie = soglieDelCliente(db);
  const giorni = giorniChiesti ?? soglie.giorni;
  const accessi = a.host_id !== null ? accessiHost(db, a.host_id, giorni) : [];
  const persone = personeAd(db, [...new Set(accessi.map((x) => x.account))]);
  const p = calcolaProposta({ accessi, persone, categoria: a.categoria, propostaOff: a.proposta_assegnatario_off === 1, soglie: { ...soglie, giorni } });

  // Account → assegnatario legato per guid (una query sola per tutte le righe).
  const perGuid = new Map<string, { id: number; name: string }>();
  for (const r of db.prepare("SELECT id, name, ad_integration_id, ad_object_guid FROM asset_assignees WHERE ad_object_guid IS NOT NULL").all() as Array<{ id: number; name: string; ad_integration_id: number; ad_object_guid: string }>) {
    perGuid.set(`${r.ad_integration_id}:${r.ad_object_guid}`, { id: r.id, name: r.name });
  }
  const assegnatarioDi = (account: string) => {
    const per = persone.get(account);
    return per ? perGuid.get(`${per.integrationId}:${per.guid}`) ?? null : null;
  };
  const nomePersona = (account: string): string | null => {
    const per = persone.get(account);
    if (!per) return null;
    return [per.nome, per.cognome].filter(Boolean).join(" ") || per.nomeVisualizzato || null;
  };

  const assegnato = a.asset_assignee_id !== null
    ? db.prepare("SELECT id, name, ad_abilitato, ad_disattivato_il, origine FROM asset_assignees WHERE id = ?").get(a.asset_assignee_id) as
      { id: number; name: string; ad_abilitato: number | null; ad_disattivato_il: string | null; origine: string | null } | undefined
    : undefined;

  const primo = p.persona ? p.righe.find((r) => r.account === p.persona!.account) : undefined;
  return {
    assetId: a.id,
    hostId: a.host_id,
    categoria: a.categoria,
    propostaOff: a.proposta_assegnatario_off === 1,
    giorni,
    soglia: soglie.percentuale,
    minimo: soglie.minimo,
    esito: p.esito,
    perche: p.perche,
    base: p.base,
    prevalente: p.persona && primo
      ? {
        account: p.persona.account,
        nome: nomePersona(p.persona.account) ?? p.persona.account,
        reparto: p.persona.reparto,
        ruolo: p.persona.ruolo,
        accessi: p.accessiPersona,
        totale: p.totale,
        ultimo: p.ultimoPersona,
        perFonte: primo.perFonte,
        assegnatarioId: assegnatarioDi(p.persona.account)?.id ?? null,
      }
      : null,
    assegnato: assegnato
      ? { id: assegnato.id, nome: assegnato.name, adAbilitato: assegnato.ad_abilitato, adDisattivatoIl: assegnato.ad_disattivato_il, origine: assegnato.origine }
      : null,
    righe: p.righe.map((r) => ({
      account: r.account,
      assegnatario: assegnatarioDi(r.account)?.name ?? null,
      persona: nomePersona(r.account),
      accessi: r.tastiera + r.rete,
      tastiera: r.tastiera,
      rete: r.rete,
      ultimo: r.ultimo,
      perFonte: r.perFonte,
      nelCalcolo: r.nelCalcolo,
      motivo: r.motivo,
    })),
  };
}

export class ErroreProposta extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

function diario(db: Database.Database, assetId: number, utente: number | null, campo: string, prima: unknown, dopo: unknown): void {
  const s = (v: unknown) => (v === null || v === undefined ? null : String(v));
  if (s(prima) === s(dopo)) return;
  db.prepare("INSERT INTO inventory_audit_log (asset_id, user_id, action, field_name, old_value, new_value) VALUES (?, ?, 'update', ?, ?, ?)")
    .run(assetId, utente, campo, s(prima), s(dopo));
}

/**
 * «Accetta» (⑬) o «Assegna a …» (⑮): l'utente di AD diventa assegnatario (creato o aggiornato, come all'importazione)
 * e l'asset gli si assegna. Si accetta solo la persona che il calcolo indica adesso: se nel frattempo è cambiata, 409.
 */
export function accettaProposta(db: Database.Database, assetId: number, account: string, utente: number | null): { assegnatarioId: number; nome: string } {
  const p = propostaPerAsset(db, assetId);
  if (!p) throw new ErroreProposta("Asset non trovato", 404);
  if (!p.prevalente || p.prevalente.account !== account.toLowerCase()) {
    throw new ErroreProposta("La proposta è cambiata: ricarica la scheda", 409);
  }
  const u = utenteAdPerAccount(db, account);
  if (!u) throw new ErroreProposta("Utente non trovato in Active Directory", 404);
  let esito = { assegnatarioId: 0, nome: "" };
  db.transaction(() => {
    const { id } = assegnatarioDaUtente(db, u);
    const prima = assetMinimo(db, assetId)!.asset_assignee_id;
    db.prepare("UPDATE inventory_assets SET asset_assignee_id = ?, updated_at = datetime('now') WHERE id = ?").run(id, assetId);
    diario(db, assetId, utente, "asset_assignee_id", prima, id);
    esito = { assegnatarioId: id, nome: (db.prepare("SELECT name FROM asset_assignees WHERE id = ?").get(id) as { name: string }).name };
  })();
  return esito;
}

/** «PC condiviso, non proporre» (⑬), o il suo contrario. */
export function segnaCondiviso(db: Database.Database, assetId: number, condiviso: boolean, utente: number | null): void {
  const a = assetMinimo(db, assetId);
  if (!a) throw new ErroreProposta("Asset non trovato", 404);
  db.transaction(() => {
    db.prepare("UPDATE inventory_assets SET proposta_assegnatario_off = ?, updated_at = datetime('now') WHERE id = ?").run(condiviso ? 1 : 0, assetId);
    diario(db, assetId, utente, "proposta_assegnatario_off", a.proposta_assegnatario_off, condiviso ? 1 : 0);
  })();
}
