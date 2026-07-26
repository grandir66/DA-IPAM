// Golden set export — estrae AttributionSignals da una COPIA locale del DB tenant.
// CRUCIALE: mai da produzione live. Input da copia locale o /var/tmp backup.
//
// Uso: npx tsx scripts/attribution-golden-export.ts data/tenants/70791.db > src/lib/attribution/__tests__/golden/hosts.json
// Output → AttributionSignals[] con snmp_data sanitizzata (credenziali rimosse).
//
// ATTENZIONE privacy: il file esportato contiene IP e hostname reali. Valutare
// anonimizzazione (rimappare su 10.x.x.x) prima del commit se necessario.
//
import Database from "better-sqlite3";

const dbPath = process.argv[2];
if (!dbPath) {
  console.error("Uso: npx tsx scripts/attribution-golden-export.ts <path-db-tenant> [limit]");
  process.exit(1);
}
const limit = Number(process.argv[3] ?? 50);
const db = new Database(dbPath, { readonly: true });

const hosts = db.prepare(
  `SELECT id, ip, mac, vendor, hostname, os_info, open_ports, snmp_data, detection_json
   FROM hosts
   ORDER BY (snmp_data IS NOT NULL) DESC, (os_info IS NOT NULL) DESC, id
   LIMIT ?`
).all(limit) as Array<Record<string, unknown> & { id: number; ip: string; mac: string | null }>;

const out = hosts.map((h) => {
  const adComputer = db.prepare(
    "SELECT operating_system, operating_system_version FROM ad_computers WHERE host_id = ? LIMIT 1"
  ).get(h.id) ?? null;
  const wazuh = db.prepare(
    `SELECT wo.os_platform, wo.os_name, wo.os_version, wh.board_vendor
     FROM wazuh_agent wa
     LEFT JOIN wazuh_os wo ON wo.agent_id = wa.agent_id
     LEFT JOIN wazuh_hw wh ON wh.agent_id = wa.agent_id
     WHERE wa.host_id = ? LIMIT 1`
  ).get(h.id) ?? null;
  const neighborSightings = db.prepare(
    `SELECT protocol, remote_platform, remote_device_name FROM device_neighbors
     WHERE (remote_mac IS NOT NULL AND remote_mac = ?) OR (remote_ip IS NOT NULL AND remote_ip = ?)
     LIMIT 5`
  ).all(h.mac, h.ip);

  // Sanitizzazione: rimuovere la chiave 'community' da snmp_data
  let sanitizedSnmpData = h.snmp_data;
  if (typeof h.snmp_data === "string") {
    try {
      const parsed = JSON.parse(h.snmp_data);
      if (typeof parsed === "object" && parsed !== null && "community" in parsed) {
        delete parsed.community;
        sanitizedSnmpData = JSON.stringify(parsed);
      }
    } catch {
      // Dato malformato: redaction totale per evitare credenziali nel JSON
      console.warn(`[WARN] host id=${h.id}: snmp_data non parsabile, redaction totale`);
      sanitizedSnmpData = null;
    }
  }

  const { id, ...hostFields } = h;
  return {
    host: { id, ...hostFields, snmp_data: sanitizedSnmpData },
    adComputer,
    wazuh,
    neighborSightings,
  };
});

console.log(JSON.stringify(out, null, 2));
