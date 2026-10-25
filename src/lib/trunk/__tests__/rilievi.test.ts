/**
 * Rilievi di sicurezza della rete osservata (25/10): regole pure e salvataggio
 * (aggiorna, chiude ciò che sparisce, conserva «preso in carico»).
 *
 * Run: node --import tsx --test src/lib/trunk/__tests__/rilievi.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  calcolaRilievi,
  contaAllarmiAlti,
  getRiepilogoRilievi,
  getRilieviPaginated,
  getTipiRilievoPerMac,
  ingressoDalDb,
  macCasuale,
  prendiInCarico,
  salvaRilievi,
  type IngressoRegole,
  type OsservazionePerRegole,
} from "@/lib/trunk/rilievi";

const ADESSO = new Date("2026-10-25T12:00:00Z");
const T = "RILIEVI2510";

after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

function oss(p: Partial<OsservazionePerRegole> & { mac: string }): OsservazionePerRegole {
  return { vid: 10, ip: "", nome: null, protocolli: [], prima_vista: "2026-10-25T11:00:00", ultima_vista: "2026-10-25T11:50:00", ...p };
}

function ingresso(p: Partial<IngressoRegole>): IngressoRegole {
  return {
    adesso: ADESSO,
    osservazioni: [],
    vlan: [{ vid: 10, vista: true, dichiarata: true, reti: [{ cidr: "192.168.10.0/24", gateway_ip: "192.168.10.1", fonte: "dhcp" }], server_dhcp: [] }],
    vicini: [],
    macInventario: new Set(),
    serverDhcpNoti: new Set(),
    retiIpam: [],
    ...p,
  };
}

const tipi = (r: ReturnType<typeof calcolaRilievi>) => r.map((x) => x.tipo).sort();

test("DHCP: il gateway è previsto, un secondo server è un allarme grave", () => {
  const vlan = [{
    vid: 10, vista: true, dichiarata: true,
    reti: [{ cidr: "192.168.10.0/24", gateway_ip: "192.168.10.1", fonte: "dhcp" }],
    server_dhcp: [
      { mac: "AA:00:00:00:00:01", ip: "192.168.10.1", ultima_vista: "2026-10-25T11:00:00" },
      { mac: "3C:84:6A:00:00:02", ip: "192.168.0.1", ultima_vista: "2026-10-25T11:30:00" },
    ],
  }];
  const r = calcolaRilievi(ingresso({ vlan, macInventario: new Set(["AA0000000001", "3C846A000002"]) }));
  const dhcp = r.filter((x) => x.tipo === "dhcp_non_previsto");
  assert.equal(dhcp.length, 1);
  assert.equal(dhcp[0].ip, "192.168.0.1");
  assert.equal(dhcp[0].gravita, "alta");
  assert.equal(dhcp[0].categoria, "allarme");
});

test("DHCP: un server solo e sconosciuto è da controllare; noto come sorgente, niente", () => {
  const vlan = [{ vid: 20, vista: true, dichiarata: true, reti: [], server_dhcp: [{ mac: "AA:00:00:00:00:09", ip: "10.0.20.5", ultima_vista: null }] }];
  assert.equal(calcolaRilievi(ingresso({ vlan })).find((x) => x.tipo === "dhcp_non_previsto")?.gravita, "media");
  assert.equal(calcolaRilievi(ingresso({ vlan, serverDhcpNoti: new Set(["10.0.20.5"]) })).filter((x) => x.tipo === "dhcp_non_previsto").length, 0);
});

test("IP conteso: due MAC insieme sul gateway = grave; un IP passato da un PC all'altro no", () => {
  const conteso = calcolaRilievi(ingresso({
    osservazioni: [
      oss({ mac: "AA:00:00:00:00:01", ip: "192.168.10.1", ultima_vista: "2026-10-25T11:50:00" }),
      oss({ mac: "BB:00:00:00:00:02", ip: "192.168.10.1", ultima_vista: "2026-10-25T11:40:00" }),
    ],
    macInventario: new Set(["AA0000000001", "BB0000000002"]),
  })).find((x) => x.tipo === "ip_conteso");
  assert.ok(conteso);
  assert.equal(conteso.gravita, "alta");
  const riassegnato = calcolaRilievi(ingresso({
    osservazioni: [
      oss({ mac: "AA:00:00:00:00:03", ip: "192.168.10.30", ultima_vista: "2026-10-25T11:50:00" }),
      oss({ mac: "BB:00:00:00:00:04", ip: "192.168.10.30", ultima_vista: "2026-10-25T06:00:00" }),
    ],
  }));
  assert.equal(riassegnato.filter((x) => x.tipo === "ip_conteso").length, 0);
});

test("IP conteso: i MAC virtuali VRRP/HSRP non contano", () => {
  const r = calcolaRilievi(ingresso({
    osservazioni: [
      oss({ mac: "00:00:5E:00:01:0A", ip: "192.168.10.1" }),
      oss({ mac: "AA:00:00:00:00:01", ip: "192.168.10.1" }),
    ],
  }));
  assert.equal(r.filter((x) => x.tipo === "ip_conteso").length, 0);
});

test("LLMNR/NetBIOS, più VLAN, non in inventario, MAC casuale", () => {
  const r = calcolaRilievi(ingresso({
    osservazioni: [
      oss({ mac: "AA:00:00:00:00:05", ip: "192.168.10.50", nome: "PC-UFF1", protocolli: ["arp", "llmnr", "nbns"] }),
      oss({ mac: "00:1A:00:00:00:06", vid: 10, ip: "192.168.10.60" }),
      oss({ mac: "00:1A:00:00:00:06", vid: 20, ip: "" }),
      oss({ mac: "DA:A1:19:00:00:07", ip: "192.168.10.70" }),
    ],
    macInventario: new Set(["AA0000000005", "001A00000006"]),
  }));
  const nomi = r.find((x) => x.tipo === "nomi_insicuri");
  assert.ok(nomi);
  assert.match(nomi.descrizione, /PC-UFF1 usa LLMNR e NetBIOS/);
  assert.ok(r.find((x) => x.tipo === "piu_vlan" && x.mac === "00:1A:00:00:00:06"));
  const inv = r.filter((x) => x.tipo === "non_in_inventario");
  assert.equal(inv.length, 1);
  assert.equal(inv[0].dettaglio.casuale, true);
  assert.equal(inv[0].gravita, "bassa");
  assert.equal(macCasuale("DA:A1:19:00:00:07"), true);
  assert.equal(macCasuale("00:11:22:33:44:55"), false);
});

test("fuori rete: IP della rete di un'altra VLAN; il router con più VLAN no", () => {
  const vlan = [
    { vid: 10, vista: true, dichiarata: true, reti: [{ cidr: "192.168.10.0/24", gateway_ip: "192.168.10.1", fonte: "dhcp" }], server_dhcp: [] },
    { vid: 20, vista: true, dichiarata: true, reti: [{ cidr: "192.168.20.0/24", gateway_ip: "192.168.20.1", fonte: "dhcp" }], server_dhcp: [] },
  ];
  const r = calcolaRilievi(ingresso({
    vlan,
    osservazioni: [
      oss({ mac: "AA:00:00:00:00:08", vid: 20, ip: "192.168.10.88" }),
      oss({ mac: "00:1B:00:00:00:01", vid: 10, ip: "192.168.10.1" }),
      oss({ mac: "00:1B:00:00:00:01", vid: 20, ip: "192.168.20.1" }),
    ],
    macInventario: new Set(["AA0000000008", "001B00000001"]),
  }));
  const fuori = r.filter((x) => x.tipo === "fuori_rete");
  assert.equal(fuori.length, 1);
  assert.equal(fuori[0].ip, "192.168.10.88");
  assert.equal(r.filter((x) => x.tipo === "piu_vlan").length, 0, "il MAC del gateway non conta come «più VLAN»");
});

test("VLAN non censita, vicini, finestra di 30 giorni", () => {
  const r = calcolaRilievi(ingresso({
    vlan: [
      { vid: 10, vista: true, dichiarata: true, reti: [], server_dhcp: [] },
      { vid: 666, vista: true, dichiarata: false, reti: [], server_dhcp: [] },
      { vid: 88, vista: true, dichiarata: false, reti: [], server_dhcp: [] },
    ],
    retiIpam: [{ cidr: "10.88.0.0/24", vlan_id: 88, gateway: null }],
    vicini: [{ protocollo: "lldp", sistema: "sw-core", porta: "Gi1/0/24", vid: 0, indirizzo: "10.0.0.2", vlan_nativa: 1, ultima_vista: "2026-10-25T11:00:00" }],
    osservazioni: [oss({ mac: "AA:00:00:00:00:99", ip: "192.168.10.99", ultima_vista: "2026-09-01T10:00:00" })],
  }));
  assert.deepEqual(tipi(r), ["vicino_esposto", "vlan_inattesa"]);
  assert.equal(r.find((x) => x.tipo === "vlan_inattesa")?.vid, 666);
});

test("salvataggio: aggiorna, chiude ciò che sparisce, tiene «preso in carico»", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const base = calcolaRilievi(ingresso({
      vlan: [{ vid: 10, vista: true, dichiarata: true, reti: [], server_dhcp: [
        { mac: "AA:00:00:00:00:01", ip: "10.0.0.1", ultima_vista: null },
        { mac: "BB:00:00:00:00:02", ip: "10.0.0.2", ultima_vista: null },
      ] }],
      osservazioni: [oss({ mac: "AA:00:00:00:00:05", ip: "10.0.0.50", protocolli: ["llmnr"] })],
    }));
    salvaRilievi(base, ADESSO);
    assert.equal(contaAllarmiAlti(), 2);
    const rie = getRiepilogoRilievi();
    assert.equal(rie.allarmi, 2);
    assert.equal(rie.esposizioni, 1);
    assert.equal(rie.novita, 1);
    assert.equal(rie.nuovi, 1);

    const { righe } = getRilieviPaginated({ categoria: "allarme" });
    assert.equal(righe[0].gravita, "alta");
    assert.ok(prendiInCarico(righe[0].id, true, "riccardo"));
    assert.equal(contaAllarmiAlti(), 1);
    assert.equal(getRilieviPaginated({ daPrendere: true, categoria: "allarme" }).totale, 1);
    assert.deepEqual(getTipiRilievoPerMac(["AA:00:00:00:00:05"]).get("AA:00:00:00:00:05")?.sort(), ["nomi_insicuri", "non_in_inventario"]);

    // Il giro dopo: un server DHCP sparisce, l'altro resta (ed è ancora preso in carico).
    const sparito = righe[1].mac;
    const dopo = base.filter((x) => !(x.tipo === "dhcp_non_previsto" && x.mac === sparito));
    const esito = salvaRilievi(dopo, new Date("2026-10-25T12:02:00Z"));
    assert.equal(esito.chiusi, 1);
    const resta = d.prepare("SELECT preso_in_carico, preso_da, chiuso_il FROM rete_rilievi WHERE id = ?").get(righe[0].id) as { preso_in_carico: number; preso_da: string; chiuso_il: string | null };
    assert.deepEqual(resta, { preso_in_carico: 1, preso_da: "riccardo", chiuso_il: null });
    assert.equal(getRiepilogoRilievi().allarmi, 1);
  });
});

test("ingresso dal DB: inventario da host, reti e server DHCP da trunk_vlan", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const net = d.prepare("INSERT INTO networks (cidr, name, vlan_id, gateway) VALUES ('10.0.0.0/24', 'v10', 10, '10.0.0.1')").run();
    d.prepare("INSERT INTO hosts (network_id, ip, mac) VALUES (?, '10.0.0.50', 'AA:00:00:00:00:05')").run(net.lastInsertRowid);
    d.prepare(`INSERT INTO trunk_vlan (vid, vista, dichiarata, mac, reti, server_dhcp, aggiornato)
      VALUES (10, 1, 1, 1, '[]', '[{"mac":"AA:00:00:00:00:01","ip":"10.0.0.1","ultima_vista":null}]', '2026-10-25')`).run();
    const x = ingressoDalDb(ADESSO);
    assert.ok(x.macInventario.has("AA0000000005"));
    assert.equal(x.vlan[0].server_dhcp[0].ip, "10.0.0.1");
    assert.deepEqual(x.retiIpam.map((n) => [n.cidr, n.vlan_id, n.gateway]), [["10.0.0.0/24", 10, "10.0.0.1"]]);
    const r = calcolaRilievi(x);
    assert.equal(r.filter((y) => y.tipo === "dhcp_non_previsto").length, 0, "il gateway della rete in DA-IPAM è previsto");
  });
});
