/**
 * Chi usa una voce dell'archivio (tappa 2 credenziali, T13, 16/10).
 *
 * Serve a D8 = (a): una voce in uso non si elimina e non cambia tipo, e la
 * risposta dice dove è usata. Prima l'eliminazione toglieva in silenzio
 * binding, catene e righe host (CASCADE) e spegneva il WinRM dell'AD e le
 * scansioni Proxmox (SET NULL). Serve anche alla colonna «Usata da» della
 * pagina Credenziali.
 *
 * Le fonti sono le colonne con chiave esterna verso `credentials` nel DB di un
 * tenant. Le scansioni software si elencano ma non contano: sono storia, e
 * con la voce eliminata la loro colonna diventa NULL senza fermare niente.
 * Controller e account LDAP dell'AD restano vuoti fino al T22, che aggiunge
 * le colonne `network_controllers.credential_id` e `ad_integrations.credential_id`
 * (una query che le nominasse oggi darebbe «no such column»).
 *
 * Catene vecchie (`network_host_credentials`) e pin (`host_detect_credential`)
 * contano solo finché il motore li legge (`cateneVecchieAperte`): dopo la 2d
 * sono congelati fino alla 2g, e una voce tolta dalla lista, o saltata dalla
 * conversione per il tipo, resterebbe «in uso» per una rete o un host dove
 * nessuno la usa e dove la pagina non la mostra; con D8 non si potrebbe né
 * eliminare né cambiarle tipo, e «Togli prima questi usi» chiederebbe una cosa
 * impossibile (revisione della 2d, 16/10).
 *
 * Modulo con l'handle del DB esplicito: non importa né `db.ts` né `db-tenant.ts`.
 */
import type Database from "better-sqlite3";
import { cateneVecchieAperte } from "./segni-t2";

export interface UsiCredenziale {
  apparati: Array<{ id: number; nome: string; come: "binding" | "colonna" }>;
  reti: Array<{ id: number; nome: string }>;
  /** Host con la voce fra le loro credenziali o come credenziale rilevata. */
  host: number;
  controller: Array<{ id: number; nome: string }>;
  ad: Array<{ id: number; nome: string; come: "ldap" | "winrm" }>;
  proxmox: number;
  /** Scansioni software passate fatte con la voce: si elencano, non tengono ferma la voce. */
  scansioniSoftware: number;
}

export function usiCredenzialeDb(dbh: Database.Database, id: number): UsiCredenziale {
  const vecchie = cateneVecchieAperte(dbh);
  const apparati = dbh
    .prepare(
      `SELECT d.id AS id, d.name AS nome, u.come AS come FROM (
         SELECT device_id AS id, 'binding' AS come FROM device_credential_bindings WHERE credential_id = @id
         UNION
         SELECT id, 'colonna' FROM network_devices WHERE credential_id = @id OR snmp_credential_id = @id
       ) u JOIN network_devices d ON d.id = u.id
       ORDER BY d.id, u.come`,
    )
    .all({ id }) as UsiCredenziale["apparati"];
  const reti = dbh
    .prepare(
      `SELECT n.id AS id, n.name AS nome FROM networks n
       WHERE n.id IN (
         SELECT network_id FROM network_credentials WHERE credential_id = @id
         ${vecchie ? "UNION SELECT network_id FROM network_host_credentials WHERE credential_id = @id" : ""}
       )
       ORDER BY n.name, n.id`,
    )
    .all({ id }) as UsiCredenziale["reti"];
  const host = (
    dbh
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT host_id FROM host_credentials WHERE credential_id = @id
           ${vecchie ? "UNION SELECT host_id FROM host_detect_credential WHERE credential_id = @id" : ""}
         )`,
      )
      .get({ id }) as { n: number }
  ).n;
  const ad = dbh
    .prepare(`SELECT id, name AS nome, 'winrm' AS come FROM ad_integrations WHERE winrm_credential_id = ? ORDER BY name, id`)
    .all(id) as UsiCredenziale["ad"];
  const proxmox = (dbh.prepare(`SELECT COUNT(*) AS n FROM proxmox_hosts WHERE credential_id = ?`).get(id) as { n: number }).n;
  const scansioniSoftware = (dbh.prepare(`SELECT COUNT(*) AS n FROM software_scans WHERE credential_id = ?`).get(id) as { n: number }).n;
  return { apparati, reti, host, controller: [], ad, proxmox, scansioniSoftware };
}

/** Usi che tengono ferma la voce: tutti tranne le scansioni software passate. */
export function totaleUsi(u: UsiCredenziale): number {
  return u.apparati.length + u.reti.length + u.host + u.controller.length + u.ad.length + u.proxmox;
}

/**
 * Il totale di `totaleUsi` per ogni voce usata, in una query sola (niente N+1
 * nell'elenco della pagina). Le chiavi sono quelle di `usiCredenzialeDb`: un
 * apparato conta una volta come binding e una come colonna, una rete e un
 * host una volta sola anche se la voce ci compare in due tabelle; binding e
 * reti orfani (apparato o rete che non c'è più) non contano, come là, e
 * catene vecchie e pin contano alle stesse condizioni (`cateneVecchieAperte`).
 */
export function usiTotaliDb(dbh: Database.Database): Map<number, number> {
  const vecchie = cateneVecchieAperte(dbh);
  const righe = dbh
    .prepare(
      `SELECT credential_id AS id, COUNT(*) AS n FROM (
         SELECT 'ab:' || b.device_id AS chi, b.credential_id FROM device_credential_bindings b
           JOIN network_devices d ON d.id = b.device_id WHERE b.credential_id IS NOT NULL
         UNION
         SELECT 'ac:' || id, credential_id FROM network_devices WHERE credential_id IS NOT NULL
         UNION
         SELECT 'ac:' || id, snmp_credential_id FROM network_devices WHERE snmp_credential_id IS NOT NULL
         UNION
         SELECT 'r:' || nc.network_id, nc.credential_id FROM network_credentials nc JOIN networks n ON n.id = nc.network_id
         ${vecchie ? "UNION SELECT 'r:' || nh.network_id, nh.credential_id FROM network_host_credentials nh JOIN networks n ON n.id = nh.network_id" : ""}
         UNION
         SELECT 'h:' || host_id, credential_id FROM host_credentials
         ${vecchie ? "UNION SELECT 'h:' || host_id, credential_id FROM host_detect_credential" : ""}
         UNION
         SELECT 'ad:' || id, winrm_credential_id FROM ad_integrations WHERE winrm_credential_id IS NOT NULL
         UNION
         SELECT 'px:' || id, credential_id FROM proxmox_hosts WHERE credential_id IS NOT NULL
       )
       GROUP BY credential_id`,
    )
    .all() as Array<{ id: number; n: number }>;
  return new Map(righe.map((r) => [r.id, r.n]));
}

function elenco(nomi: string[], quanti = 3): string {
  const visti = nomi.slice(0, quanti).map((n) => `«${n}»`);
  const altri = nomi.length - visti.length;
  return altri > 0 ? `${visti.join(", ")} e altri ${altri}` : visti.join(", ");
}

/** Gli usi in una frase, per i messaggi di rifiuto. */
export function descriviUsi(u: UsiCredenziale): string {
  const parti: string[] = [];
  const nomiApparati = [...new Map(u.apparati.map((a) => [a.id, a.nome])).values()];
  if (nomiApparati.length) parti.push(`${nomiApparati.length === 1 ? "1 apparato" : `${nomiApparati.length} apparati`} (${elenco(nomiApparati)})`);
  if (u.reti.length) parti.push(`${u.reti.length === 1 ? "1 rete" : `${u.reti.length} reti`} (${elenco(u.reti.map((r) => r.nome))})`);
  if (u.host) parti.push(u.host === 1 ? "1 host" : `${u.host} host`);
  if (u.controller.length) parti.push(`${u.controller.length === 1 ? "1 controller" : `${u.controller.length} controller`} (${elenco(u.controller.map((c) => c.nome))})`);
  for (const a of u.ad) parti.push(`Active Directory «${a.nome}» (${a.come === "ldap" ? "account LDAP" : "WinRM"})`);
  if (u.proxmox) parti.push(u.proxmox === 1 ? "1 host Proxmox" : `${u.proxmox} host Proxmox`);
  return parti.join(", ");
}
