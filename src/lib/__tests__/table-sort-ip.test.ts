/**
 * Ordinamenti delle liste paginate dal server (difetto UI-9, analisi 2026-10-12):
 * - IP e CIDR ordinati come testo ("10.0.0.10" prima di "10.0.0.2");
 * - colonne cliccabili non ammesse dall'API, che ricadeva in silenzio su un'altra
 *   ("Ultimo visto" del DHCP ordinava per "Ultimo sync");
 * - nessuno spareggio: a valori uguali le righe saltavano o si ripetevano fra pagine.
 * Gira su un tenant temporaneo: lanciare con DA_INVENT_DATA_DIR di prova.
 */
process.env.ENCRYPTION_KEY ||= "test-encryption-key-table-sort-ip";

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ipSortKey, sqlOrderByDhcpLeases, sqlOrderByNetworks, DHCP_LEASE_SORT_KEYS, NETWORK_SORT_KEYS } from "../table-sort";
import { withTenant, getTenantDb, deleteTenantDatabase } from "../db-tenant";

const T = "TESTTABLESORTIP";
after(() => deleteTenantDatabase(T));

function colonneDellaPagina(file: string): string[] {
  const src = readFileSync(join(process.cwd(), file), "utf8");
  return [...src.matchAll(/<SortableTableHead\s+columnId="([a-z_]+)"/g)].map((m) => m[1]);
}

describe("ordinamenti delle liste", () => {
  it("IP e CIDR in ordine numerico", () => {
    assert.ok(ipSortKey("10.0.0.2")! < ipSortKey("10.0.0.10")!);
    assert.ok(ipSortKey("10.0.2.0/24")! < ipSortKey("10.0.10.0/24")!);
    assert.ok(ipSortKey("10.0.0.0/16")! < ipSortKey("10.0.0.0/24")!);
    assert.equal(ipSortKey("router.local"), null);
    assert.equal(ipSortKey(null), null);
  });

  it("ogni colonna cliccabile della pagina DHCP e della lista subnet è ammessa dall'API", () => {
    for (const c of colonneDellaPagina("src/app/(dashboard)/dhcp/sources/page.tsx")) {
      assert.ok(DHCP_LEASE_SORT_KEYS.includes(c), `DHCP: colonna "${c}" non ammessa dall'ordinamento SQL`);
    }
    for (const c of colonneDellaPagina("src/app/(dashboard)/networks/networks-list-client.tsx")) {
      assert.ok(NETWORK_SORT_KEYS.includes(c), `Subnet: colonna "${c}" non ammessa dall'ordinamento SQL`);
    }
  });

  it("sul database: CIDR in ordine numerico, spareggio stabile sull'id", () => {
    withTenant(T, () => {
      const db = getTenantDb(T);
      for (const cidr of ["10.0.10.0/24", "10.0.2.0/24", "10.0.1.0/24"]) {
        db.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(cidr, "stesso nome");
      }
      const perCidr = db.prepare(`SELECT n.cidr FROM networks n ORDER BY ${sqlOrderByNetworks("cidr", "asc")}`).all() as { cidr: string }[];
      assert.deepEqual(perCidr.map((r) => r.cidr), ["10.0.1.0/24", "10.0.2.0/24", "10.0.10.0/24"]);
      const perNome = db.prepare(`SELECT n.id FROM networks n ORDER BY ${sqlOrderByNetworks("name", "asc")}`).all() as { id: number }[];
      assert.deepEqual(perNome.map((r) => r.id), [...perNome.map((r) => r.id)].sort((a, b) => a - b));
      assert.match(sqlOrderByDhcpLeases("last_seen", "desc"), /last_seen/);
    });
  });
});
