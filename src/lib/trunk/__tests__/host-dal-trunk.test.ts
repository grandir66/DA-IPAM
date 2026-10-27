/**
 * Host e MAC delle reti con VLAN dal sensore trunk (27/10/2026, mini PC dimostrativo 72729-ipam):
 * le reti aggiunte dal trunk restavano senza host e, nelle VLAN senza ARP del router, senza MAC.
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/host-dal-trunk.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, setTenantSetting, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { portaHostDalTrunk } from "@/lib/trunk/host-dal-trunk";
import { aggiungiReteDalTrunk } from "@/lib/trunk/aggiungi-rete";
import { sincronizzaTrunk, type TrunkOsservazione } from "@/lib/trunk/sensore-trunk";

const T = "TRUNKHOST27";
const ORA = "2026-10-27T10:00:00";
const ADESSO = new Date("2026-10-27T12:00:00Z");

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

function osserva(vid: number, mac: string, ip: string, nome: string | null = null, vista = ORA) {
  getTenantDb(T).prepare(
    `INSERT INTO trunk_osservazioni (vid, mac_normalized, mac_display, ip, nome, prima_vista, ultima_vista)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(vid, mac.replace(/:/g, "").toUpperCase(), mac.toUpperCase(), ip, nome, vista, vista);
}

const host = (rete: number) => getTenantDb(T).prepare(
  "SELECT ip, mac, hostname FROM hosts WHERE network_id = ? ORDER BY ip",
).all(rete) as Array<{ ip: string; mac: string | null; hostname: string | null }>;

test("rete con VLAN: host nuovi dal trunk, MAC mancanti compilati, MAC esistenti intatti", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const r5 = Number(d.prepare("INSERT INTO networks (cidr, name, vlan_id) VALUES ('10.5.0.0/24', 'v5', 5)").run().lastInsertRowid);
    const nativa = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.6.0.0/24', 'nativa')").run().lastInsertRowid);
    d.prepare("INSERT INTO hosts (network_id, ip) VALUES (?, '10.5.0.10')").run(r5);
    d.prepare("INSERT INTO hosts (network_id, ip, mac) VALUES (?, '10.5.0.11', 'AA:AA:AA:00:00:11')").run(r5);
    osserva(5, "02:00:00:00:00:10", "10.5.0.10", "stampante");
    osserva(5, "02:00:00:00:00:99", "10.5.0.11");            // il router dice altro: resta il suo
    osserva(5, "02:00:00:00:00:12", "10.5.0.12", "nas");
    osserva(5, "02:00:00:00:00:77", "10.5.0.12", null, "2026-10-20T10:00:00");   // più vecchia: no
    osserva(7, "02:00:00:00:00:13", "10.5.0.13");            // altra VLAN: no
    osserva(5, "02:00:00:00:00:14", "10.9.0.14");            // fuori rete: no
    osserva(5, "02:00:00:00:00:15", "10.5.0.15", null, "2026-08-01T10:00:00");   // vecchia: no
    osserva(0, "02:00:00:00:00:16", "10.6.0.16");            // senza tag: va alla rete senza VLAN
    osserva(5, "02:00:00:00:00:17", "10.6.0.17");            // con tag: non è della rete senza VLAN

    const e = portaHostDalTrunk({ adesso: ADESSO });
    assert.deepEqual(e, { creati: 2, mac: 1 });
    assert.deepEqual(host(r5), [
      { ip: "10.5.0.10", mac: "02:00:00:00:00:10", hostname: "stampante" },
      { ip: "10.5.0.11", mac: "AA:AA:AA:00:00:11", hostname: null },
      { ip: "10.5.0.12", mac: "02:00:00:00:00:12", hostname: "nas" },
    ]);
    assert.deepEqual(host(nativa), [{ ip: "10.6.0.16", mac: "02:00:00:00:00:16", hostname: null }]);
    assert.deepEqual(portaHostDalTrunk({ adesso: ADESSO }), { creati: 0, mac: 0 }, "un secondo giro non cambia niente");
  });
});

test("la lettura del trunk porta gli host nelle reti con VLAN", async () => {
  await withTenant(T, async () => {
    const d = getTenantDb(T);
    const r8 = Number(d.prepare("INSERT INTO networks (cidr, name, vlan_id) VALUES ('10.8.0.0/24', 'v8', 8)").run().lastInsertRowid);
    setTenantSetting("trunk_lettura", "1");
    const vista = new Date().toISOString().slice(0, 19);
    const oss: TrunkOsservazione[] = [{ id: 1, vid: 8, mac: "02:00:00:00:08:01", ip: "10.8.0.21", nome: "cam", fonte_nome: null, passivo: true, attivo: false, prima_vista: vista, ultima_vista: vista }];
    const leggi = (async (p: string) => {
      if (p === "/vlan") return { vlan: [] };
      if (p === "/osservazioni") return { osservazioni: oss, prossimo: null };
      if (p === "/vicini") return { vicini: [] };
      return {};
    }) as never;
    await sincronizzaTrunk({ fonte: "socket", leggi });
    assert.deepEqual(host(r8).map((h) => [h.ip, h.mac]), [["10.8.0.21", "02:00:00:00:08:01"]]);
  });
});

test("Aggiungi: rete, poi giro ARP col VID, attesa della sonda, lettura e host", async () => {
  await withTenant(T, async () => {
    setTenantSetting("trunk_lettura", "1");
    const passi: string[] = [];
    let stati = 0;
    const vista = new Date().toISOString().slice(0, 19);
    const lettore = {
      fonte: "socket" as const,
      leggi: (async (p: string) => {
        if (p === "/stato") { stati++; return { giro_in_corso: stati < 2 }; }
        return {};
      }) as never,
    };
    const e = await aggiungiReteDalTrunk({ vid: 9, cidr: "10.10.9.0/24" }, {
      giro: async (vid, cidr) => { passi.push(`giro ${vid} ${cidr}`); return { id: 1, fonte: "socket" }; },
      lettore: async () => lettore,
      sincronizza: async () => {
        passi.push("lettura");
        osserva(9, "02:00:00:00:09:01", "10.10.9.5", "pc", vista);
        return { osservazioni: 1, vlan: 1 };
      },
      attesaMs: 1_000, passoMs: 1, scritturaMs: 0,
    });
    assert.deepEqual(passi, ["giro 9 10.10.9.0/24", "lettura"]);
    assert.equal(stati, 2, "aspetta che la sonda finisca il giro");
    assert.equal(e.rete.vlan_id, 9);
    assert.equal(e.giro, "giro ARP fatto");
    assert.deepEqual(e.host, { creati: 1, mac: 0 });
    assert.deepEqual(host(e.rete.id).map((h) => [h.ip, h.mac, h.hostname]), [["10.10.9.5", "02:00:00:00:09:01", "pc"]]);
  });
});

test("Aggiungi: sonda che non risponde, la rete entra lo stesso", async () => {
  await withTenant(T, async () => {
    setTenantSetting("trunk_lettura", "1");
    const e = await aggiungiReteDalTrunk({ vid: 11, cidr: "10.11.0.0/24" }, {
      giro: async () => { throw new Error("socket assente"); },
      attesaMs: 1, passoMs: 1, scritturaMs: 0,
    });
    assert.ok(e.rete.id);
    assert.match(e.giro, /non fatto.*socket assente/);
  });
});
