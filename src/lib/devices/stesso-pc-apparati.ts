/**
 * Un PC, un apparato, un asset (Riccardo, 23/11/2026: «se lo stesso pc cambia ip dovrebbe riaggiornare i dati
 * mantenendo lo storico, ma senza avere una moltiplicazione di oggetti»; e sugli apparati doppi: «teoricamente questo
 * capiterà di continuo comunque»).
 *
 * Sul 70791 gli «apparati automatici» del 10/11 avevano creato un apparato WinRM per ogni IP dello stesso portatile
 * (7 PC di AD con 2-3 apparati, ognuno col suo asset NIS2). Qui:
 * - `pianoApparatiPc`: per ogni PC di AD (nome del computer, unico nel dominio) gli apparati che sono lui, quale resta
 *   (quello della riga principale del gruppo, cioè la viva; poi la riga vista per ultima; poi più storia), dove va;
 * - `applicaApparatiPc`: la storia degli altri passa a quello che resta (ogni tabella collegata, con `UPDATE OR IGNORE`:
 *   dove c'è già la riga di chi resta vince la sua), gli asset si uniscono, poi i doppioni si tolgono e chi resta passa
 *   all'IP della riga principale, col suo asset. Un PC con due assegnatari diversi sugli asset si salta: è una scelta
 *   di una persona, non si decide qui;
 * - `seguiIpVivoPc`: lo stesso, dopo ogni scansione, ma lo spostamento solo verso una riga online.
 * Il tipo dell'apparato («switch») non si tocca: il CHECK della tabella non ammette «workstation» e la classificazione
 * è già giusta.
 */
import type Database from "better-sqlite3";
import { leggiClusterDiscovery } from "./cluster-discovery";

export interface PianoPc {
  pc: string;
  tieni: number;
  daUnire: number[];
  /** La riga dove deve stare l'apparato; null = è già lì. */
  verso: { hostId: number; ip: string; online: boolean } | null;
  asset: { tieni: number | null; daUnire: number[]; assegnatario: number | null };
  /** Perché questo PC non si tocca. */
  salta: string | null;
}

interface RigaApparato { id: number; name: string; host: string; host_id: number | null; riga: number | null }
interface RigaHost { id: number; ip: string; status: string | null; last_seen: string | null; nomi: string }

const corto = (n: string | null | undefined): string => (n ?? "").trim().toLowerCase().split(".")[0];

/** Le tabelle che puntano agli apparati (colonna e regola di cancellazione), dallo schema vero. */
export function tabelleCollegate(db: Database.Database): Array<{ tabella: string; colonna: string }> {
  const out: Array<{ tabella: string; colonna: string }> = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{ table: string; from: string }>) {
      if (fk.table === "network_devices" && name !== "inventory_assets") out.push({ tabella: name, colonna: fk.from });
    }
  }
  return out;
}

function storia(db: Database.Database, tabelle: ReturnType<typeof tabelleCollegate>, id: number): number {
  let n = 0;
  for (const t of tabelle) n += (db.prepare(`SELECT COUNT(*) AS n FROM "${t.tabella}" WHERE "${t.colonna}" = ?`).get(id) as { n: number }).n;
  return n;
}

export function pianoApparatiPc(db: Database.Database): PianoPc[] {
  let nomiPc: string[];
  try {
    nomiPc = (db.prepare("SELECT DISTINCT lower(replace(sam_account_name, '$', '')) AS n FROM ad_computers WHERE enabled = 1 AND COALESCE(operating_system, '') NOT LIKE '%Server%'").all() as Array<{ n: string }>).map((r) => r.n).filter((n) => n.length >= 3);
  } catch {
    return [];
  }
  if (nomiPc.length === 0) return [];
  const cl = leggiClusterDiscovery(db);
  const capo = (id: number) => cl.get(id)?.principale_host_id ?? id;
  const host = new Map<number, RigaHost>();
  const righePerNome = new Map<string, number[]>();
  for (const h of db.prepare("SELECT id, ip, status, last_seen, COALESCE(hostname, '') || '|' || COALESCE(custom_name, '') || '|' || COALESCE(dns_reverse, '') AS nomi FROM hosts").all() as RigaHost[]) {
    host.set(h.id, h);
    for (const n of new Set(h.nomi.split("|").map(corto))) if (n) (righePerNome.get(n) ?? righePerNome.set(n, []).get(n)!).push(h.id);
  }
  const perIp = new Map<string, number>();
  for (const h of host.values()) if (!perIp.has(h.ip)) perIp.set(h.ip, h.id);
  const apparati = (db.prepare("SELECT id, name, host, host_id FROM network_devices").all() as Array<Omit<RigaApparato, "riga">>)
    .map((a) => ({ ...a, riga: a.host_id ?? perIp.get(a.host) ?? null }));
  const tabelle = tabelleCollegate(db);
  const assetDi = db.prepare("SELECT id, asset_assignee_id AS assegnatario FROM inventory_assets WHERE network_device_id = ? ORDER BY id");

  const piani: PianoPc[] = [];
  for (const pc of nomiPc) {
    // Le righe del PC: quelle col suo nome e tutte quelle del loro gruppo.
    const righe = new Set<number>();
    for (const id of righePerNome.get(pc) ?? []) {
      const c = capo(id);
      righe.add(c);
      for (const [m, info] of cl) if (info.principale_host_id === c) righe.add(m);
      righe.add(id);
    }
    const suoi = apparati.filter((a) => corto(a.name) === pc || (a.riga !== null && righe.has(a.riga)));
    if (suoi.length === 0 || righe.size === 0) continue;
    // La riga principale: quella del gruppo; senza gruppo, la riga col nome vista per ultima.
    const principale = [...righe].map((id) => host.get(id)).filter((h): h is RigaHost => !!h)
      .sort((a, b) => Number(capo(b.id) === b.id && cl.has(b.id)) - Number(capo(a.id) === a.id && cl.has(a.id))
        || Number(b.status === "online") - Number(a.status === "online")
        || (b.last_seen ?? "").localeCompare(a.last_seen ?? ""))[0];
    if (!principale) continue;
    const vistaDi = (a: RigaApparato) => (a.riga !== null ? host.get(a.riga)?.last_seen ?? "" : "");
    const ordinati = [...suoi].sort((a, b) =>
      Number(b.riga === principale.id) - Number(a.riga === principale.id)
      || vistaDi(b).localeCompare(vistaDi(a))
      || storia(db, tabelle, b.id) - storia(db, tabelle, a.id)
      || a.id - b.id);
    const tieni = ordinati[0];
    const daUnire = ordinati.slice(1).map((a) => a.id);
    const verso = tieni.riga === principale.id && tieni.host === principale.ip
      ? null
      : { hostId: principale.id, ip: principale.ip, online: principale.status === "online" };
    if (daUnire.length === 0 && verso === null) continue;

    const assetTieni = assetDi.all(tieni.id) as Array<{ id: number; assegnatario: number | null }>;
    const assetAltri = daUnire.flatMap((id) => assetDi.all(id) as Array<{ id: number; assegnatario: number | null }>);
    const tutti = [...assetTieni, ...assetAltri];
    const assegnatari = new Set(tutti.map((a) => a.assegnatario).filter((x): x is number => x !== null));
    const assetTenuto = tutti[0]?.id ?? null;
    let salta: string | null = null;
    if (assegnatari.size > 1) salta = "gli asset hanno assegnatari diversi: va scelto a mano";
    const altroSullIp = verso ? apparati.find((a) => a.host === verso.ip && !suoi.some((s) => s.id === a.id)) : undefined;
    if (!salta && altroSullIp) salta = `all'IP ${verso!.ip} c'è già l'apparato #${altroSullIp.id} (${altroSullIp.name})`;
    piani.push({
      pc, tieni: tieni.id, daUnire, verso,
      asset: { tieni: assetTenuto, daUnire: tutti.slice(1).map((a) => a.id), assegnatario: [...assegnatari][0] ?? null },
      salta,
    });
  }
  return piani;
}

export interface EsitoApparatiPc { uniti: number; spostati: number; assetUniti: number; saltati: Array<{ pc: string; motivo: string }> }

/**
 * Applica i piani, uno per transazione. `soloVersoOnline`: lo spostamento si fa solo verso una riga viva (il giro dopo
 * ogni scansione); l'unione dei doppioni si fa comunque, perché non dipende da dove sta il PC adesso.
 */
export function applicaApparatiPc(db: Database.Database, piani: readonly PianoPc[], utente: number | null, opz: { soloVersoOnline?: boolean } = {}): EsitoApparatiPc {
  const esito: EsitoApparatiPc = { uniti: 0, spostati: 0, assetUniti: 0, saltati: [] };
  const tabelle = tabelleCollegate(db);
  const assetFigli: Array<{ tabella: string; colonna: string }> = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>) {
    for (const fk of db.prepare(`PRAGMA foreign_key_list("${name}")`).all() as Array<{ table: string; from: string }>) {
      if (fk.table === "inventory_assets") assetFigli.push({ tabella: name, colonna: fk.from });
    }
  }
  const audit = db.prepare("INSERT INTO inventory_audit_log (asset_id, user_id, action, field_name, old_value, new_value) VALUES (?, ?, 'update', ?, ?, ?)");
  for (const p of piani) {
    if (p.salta) { esito.saltati.push({ pc: p.pc, motivo: p.salta }); continue; }
    const sposta = p.verso && (!opz.soloVersoOnline || p.verso.online) ? p.verso : null;
    if (p.daUnire.length === 0 && !sposta) continue;
    db.transaction(() => {
      // 1. La storia dei doppioni passa a chi resta; dove chi resta ha già la sua riga, resta la sua.
      for (const id of p.daUnire) {
        for (const t of tabelle) db.prepare(`UPDATE OR IGNORE "${t.tabella}" SET "${t.colonna}" = ? WHERE "${t.colonna}" = ?`).run(p.tieni, id);
      }
      // 2. Gli asset: ne resta uno, legato a chi resta, con l'assegnatario; gli altri passano la loro storia e vanno.
      if (p.asset.tieni !== null) {
        db.prepare("UPDATE inventory_assets SET network_device_id = ?, asset_assignee_id = COALESCE(asset_assignee_id, ?), updated_at = datetime('now') WHERE id = ?")
          .run(p.tieni, p.asset.assegnatario, p.asset.tieni);
        for (const a of p.asset.daUnire) {
          for (const t of assetFigli) db.prepare(`UPDATE OR IGNORE "${t.tabella}" SET "${t.colonna}" = ? WHERE "${t.colonna}" = ?`).run(p.asset.tieni, a);
          db.prepare("DELETE FROM inventory_assets WHERE id = ?").run(a);
          audit.run(p.asset.tieni, utente, "unione", `asset #${a}`, `stesso PC ${p.pc}`);
          esito.assetUniti++;
        }
      }
      // 3. Via i doppioni (quello che non è passato se ne va in cascata).
      for (const id of p.daUnire) {
        db.prepare("DELETE FROM network_devices WHERE id = ?").run(id);
        esito.uniti++;
      }
      // 4. Chi resta segue il PC sulla riga principale, col suo asset.
      if (sposta) {
        const prima = db.prepare("SELECT host FROM network_devices WHERE id = ?").get(p.tieni) as { host: string };
        db.prepare("UPDATE network_devices SET host = ?, host_id = ?, updated_at = datetime('now') WHERE id = ?").run(sposta.ip, sposta.hostId, p.tieni);
        if (p.asset.tieni !== null) {
          db.prepare("UPDATE inventory_assets SET host_id = ?, ip_address = ?, updated_at = datetime('now') WHERE id = ?").run(sposta.hostId, sposta.ip, p.asset.tieni);
          audit.run(p.asset.tieni, utente, "ip_address", prima.host, sposta.ip);
        }
        esito.spostati++;
      }
    })();
  }
  return esito;
}

/** Il giro dopo ogni scansione: unisce i doppioni e sposta l'apparato solo verso una riga viva. */
export function seguiIpVivoPc(db: Database.Database): EsitoApparatiPc {
  return applicaApparatiPc(db, pianoApparatiPc(db), null, { soloVersoOnline: true });
}
