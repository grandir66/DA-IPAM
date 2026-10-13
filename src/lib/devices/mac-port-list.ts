/**
 * Elenco (MAC, porta) dai MAC che la lettura SNMP/SSH ha già raggruppato per
 * porta: prima per ifIndex, poi per nome normalizzato (stessa regola del
 * calcolo di mac_count in cron/jobs.ts). Prima si contava e si buttava
 * l'elenco; ora si salva (spec §10.5). Logica pura.
 */
export function macPortListFromPorts(
  ports: Array<{ port_index: number; port_name: string }>,
  byIndex: Map<number, { macs: string[] }>,
  byName: Map<string, { macs: string[] }>,
  normalize: (s: string) => string,
): Array<{ mac: string; port_name: string }> {
  const out: Array<{ mac: string; port_name: string }> = [];
  for (const p of ports) {
    const name = p.port_name.trim();
    const found = byIndex.get(p.port_index) ?? byName.get(normalize(name));
    for (const mac of new Set(found?.macs ?? [])) out.push({ mac, port_name: name });
  }
  return out;
}
