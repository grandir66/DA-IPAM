/**
 * Scelta dei bersagli: max 40 per cella, prima i servizi di gestione.
 * Run: node --import tsx --test src/lib/segmentazione/__tests__/bersagli.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { conteggiRetiBersaglio, prioritaPorta, sorgentiConBersagli, TETTO_CELLA } from "../bersagli";
import { avviaGiroSeg, statoGiroSeg } from "../giro";
import { celleMatrice, conteggiSegmentazione } from "../db";
import type { GiroRaggiungibilita } from "@/lib/trunk/sensore-trunk";

const T = "PROVASEG";

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("gestione prima delle altre porte", () => {
  assert.ok(prioritaPorta(22) < prioritaPorta(3306));
  assert.ok(prioritaPorta(8291) < prioritaPorta(80));
});

test("max 40 per cella, prima i servizi di gestione; il giro finto riempie la matrice", async () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const a = Number(d.prepare("INSERT INTO networks (cidr, name, vlan_id, gateway) VALUES ('10.10.0.0/24', 'vlan10', 10, '10.10.0.1')").run().lastInsertRowid);
    const b = Number(d.prepare("INSERT INTO networks (cidr, name, vlan_id, gateway) VALUES ('10.20.0.0/24', 'vlan20', 20, '10.20.0.1')").run().lastInsertRowid);
    const ha = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.10.0.5', 'online')").run(a).lastInsertRowid);
    const hb = Number(d.prepare("INSERT INTO hosts (network_id, ip, status) VALUES (?, '10.20.0.8', 'online')").run(b).lastInsertRowid);
    const ins = d.prepare("INSERT INTO servizi_rete (host_id, porta, protocollo) VALUES (?, ?, 'tcp')");
    ins.run(ha, 22);
    for (let p = 2000; p < 2060; p++) ins.run(hb, p);
    ins.run(hb, 443);
    ins.run(hb, 8291);
    const s = sorgentiConBersagli(d);
    assert.equal(s.length, 2);
    const da10 = s.find((x) => x.vlan === 10)!;
    assert.equal(da10.gateway, "10.10.0.1");
    assert.ok(da10.bersagli.length <= TETTO_CELLA);
    assert.equal(da10.bersagli[0]!.porta, 443);
    assert.equal(da10.bersagli[1]!.porta, 8291);
    assert.ok(!da10.bersagli.some((x) => x.porta === 2059), "le porte alte oltre il tetto restano fuori");
  });

  const client = {
    avvia: async () => ({ id: 1, fonte: "socket" as const }),
    leggi: async (): Promise<GiroRaggiungibilita> => ({
      id: 1,
      esito: "ok",
      errore: null,
      fine: "2026-11-09T00:00:00Z",
      esiti: [
        { ip: "10.20.0.8", porta: 443, esito: "raggiunto" },
        { ip: "10.20.0.8", porta: 8291, esito: "chiuso" },
      ],
    }),
  };
  assert.equal(avviaGiroSeg(T, client), true);
  for (let i = 0; i < 100 && statoGiroSeg(T).inCorso; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(statoGiroSeg(T).errore, null);
  withTenant(T, () => {
    const d = getTenantDb(T);
    const c = conteggiSegmentazione(d);
    assert.ok(c.raggiunti >= 1);
    const celle = celleMatrice(d);
    const cella = celle.find((x) => x.nome_sorgente === "vlan10" && x.nome_bersaglio === "vlan20");
    assert.ok(cella);
    assert.equal(cella.raggiunti, 1);
    assert.equal(cella.chiusi, 1);
    const n = conteggiRetiBersaglio(d);
    const v10 = n.find((x) => x.name === "vlan10");
    assert.equal(v10?.host, 1);
    assert.equal(v10?.servizi, 1);
  });

  const ids = withTenant(T, () => {
    const d = getTenantDb(T);
    const rows = d.prepare("SELECT id, vlan_id FROM networks").all() as Array<{ id: number; vlan_id: number }>;
    return { a: rows.find((x) => x.vlan_id === 10)!.id, b: rows.find((x) => x.vlan_id === 20)!.id };
  });
  let vlan = 0;
  let ips: string[] = [];
  assert.equal(
    avviaGiroSeg(
      T,
      {
        avvia: async (vid, _c, _g, b) => {
          vlan = vid;
          ips = [...new Set(b.map((x) => x.ip))];
          return { id: 2, fonte: "socket" as const };
        },
        leggi: async (): Promise<GiroRaggiungibilita> => ({
          id: 2,
          esito: "ok",
          errore: null,
          fine: "2026-11-10T00:00:00Z",
          esiti: [{ ip: "10.20.0.8", porta: 443, esito: "raggiunto" }],
        }),
      },
      { sourceNetworkId: ids.a, retiBersaglio: [ids.b] },
    ),
    true,
  );
  for (let i = 0; i < 100 && statoGiroSeg(T).inCorso; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(statoGiroSeg(T).errore, null);
  assert.equal(vlan, 10);
  assert.deepEqual(ips, ["10.20.0.8"]);
});
