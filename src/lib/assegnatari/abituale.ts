/**
 * L'«utente abituale» di un host, per la colonna di Apparati (Riccardo, 23/11/2026).
 *
 * Non rifà il calcolo: usa le voci di Abbinamenti (`calcolaVoci`, cioè `calcolaProposta` sugli accessi della finestra).
 * Ordine di chi vince:
 * 1. la scelta a mano sull'host (`hosts.utente_abituale_modo`: `manuale` con l'utente AD, o `condiviso`);
 * 2. l'assegnatario dell'asset NIS2 legato all'host (è una scelta di una persona: vale come «a mano»);
 * 3. la persona prevalente calcolata dagli accessi; 4. «condiviso» se nessuno supera la soglia;
 * 5. se gli accessi non bastano: l'ultimo utente scritto in AD nella descrizione del computer (`descrizione-ad.ts`),
 *    se è una persona di AD e la data sta nella finestra (23/11: era la fonte che mancava per i PC senza agente).
 * Il calcolato non si salva: si rilegge a ogni richiesta, quindi segue il dato. Una scelta a mano non viene mai
 * sostituita: se il calcolo dice un'altra persona lo si segnala (`diverso`) e basta.
 */
import type Database from "better-sqlite3";
import { mapHostClassificationToInventoryCategoria } from "@/lib/db-tenant";
import { calcolaVoci, legameAssetHost } from "./abbinamenti";
import { personeAd, soglieDelCliente } from "./db";
import { ultimiAccessiAd } from "./descrizione-ad";
import { assegnatarioDaUtente, utenteAdPerAccount } from "./importa";
import { CATEGORIE_SENZA_PROPOSTA, motivoFuori } from "./proposta";

export interface UtenteAbituale {
  origine: "manuale" | "calcolato" | "condiviso";
  /** Scelto da una persona (sull'host o come assegnatario dell'asset). */
  aMano: boolean;
  nome: string | null;
  account: string | null;
  /** L'utente scelto a mano è disattivato in AD o non c'è più: da riassegnare. */
  disattivato: boolean;
  /**
   * Cosa dice il calcolo adesso (null: nessuna persona). `fonte`: `accessi` = la più frequente negli accessi;
   * `ad` = l'ultimo utente scritto in AD nella descrizione del computer, il giorno `il` («YYYY-MM-DD»).
   */
  calcolo: {
    nome: string; account: string; fonte: "accessi" | "ad"; accessi: number; totale: number;
    base: "tastiera" | "rete" | null; il: string | null; computer: string | null;
  } | null;
  /** A mano, ma il calcolo indica un'altra persona. */
  diverso: boolean;
}

interface RigaManuale {
  id: number;
  modo: string;
  account: string | null;
  display_name: string | null;
  given_name: string | null;
  surname: string | null;
  enabled: number | null;
}

interface RigaAsset {
  host_id: number;
  nome: string;
  ad_abilitato: number | null;
  account: string | null;
}

const nomePersona = (r: RigaManuale): string | null =>
  [r.given_name, r.surname].filter((x) => x?.trim()).join(" ") || r.display_name?.trim() || r.account;

/** Per ogni host che ha qualcosa da mostrare, il suo utente abituale. Una lettura per tutta la lista. */
export function utentiAbituali(db: Database.Database): Map<number, UtenteAbituale> {
  const out = new Map<number, UtenteAbituale>();
  const voci = new Map(calcolaVoci(db).voci.map((v) => [v.hostId, v]));
  const daAd = dalleDescrizioniAd(db, voci);
  const calcoloDi = (hostId: number): UtenteAbituale["calcolo"] => {
    const v = voci.get(hostId);
    if (v && v.esito === "proposta" && v.persona) {
      return { nome: v.persona.nome, account: v.persona.account, fonte: "accessi", accessi: v.accessi, totale: v.totale, base: v.base, il: null, computer: null };
    }
    return daAd.get(hostId) ?? null;
  };

  const manuali = db.prepare(
    `SELECT h.id, h.utente_abituale_modo AS modo, lower(u.sam_account_name) AS account, u.display_name, u.given_name, u.surname, u.enabled
     FROM hosts h LEFT JOIN ad_users u ON u.integration_id = h.utente_abituale_integrazione AND u.object_guid = h.utente_abituale_guid
     WHERE h.utente_abituale_modo IS NOT NULL`,
  ).all() as RigaManuale[];
  for (const r of manuali) {
    const calcolo = calcoloDi(r.id);
    if (r.modo === "condiviso") {
      out.set(r.id, { origine: "condiviso", aMano: true, nome: null, account: null, disattivato: false, calcolo, diverso: calcolo !== null });
    } else {
      out.set(r.id, {
        origine: "manuale", aMano: true, nome: nomePersona(r) ?? "utente non più in AD", account: r.account,
        disattivato: r.enabled !== 1, calcolo, diverso: calcolo !== null && calcolo.account !== r.account,
      });
    }
  }

  const assegnati = db.prepare(
    `SELECT h.id AS host_id, aa.name AS nome, aa.ad_abilitato, lower(u.sam_account_name) AS account
     FROM hosts h
     JOIN inventory_assets x ON x.id = (SELECT a.id FROM inventory_assets a LEFT JOIN network_devices nd ON nd.id = a.network_device_id
                                        WHERE ${legameAssetHost(db)} ORDER BY (a.host_id IS NULL), a.id LIMIT 1)
     JOIN asset_assignees aa ON aa.id = x.asset_assignee_id
     LEFT JOIN ad_users u ON u.integration_id = aa.ad_integration_id AND u.object_guid = aa.ad_object_guid`,
  ).all() as RigaAsset[];
  for (const r of assegnati) {
    if (out.has(r.host_id)) continue;
    const calcolo = calcoloDi(r.host_id);
    out.set(r.host_id, {
      origine: "manuale", aMano: true, nome: r.nome, account: r.account, disattivato: r.ad_abilitato === 0,
      calcolo, diverso: voci.get(r.host_id)?.gruppo === "da_rivedere",
    });
  }

  for (const hostId of new Set([...voci.keys(), ...daAd.keys()])) {
    if (out.has(hostId)) continue;
    const calcolo = calcoloDi(hostId);
    if (calcolo) out.set(hostId, { origine: "calcolato", aMano: false, nome: calcolo.nome, account: calcolo.account, disattivato: false, calcolo, diverso: false });
    else if (voci.get(hostId)?.esito === "condiviso") out.set(hostId, { origine: "condiviso", aMano: false, nome: null, account: null, disattivato: false, calcolo: null, diverso: false });
  }
  return out;
}

/**
 * L'utente abituale dalla descrizione del computer di AD, per gli host dove gli accessi non decidono: niente voce,
 * pochi dati o nessuna fonte. Mai sopra un «condiviso» o un'esclusione degli accessi; stesse regole sulle persone
 * (`motivoFuori`: abilitate, con nome e cognome, non amministrative né di servizio) e sulle categorie.
 */
function dalleDescrizioniAd(db: Database.Database, voci: ReadonlyMap<number, { esito: string }>): Map<number, NonNullable<UtenteAbituale["calcolo"]>> {
  const out = new Map<number, NonNullable<UtenteAbituale["calcolo"]>>();
  const ultimi = ultimiAccessiAd(db, soglieDelCliente(db).giorni);
  if (ultimi.size === 0) return out;
  const persone = personeAd(db, [...new Set([...ultimi.values()].map((u) => u.account))]);
  const categoria = db.prepare(
    `SELECT h.classification AS c, (SELECT x.categoria FROM inventory_assets x WHERE x.host_id = h.id ORDER BY x.id LIMIT 1) AS a FROM hosts h WHERE h.id = ?`,
  );
  for (const [hostId, u] of ultimi) {
    const esito = voci.get(hostId)?.esito;
    if (esito === "proposta" || esito === "condiviso" || esito === "esclusa") continue;
    const p = persone.get(u.account) ?? null;
    if (!p || motivoFuori(u.account, p) !== null) continue;
    const r = categoria.get(hostId) as { c: string | null; a: string | null } | undefined;
    const cat = r?.a ?? mapHostClassificationToInventoryCategoria(r?.c ?? null);
    if (cat && CATEGORIE_SENZA_PROPOSTA.has(cat)) continue;
    const nome = [p.nome, p.cognome].filter((x) => x?.trim()).join(" ") || p.nomeVisualizzato?.trim() || p.account;
    out.set(hostId, { nome, account: p.account, fonte: "ad", accessi: 0, totale: 0, base: null, il: u.giorno, computer: u.computer });
  }
  return out;
}

export type SceltaAbituale = { modo: "manuale"; account: string } | { modo: "condiviso" } | { modo: "auto" };

/** Gli utenti di AD fra cui scegliere (abilitati), col nome che si mostra. */
export function utentiSceglibili(db: Database.Database): Array<{ account: string; nome: string; reparto: string | null }> {
  const righe = db.prepare(
    `SELECT lower(sam_account_name) AS account, display_name, given_name, surname, department FROM ad_users
     WHERE enabled = 1 AND sam_account_name NOT LIKE '%$' ORDER BY integration_id`,
  ).all() as Array<{ account: string; display_name: string | null; given_name: string | null; surname: string | null; department: string | null }>;
  const visti = new Map<string, { account: string; nome: string; reparto: string | null }>();
  for (const r of righe) {
    if (visti.has(r.account)) continue;
    visti.set(r.account, { account: r.account, nome: [r.given_name, r.surname].filter((x) => x?.trim()).join(" ") || r.display_name?.trim() || r.account, reparto: r.department });
  }
  return [...visti.values()].sort((a, b) => a.nome.localeCompare(b.nome, "it"));
}

/**
 * Scrive la scelta su uno o più host, in UNA transazione. Dove l'host ha già un asset NIS2 lo tiene allineato
 * (assegnatario, «PC condiviso»), col diario; non crea asset: quello resta alla pagina Abbinamenti.
 * `auto` toglie la scelta a mano e l'assegnatario dell'asset: da lì in poi vale il calcolo.
 */
export function impostaUtenteAbituale(db: Database.Database, hostIds: readonly number[], scelta: SceltaAbituale, utente: number | null): { scritti: number; assetAllineati: number } {
  const esito = { scritti: 0, assetAllineati: 0 };
  const u = scelta.modo === "manuale" ? utenteAdPerAccount(db, scelta.account) : undefined;
  if (scelta.modo === "manuale" && !u) throw new ErroreScelta("Utente non trovato in AD");
  const audit = db.prepare("INSERT INTO inventory_audit_log (asset_id, user_id, action, field_name, old_value, new_value) VALUES (?, ?, 'update', ?, ?, ?)");
  const assetDi = db.prepare(
    `SELECT x.id, x.asset_assignee_id AS assegnato, x.proposta_assegnatario_off AS off FROM hosts h
     JOIN inventory_assets x ON x.id = (SELECT a.id FROM inventory_assets a LEFT JOIN network_devices nd ON nd.id = a.network_device_id
                                        WHERE ${legameAssetHost(db)} ORDER BY (a.host_id IS NULL), a.id LIMIT 1)
     WHERE h.id = ?`,
  );
  const scriviHost = db.prepare("UPDATE hosts SET utente_abituale_modo = ?, utente_abituale_integrazione = ?, utente_abituale_guid = ? WHERE id = ?");
  const s = (x: number | null) => (x === null ? null : String(x));
  db.transaction(() => {
    const assegnatarioId = u ? assegnatarioDaUtente(db, u).id : null;
    for (const hostId of new Set(hostIds)) {
      const fatto = scelta.modo === "manuale" ? scriviHost.run("manuale", u!.integration_id, u!.object_guid, hostId)
        : scelta.modo === "condiviso" ? scriviHost.run("condiviso", null, null, hostId)
        : scriviHost.run(null, null, null, hostId);
      if (fatto.changes === 0) continue;
      esito.scritti++;
      const asset = assetDi.get(hostId) as { id: number; assegnato: number | null; off: number } | undefined;
      if (!asset) continue;
      const nuovoAssegnato = scelta.modo === "manuale" ? assegnatarioId : scelta.modo === "auto" ? null : asset.assegnato;
      const nuovoOff = scelta.modo === "condiviso" ? 1 : 0;
      if (nuovoAssegnato === asset.assegnato && nuovoOff === asset.off) continue;
      db.prepare("UPDATE inventory_assets SET asset_assignee_id = ?, proposta_assegnatario_off = ?, updated_at = datetime('now') WHERE id = ?").run(nuovoAssegnato, nuovoOff, asset.id);
      if (nuovoAssegnato !== asset.assegnato) audit.run(asset.id, utente, "asset_assignee_id", s(asset.assegnato), s(nuovoAssegnato));
      if (nuovoOff !== asset.off) audit.run(asset.id, utente, "proposta_assegnatario_off", String(asset.off), String(nuovoOff));
      esito.assetAllineati++;
    }
  })();
  return esito;
}

/** Un rifiuto da mostrare a chi ha scelto (400), distinto da un guasto. */
export class ErroreScelta extends Error {}
