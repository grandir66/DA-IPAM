// Spec topologia §13.6.1: un traduttore per prodotto porta i nomi di porta in fatti neutri; la logica dei collegamenti
// legge solo i fatti (vincolo 4 di Riccardo, 14/10: «a prescindere dal prodotto»). Nomi di serie dei prodotti; i nomi
// scelti dai clienti sono inventati.
import { test } from "node:test";
import assert from "node:assert/strict";
import { haTraduttore, haTraduttoreRemoto, macDelTelaio, traduciPorta, type ComeLetto } from "@/lib/topology/lettori/traduci";
import { traduciMikrotikLocale, traduciMikrotikRemoto } from "@/lib/topology/lettori/mikrotik";
import { traduciUnifiLocale } from "@/lib/topology/lettori/unifi";
import { traduciGenerico } from "@/lib/topology/lettori/generico";

const SSH: ComeLetto = { vendor: "mikrotik", via: "ssh", fonte: "device", piattaforma: null };

test("MikroTik, lato locale: «,bridge» nel bridge; il fascio; una porta fisica senza bridge è fuori dal bridge", () => {
  assert.deepEqual(traduciMikrotikLocale("ether3,bridge"), { nome: "ether3", fisica: true, senzaFili: false, nelBridge: true, fascio: null });
  assert.deepEqual(traduciMikrotikLocale("ether8"), { nome: "ether8", fisica: true, senzaFili: false, nelBridge: false, fascio: null });
  // Il bridge col nome scelto dal cliente (sull'hub è così): nel bridge lo stesso.
  assert.deepEqual(traduciMikrotikLocale("sfp28-1,bond1,LAN_IN"), { nome: "sfp28-1", fisica: true, senzaFili: false, nelBridge: true, fascio: "bond1" });
  assert.deepEqual(traduciMikrotikLocale("sfp28-1,bond1"), { nome: "sfp28-1", fisica: true, senzaFili: false, nelBridge: false, fascio: "bond1" });
  assert.deepEqual(traduciMikrotikLocale("vlan10-uffici"), { nome: "vlan10-uffici", fisica: false, senzaFili: false, nelBridge: null, fascio: null });
  assert.deepEqual(traduciMikrotikLocale("wlan1"), { nome: "wlan1", fisica: false, senzaFili: true, nelBridge: null, fascio: null });
  // Un nome scelto a mano: non noto finché non si legge il tipo (T2, MK2).
  assert.deepEqual(traduciMikrotikLocale("VL_2_UFFICI"), { nome: "VL_2_UFFICI", fisica: null, senzaFili: null, nelBridge: null, fascio: null });
});

// Spostate da links.test.ts (I41, revisione finale M-7): le stesse risposte di physicalPortName di prima.
test("porta fisica: ether1-2.5 e «ether3,bridge» sì; VLAN, sottointerfacce, tunnel e wlan no", () => {
  for (const p of ["ether1-2.5", "ether3,bridge", "ether7", "sfp-sfpplus1", "sfp1", "sfp28-1", "combo1", "qsfp28-1-1", "bond1", "Port 24", "GigabitEthernet0/1"]) {
    assert.notEqual(traduciMikrotikLocale(p).fisica, false, p);
  }
  for (const p of ["bridge", "bridge,ether3", "vlan10", "vrrp_rete10", "ether1.20", "eoip-tunnel1", "wlan1", "wifi1", "wg0", "lo", "pppoe-out1", "Gi0/1.10"]) {
    assert.equal(traduciMikrotikLocale(p).fisica, false, p);
  }
  assert.equal(traduciMikrotikLocale("").fisica, null);
});

// M-7 e verifica del 15/10 (vincolo 9): dopo il nome di fabbrica solo una velocità che non si confonde con un numero di VLAN
// («-10g», «-2.5g», «-2.5»). Con «qualunque coda di cifre» una VLAN chiamata «ether1-20» passava per una porta fisica.
test("M-7: ether1-<coda> è fisica solo con una velocità (con la g, o 2.5); ether1-vlan20, ether1-20 ed ether5-1.20 no", () => {
  for (const p of ["ether1-2.5", "ether1-10g", "ether1-2.5g", "ether1-10G", "sfp-sfpplus1-10g", "qsfp28-1-1"]) {
    assert.equal(traduciMikrotikLocale(p).fisica, true, p);
  }
  for (const p of ["ether1-vlan20", "ether1-wan", "ether1-lan.10", "ether1-2.5x", "sfp1-uplink", "ether1-20", "ether2-100", "ether5-1.20", "ether2-1.1", "ether3-5"]) {
    assert.equal(traduciMikrotikLocale(p).fisica, false, p);
  }
});

test("MikroTik, lato remoto: «‹bridge›/porta» → l'ultimo pezzo, anche col bridge dal nome scelto dal cliente", () => {
  assert.deepEqual(traduciMikrotikRemoto("bridge/sfp-sfpplus1"), { nome: "sfp-sfpplus1", fisica: true, senzaFili: false, nelBridge: true, fascio: null });
  assert.deepEqual(traduciMikrotikRemoto("bridge/bond1/wlan60-1"), { nome: "wlan60-1", fisica: false, senzaFili: true, nelBridge: true, fascio: "bond1" });
  assert.equal(traduciMikrotikRemoto("LAN_IN/sfp-sfpplus2").nome, "sfp-sfpplus2");
  assert.equal(traduciMikrotikRemoto("vrrp_rete_7").fisica, false);
  assert.deepEqual(traduciMikrotikRemoto("sfp28-2"), { nome: "sfp28-2", fisica: true, senzaFili: false, nelBridge: null, fascio: null });
});

test("controller: «SFP_ N» è «SFP+ N», anche con la descrizione; «SFP 1» resta un'altra porta; le radio sono senza fili", () => {
  assert.equal(traduciUnifiLocale("SFP_ 9").nome, "SFP+ 9");
  assert.equal(traduciUnifiLocale("SFP_ 17 - nodo-a").nome, "SFP+ 17 - nodo-a");
  assert.equal(traduciUnifiLocale("SFP 1").nome, "SFP 1");
  assert.deepEqual(traduciUnifiLocale("Port 9"), { nome: "Port 9", fisica: true, senzaFili: false, nelBridge: null, fascio: null });
  // I47: un'interfaccia senza fili non è logica.
  assert.deepEqual(traduciUnifiLocale("wifi2ap9"), { nome: "wifi2ap9", fisica: false, senzaFili: true, nelBridge: null, fascio: null });
});

test("generico: il nome com'è; «Gi1/0/24» resta intero; VLAN, sottointerfacce e liste con la virgola non sono cavi", () => {
  assert.deepEqual(traduciGenerico("Gi1/0/24"), { nome: "Gi1/0/24", fisica: null, senzaFili: null, nelBridge: null, fascio: null });
  assert.equal(traduciGenerico("Gi0/1.10").fisica, false);
  assert.equal(traduciGenerico("vlan20").fisica, false);
  assert.equal(traduciGenerico("a,b").fisica, false);
  assert.equal(traduciGenerico("wlan0").senzaFili, true);
});

test("chi traduce: il controller le sue righe; un MikroTik letto via SSH il suo traduttore; il lato remoto per piattaforma o per apparato abbinato", () => {
  assert.equal(traduciPorta("ether3,bridge", "locale", SSH).nome, "ether3");
  assert.equal(traduciPorta("ether3,bridge", "locale", { ...SSH, via: "snmp_v2" }).nome, "ether3,bridge");
  assert.equal(traduciPorta("SFP_ 9", "locale", { vendor: "ubiquiti", via: "api", fonte: "unifi", piattaforma: null }).nome, "SFP+ 9");
  assert.equal(traduciPorta("bridge/ether3", "remoto", { vendor: null, via: null, fonte: "device", piattaforma: "MikroTik" }).nome, "ether3");
  assert.equal(traduciPorta("bridge/ether3", "remoto", { ...SSH, fonte: "unifi" }).nome, "ether3");
  assert.equal(traduciPorta("Gi1/0/24", "remoto", { vendor: "cisco", via: "ssh", fonte: "device", piattaforma: "Cisco" }).nome, "Gi1/0/24");
});

// Verifica del piano sul dato dell'hub (15/10): il ripiego del router da una VLAN col nome scelto a mano («VL_…») appendeva
// un hypervisor al router. Chi ha un traduttore suo conosce i nomi delle porte fisiche; il generico no (Task 7).
test("haTraduttore: il controller e un MikroTik letto via SSH hanno un traduttore loro; gli altri il generico", () => {
  assert.equal(haTraduttore(SSH), true);
  assert.equal(haTraduttore({ ...SSH, via: "snmp_v2" }), false);
  assert.equal(haTraduttore({ vendor: "ubiquiti", via: "api", fonte: "unifi", piattaforma: null }), true);
  assert.equal(haTraduttore({ vendor: "cisco", via: "ssh", fonte: "device", piattaforma: null }), false);
});

// Revisione finale del 15/10 (verifica UV2): la scelta del lato remoto sta qui, accanto a traduciPorta; links.ts la chiede invece
// di ricopiarla con un'espressione sulla marca (prova I37 sul codice di links.ts, Task 7).
test("haTraduttoreRemoto: la piattaforma annunciata, o l'apparato remoto letto col traduttore del suo prodotto", () => {
  assert.equal(haTraduttoreRemoto({ vendor: null, via: null, fonte: "device", piattaforma: "MikroTik" }), true);
  assert.equal(haTraduttoreRemoto({ ...SSH, fonte: "unifi" }), true, "la riga del controller verso un MikroTik letto via SSH");
  assert.equal(haTraduttoreRemoto({ ...SSH, via: "snmp_v2" }), false);
  assert.equal(haTraduttoreRemoto({ vendor: "cisco", via: "ssh", fonte: "device", piattaforma: "Cisco" }), false);
  for (const [nome, come] of [["bridge/ether3", { vendor: null, via: null, fonte: "device", piattaforma: "MikroTik" }], ["Gi1/0/24", { vendor: "cisco", via: "snmp_v2", fonte: "device", piattaforma: null }]] as const) {
    assert.equal(traduciPorta(nome, "remoto", come).nome === nome, !haTraduttoreRemoto(come), nome);
  }
});

// ─── Passaggio universale (spec §13.16; vincolo 9 di Riccardo, 14/10 sera: «il piano deve essere universale») ───
/**
 * Nomi inventati a caso, senza prefissi di fabbrica né punti (prova I58): la prima lettera non è mai quella di un prefisso
 * di fabbrica (ether, sfp, combo, qsfp, bond, bridge, vlan, vrrp, eoip, gre, ipip, 6to4, vxlan, wg, wireguard, ovpn, pppoe,
 * pptp, l2tp, sstp, lte, lo, loopback, veth, wlan, wifi). Generatore deterministico (Park-Miller): stessi nomi a ogni giro.
 */
function nomiACaso(n: number, seme = 20261015): string[] {
  let x = seme;
  const caso = (k: number): number => { x = (x * 48271) % 2147483647; return x % k; };
  const PRIME = "ADFHJKMNRTUXYZadfhjkmnrtuxyz";
  const ALTRE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
  return Array.from({ length: n }, () => PRIME[caso(PRIME.length)] + Array.from({ length: 2 + caso(9) }, () => ALTRE[caso(ALTRE.length)]).join(""));
}
const SCELTI = ["XQ_7_ABC", "lan-piano2", "PONTE-A", "VL_22_CGWR", "BR_RP", "Rete Ospiti"];

// I58 (spec §13.12.3). Rete B (l'hub), 14/10: il router annuncia da ogni interfaccia, e una sua VLAN dal nome scelto,
// presa per una porta fisica, ha tracciato una linea fra due router (H7). Un nome scelto vale quanto un altro: per il
// traduttore del prodotto è «non noto» finché non si legge il tipo dell'interfaccia (T2), mai fisico né logico.
test("I58 — un nome scelto dal cliente, anche inventato a caso, sul lato locale di un MikroTik: «non noto»", () => {
  for (const nome of [...SCELTI, ...nomiACaso(200)]) {
    const l = traduciMikrotikLocale(nome);
    assert.deepEqual([l.nome, l.fisica, l.senzaFili, l.nelBridge], [nome, null, null, null], nome);
  }
});

// I58 anche coi prefissi di fabbrica (verifica del 15/10): i nomi a caso qui sopra non cominciano mai come un nome di fabbrica,
// e un nome scelto che comincia così («ether3-‹qualcosa›») con una coda che non è una velocità non è mai una porta fisica.
test("I58 — un prefisso di fabbrica con una coda scelta a caso non è una porta fisica", () => {
  const PREFISSI = ["ether", "sfp-sfpplus", "sfp28-", "sfp", "combo", "bond", "qsfp28-"];
  [...nomiACaso(100, 20261016), "20", "100", "1.20", "2", "3.5", "4-7"].forEach((coda, k) => {
    const nome = `${PREFISSI[k % PREFISSI.length]}${1 + (k % 9)}-${coda}`;
    assert.notEqual(traduciMikrotikLocale(nome).fisica, true, nome);
    assert.notEqual(traduciMikrotikRemoto(nome).fisica, true, nome);
  });
});

// I59 (spec §13.12.3): il contenitore di una riga di RouterOS si legge dalla forma, con qualunque nome del bridge. Rete B:
// ogni riga del router finisce col nome scelto del bridge; letta come «solo `,bridge` è nel bridge», ogni porta del
// router, fascio compreso, sarebbe instradata (§13.7.4).
test("I59 — il contenitore dalla forma: «porta,X» nel bridge X, «porta,bondN,X» membro del fascio nel bridge, «porta» fuori", () => {
  for (const br of ["bridge", ...SCELTI.filter((s) => !s.includes(" ")), ...nomiACaso(30)]) {
    assert.deepEqual(traduciMikrotikLocale(`sfp-sfpplus1,${br}`), { nome: "sfp-sfpplus1", fisica: true, senzaFili: false, nelBridge: true, fascio: null }, br);
    assert.deepEqual(traduciMikrotikLocale(`sfp28-1,bond1,${br}`), { nome: "sfp28-1", fisica: true, senzaFili: false, nelBridge: true, fascio: "bond1" }, br);
    assert.deepEqual([traduciMikrotikRemoto(`${br}/bond1/sfp28-1`).nome, traduciMikrotikRemoto(`${br}/sfp-sfpplus3`).nome], ["sfp28-1", "sfp-sfpplus3"], br);
  }
  assert.deepEqual(traduciMikrotikLocale("sfp-sfpplus2"), { nome: "sfp-sfpplus2", fisica: true, senzaFili: false, nelBridge: false, fascio: null });
  assert.equal(traduciGenerico("Gi1/0/24").nome, "Gi1/0/24", "un nome con la barra di un'altra marca resta intero");
});

// Spec §13.6.4: nelle righe di `/ip neighbor` il MAC è quello dell'interfaccia che ha mandato l'annuncio, non il telaio (sulla
// rete B lo stesso router compare con quattro MAC); il controller e SNMP (`lldpRemChassisId`) danno il telaio.
test("macDelTelaio: il controller e SNMP danno il telaio; le righe di un MikroTik letto via SSH il MAC dell'interfaccia", () => {
  assert.equal(macDelTelaio(SSH), false);
  assert.equal(macDelTelaio({ ...SSH, via: "snmp_v2" }), true);
  assert.equal(macDelTelaio({ vendor: "ubiquiti", via: "api", fonte: "unifi", piattaforma: null }), true);
  assert.equal(macDelTelaio({ vendor: "cisco", via: "snmp_v2", fonte: "device", piattaforma: null }), true);
});
