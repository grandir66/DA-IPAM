import type Database from "better-sqlite3";
import { DDL_NETWORK_CHANGES } from "@/lib/db-tenant-schema";
import { confrontaGiriRete, type EventoConfrontoGiri, type StatoGiroRete } from "./confronto-giri";

const DURATA_STORICO_MS = 90 * 24 * 60 * 60 * 1000;
const DIMENSIONE_PAGINA = 50;

interface RigaBaseline {
  scan_id: string;
  finished_ms: number;
  snapshot_json: string;
}

export interface CambioRete {
  id: number;
  network_id: number;
  nome_rete: string;
  cidr: string;
  finished_ms: number;
  kind: EventoConfrontoGiri["tipo"];
  ip: string;
  before_value: string | null;
  after_value: string;
}

export function registraGiroRete(db: Database.Database, giro: StatoGiroRete) {
  if (giro.esito !== "riuscito" || !giro.id || !giro.tenant || !giro.perimetro || !Number.isFinite(giro.fineMs)) return;

  db.transaction(() => {
    db.exec(DDL_NETWORK_CHANGES);
    const dal = giro.fineMs - DURATA_STORICO_MS;
    const precedente = db.prepare(`
      SELECT scan_id, finished_ms, snapshot_json FROM network_change_baselines WHERE network_id = ? AND scope = ?
    `).get(giro.reteId, giro.perimetro) as RigaBaseline | undefined;
    if (precedente && (precedente.scan_id === giro.id || precedente.finished_ms >= giro.fineMs)) return;

    let confrontato = false;
    if (precedente && precedente.finished_ms >= dal) {
      let prima: StatoGiroRete;
      try {
        prima = JSON.parse(precedente.snapshot_json) as StatoGiroRete;
      } catch (error) {
        throw new Error("Baseline Network Changes non leggibile", { cause: error });
      }
      const esito = confrontaGiriRete(prima, giro);
      if (esito.stato !== "confrontabile") return;
      confrontato = true;
      const inserisci = db.prepare(`
        INSERT INTO network_changes
          (network_id, scan_id, previous_scan_id, finished_ms, kind, ip, before_value, after_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const evento of esito.eventi) {
        const prima = evento.tipo === "mac_cambiato" ? evento.prima : null;
        const dopo = evento.tipo === "mac_cambiato" ? evento.dopo :
          evento.tipo === "host_nuovo" ? evento.mac : `${evento.porta}/${evento.protocollo}`;
        inserisci.run(giro.reteId, giro.id, precedente.scan_id, giro.fineMs, evento.tipo, evento.ip, prima, dopo);
      }
    }

    db.prepare(`
      INSERT INTO network_change_baselines (network_id, scope, scan_id, finished_ms, compared, snapshot_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (network_id, scope) DO UPDATE SET scan_id = excluded.scan_id,
        finished_ms = excluded.finished_ms, compared = excluded.compared, snapshot_json = excluded.snapshot_json
    `).run(giro.reteId, giro.perimetro, giro.id, giro.fineMs, Number(confrontato), JSON.stringify(giro));
    db.prepare("DELETE FROM network_change_baselines WHERE finished_ms < ?").run(dal);
    db.prepare("DELETE FROM network_changes WHERE finished_ms < ?").run(dal);
  }).immediate();
}

export function leggiCambiRete(db: Database.Database, pagina: number, reteId?: number, adesso = Date.now()) {
  const dal = adesso - DURATA_STORICO_MS;
  const tabellePresenti = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'network_changes'").get();
  const reti = db.prepare("SELECT id, name, cidr FROM networks ORDER BY name, id").all() as
    Array<{ id: number; name: string; cidr: string }>;
  if (!tabellePresenti) return { reti, righe: [] as CambioRete[], successiva: false, confrontato: false };

  const filtroRete = reteId === undefined ? "" : " AND c.network_id = ?";
  const parametri = reteId === undefined ? [dal] : [dal, reteId];
  const righe = db.prepare(`
    SELECT c.id, c.network_id, n.name AS nome_rete, n.cidr, c.finished_ms, c.kind, c.ip, c.before_value, c.after_value
    FROM network_changes c JOIN networks n ON n.id = c.network_id
    WHERE c.finished_ms >= ?${filtroRete}
    ORDER BY c.finished_ms DESC, c.id DESC LIMIT ? OFFSET ?
  `).all(...parametri, DIMENSIONE_PAGINA + 1, (pagina - 1) * DIMENSIONE_PAGINA) as CambioRete[];
  const confrontato = !!db.prepare(`
    SELECT 1 FROM network_change_baselines c WHERE finished_ms >= ?${filtroRete} AND compared = 1 LIMIT 1
  `).get(...parametri);
  return { reti, righe: righe.slice(0, DIMENSIONE_PAGINA), successiva: righe.length > DIMENSIONE_PAGINA, confrontato };
}
