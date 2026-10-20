/**
 * Carica dal DB del tenant gli host per la pulizia (piano 2026-10-20, Task 2): le regole stanno nel modulo
 * puro `pulizia.ts`, qui solo la lettura e le esclusioni.
 *
 * Decisione 2 di Riccardo del 20/10: non si archivia mai un host legato a qualcosa che una persona ha scritto.
 * Il legame lo calcola un `CASE` in SQL, nell'ordine della decisione (vale il primo): apparato
 * (`network_devices.host_id`), monitorato (`known_host`), nome scritto a mano (`custom_name` non vuoto),
 * asset (`inventory_assets.host_id`), credenziali (`host_credentials`), unione a mano (riga attiva di
 * `topology_unioni` con `membro = 'host:<id>'`, la forma di `topology/node-index.ts`), gruppo multihomed
 * (`multihomed_links`). `notes` non esclude: sull'hub è piena su tutti gli assenti, testo automatico.
 *
 * Dopo quelle, tre esclusioni della revisione finale (decisione del controllore del 20/10, per prudenza):
 * - «recuperato a mano»: l'host è il `nuovo_host_id` di una riga di `hosts_archivio`. Torna offline con la
 *   `last_seen` di prima, e senza questo segno il giro dopo lo riarchivierebbe: chi l'ha recuperato ha già deciso.
 *   La riga recuperata resta finché l'host esiste (`cancellaArchivioScaduto`);
 * - «classificazione a mano» (`classification_manual = 1`): il vecchio cleanup la proteggeva, è una scelta scritta
 *   da una persona;
 * - «sessioni remote registrate» (righe in `mc_remote_session` o `mc_command_log`): sono registri di chi ha fatto
 *   cosa su quell'host, e cancellando l'host le righe se ne andrebbero in CASCADE. I registri non si cancellano.
 *
 * Una tabella di legame che manca (DB vecchio) non diventa «nessun legame»: si controlla `sqlite_master`
 * prima della lettura e si lancia un errore che la nomina. Un host del cliente cancellato perché la tabella
 * che lo proteggeva non c'era non si vede da nessuna parte.
 *
 * Lavora sul DB del tenant del contesto (`dbCorrente`, `withTenant`); senza contesto lancia, mai ripieghi su DEFAULT.
 * Non importa `pulizia-archivio.ts` (è lui a importare questo modulo, per «Applica» e per il job).
 */
import type Database from "better-sqlite3";
import { dbCorrente } from "@/lib/hosts/db-corrente";
import { selezionaCandidati, type EsitoSelezione, type HostPerPulizia } from "@/lib/hosts/pulizia";

/** Le tabelle che servono alle esclusioni (oltre a `hosts`). */
const TABELLE_DI_LEGAME = [
  "network_devices", "inventory_assets", "host_credentials", "topology_unioni", "multihomed_links",
  "hosts_archivio", "mc_remote_session", "mc_command_log",
] as const;

function controllaTabelle(d: Database.Database): void {
  const presenti = new Set(
    (d.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${TABELLE_DI_LEGAME.map(() => "?").join(", ")})`)
      .all(...TABELLE_DI_LEGAME) as Array<{ name: string }>).map((r) => r.name),
  );
  const mancanti = TABELLE_DI_LEGAME.filter((t) => !presenti.has(t));
  if (mancanti.length > 0) {
    throw new Error(`Pulizia degli host: nel DB del tenant mancano le tabelle di legame ${mancanti.join(", ")}; `
      + "senza non si sa quali host escludere, e non si archivia niente");
  }
}

interface RigaHost {
  id: number;
  network_id: number;
  ip: string;
  mac: string | null;
  nome: string;
  status: HostPerPulizia["status"];
  last_seen: string | null;
  first_seen: string | null;
  created_at: string | null;
  escluso: string | null;
}

export function caricaHostPerPulizia(): HostPerPulizia[] {
  const d = dbCorrente();
  controllaTabelle(d);
  const righe = d.prepare(`
    SELECT h.id, h.network_id, h.ip, h.mac,
      COALESCE(NULLIF(TRIM(h.custom_name), ''), NULLIF(TRIM(h.hostname), ''), NULLIF(TRIM(h.dns_reverse), ''), h.ip) AS nome,
      COALESCE(h.status, 'unknown') AS status,
      h.last_seen, h.first_seen, h.created_at,
      CASE
        WHEN EXISTS (SELECT 1 FROM network_devices nd WHERE nd.host_id = h.id) THEN 'apparato'
        WHEN COALESCE(h.known_host, 0) <> 0 THEN 'monitorato'
        WHEN TRIM(COALESCE(h.custom_name, '')) <> '' THEN 'nome scritto a mano'
        WHEN EXISTS (SELECT 1 FROM inventory_assets ia WHERE ia.host_id = h.id) THEN 'asset'
        WHEN EXISTS (SELECT 1 FROM host_credentials hc WHERE hc.host_id = h.id) THEN 'credenziali'
        WHEN EXISTS (SELECT 1 FROM topology_unioni tu WHERE tu.membro = 'host:' || h.id AND tu.tolto_il IS NULL) THEN 'unione a mano'
        WHEN EXISTS (SELECT 1 FROM multihomed_links ml WHERE ml.host_id = h.id) THEN 'gruppo multihomed'
        WHEN EXISTS (SELECT 1 FROM hosts_archivio a WHERE a.nuovo_host_id = h.id) THEN 'recuperato a mano'
        WHEN COALESCE(h.classification_manual, 0) = 1 THEN 'classificazione a mano'
        WHEN EXISTS (SELECT 1 FROM mc_remote_session rs WHERE rs.host_id = h.id)
          OR EXISTS (SELECT 1 FROM mc_command_log cl WHERE cl.host_id = h.id) THEN 'sessioni remote registrate'
        ELSE NULL
      END AS escluso
    FROM hosts h
  `).all() as RigaHost[];
  return righe.map((r) => ({
    id: r.id, networkId: r.network_id, ip: r.ip, mac: r.mac, nome: r.nome, status: r.status,
    lastSeen: r.last_seen, firstSeen: r.first_seen, createdAt: r.created_at, escluso: r.escluso,
  }));
}

/** Anteprima, «Applica» e job: le regole di `pulizia.ts` sugli host del tenant del contesto. */
export function candidatiPulizia(adesso: Date = new Date()): EsitoSelezione {
  return selezionaCandidati(caricaHostPerPulizia(), adesso);
}
