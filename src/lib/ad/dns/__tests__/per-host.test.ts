/**
 * Il DNS di AD visto da un host: stato di un IP, e le richieste «allinea» e «togli» ricostruite
 * sul server ed eseguite contro un DC finto.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/ad/dns/__tests__/per-host.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

import { withTenant, getTenantDb, deleteTenantDatabase, sostituisciDnsAd } from "@/lib/db-tenant";
import { correzioneHostDa, dnsDiIp, statoDnsDi } from "../per-host";
import { correzioniScelte } from "../vista";
import type { VoceDns, ZonaDns } from "../record";

void TEST_DATA_DIR;
const T = "TESTDNSHOST";
const ZONE: ZonaDns[] = [
  { nome: "esempio.local", inversa: false, partizione: "dominio" },
  { nome: "4.168.192.in-addr.arpa", inversa: true, partizione: "dominio" },
];
const A = (nome: string, ip: string): VoceDns => ({ zona: "esempio.local", nome, fqdn: `${nome}.esempio.local`, tipo: "A", dato: ip, ip, statica: true, rinnovataIl: null, ttl: 3600 });
const PTR = (ip: string, verso: string): VoceDns => ({ zona: "4.168.192.in-addr.arpa", nome: ip.split(".")[3]!, fqdn: `${ip.split(".")[3]}.4.168.192.in-addr.arpa`, tipo: "PTR", dato: `${verso}.esempio.local`, ip, statica: true, rinnovataIl: null, ttl: 3600 });
const breve = (id: string) => {
  const r = withTenant(T, () => correzioneHostDa(id, 1));
  return r.ok ? r.correzione.passi.map((p) => `${p.azione === "aggiungi" ? "+" : "-"}${p.tipo} ${p.nome}.${p.zona} ${p.dato}`) : r.motivo;
};

describe("DNS di AD visto da un host", () => {
  before(() => {
    const d = getTenantDb(T);
    d.prepare("INSERT INTO ad_integrations (id, name, dc_host, domain, base_dn, encrypted_username, encrypted_password, dns_scrittura) VALUES (1, 'Dominio', 'dc01.esempio.local', 'esempio.local', 'DC=esempio,DC=local', '', '', 1)").run();
    d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '192.168.4.0/24', 'prova')").run();
    const host = d.prepare("INSERT INTO hosts (id, network_id, ip, hostname, status, last_seen) VALUES (?, 1, ?, ?, 'online', datetime('now'))");
    host.run(1, "192.168.4.10", "pc-01");      // a posto
    host.run(2, "192.168.4.11", "pc-nuovo");   // nel DNS si chiama «vecchio»
    host.run(3, "192.168.4.12", "nas");        // nel DNS non c'è
    host.run(4, "192.168.4.30", "mobile");     // ha cambiato IP: nel DNS è ancora su .20
    host.run(5, "192.168.4.31", "conteso");    // ha cambiato IP, ma il vecchio (.13) ora è di un altro host
    host.run(6, "192.168.4.13", "altro");
    host.run(7, "192.168.4.14", "scoperto");   // rinominato a mano in «srv-posta»: vale il nome a mano
    host.run(8, "192.168.4.15", "pc-15");      // «Sala riunioni» a mano è una descrizione: vale il nome scoperto
    host.run(9, "192.168.4.16", "srv-app");     // due nomi e due reverse voluti: a posto
    host.run(10, "192.168.4.17", "nuovo-multi"); // due nomi nel DNS, nessuno è il suo
    host.run(11, "192.168.4.32", "viaggia");     // ha cambiato IP, e sul vecchio (.21) aveva anche un secondo nome
    d.prepare("UPDATE hosts SET custom_name = 'SRV-Posta' WHERE id = 7").run();
    d.prepare("UPDATE hosts SET custom_name = 'Sala riunioni' WHERE id = 8").run();
    withTenant(T, () => sostituisciDnsAd(1, ZONE, [
      A("dc01", "192.168.4.2"),
      A("pc-01", "192.168.4.10"), PTR("192.168.4.10", "pc-01"),
      A("vecchio", "192.168.4.11"), PTR("192.168.4.11", "vecchio"),
      A("mobile", "192.168.4.20"), PTR("192.168.4.20", "mobile"),
      A("conteso", "192.168.4.13"),
      A("sparito", "192.168.4.40"), PTR("192.168.4.40", "sparito"),
      A("scoperto", "192.168.4.14"), PTR("192.168.4.14", "scoperto"),
      A("pc-15", "192.168.4.15"), PTR("192.168.4.15", "pc-15"),
      A("srv-app", "192.168.4.16"), A("intranet", "192.168.4.16"), PTR("192.168.4.16", "srv-app"), PTR("192.168.4.16", "intranet"),
      A("uno", "192.168.4.17"), A("due", "192.168.4.17"), PTR("192.168.4.17", "uno"),
      A("viaggia", "192.168.4.21"), A("posta", "192.168.4.21"), PTR("192.168.4.21", "viaggia"), PTR("192.168.4.21", "posta"),
    ]));
  });
  after(() => deleteTenantDatabase(T));

  it("stato: c'è, manca, è diverso, niente da dire", () => {
    const s = withTenant(T, () => statoDnsDi(["192.168.4.10", "192.168.4.11", "192.168.4.12", "192.168.4.30", "192.168.4.99"]));
    assert.deepEqual(s, { "192.168.4.10": "ok", "192.168.4.11": "diverso", "192.168.4.12": "manca", "192.168.4.30": "diverso" });
    const d = withTenant(T, () => dnsDiIp("192.168.4.11"))[0]!;
    assert.deepEqual([d.nomi, d.reverse, d.allinea, d.correzioniAccese], [["vecchio.esempio.local"], ["vecchio.esempio.local"], "host:allinea:192.168.4.11", false]);
    assert.deepEqual(withTenant(T, () => dnsDiIp("192.168.4.99")), []);
  });

  it("allinea: rinomina, crea il nome che manca", () => {
    assert.deepEqual(breve("host:allinea:192.168.4.11"), [
      "+A pc-nuovo.esempio.local 192.168.4.11", "+PTR 11.4.168.192.in-addr.arpa pc-nuovo.esempio.local",
      "-PTR 11.4.168.192.in-addr.arpa vecchio.esempio.local", "-A vecchio.esempio.local 192.168.4.11",
    ]);
    assert.deepEqual(breve("host:allinea:192.168.4.12"), ["+A nas.esempio.local 192.168.4.12", "+PTR 12.4.168.192.in-addr.arpa nas.esempio.local"]);
    assert.match(String(breve("host:allinea:192.168.4.10")), /niente da allineare/);
  });

  // Riccardo, 18/11/2026: «spesso su un IP ci sono diversi record registrati per motivi reali».
  it("più nomi sullo stesso IP: non sono un difetto dell'host, e nessuna correzione li perde", () => {
    assert.deepEqual(withTenant(T, () => statoDnsDi(["192.168.4.16"])), { "192.168.4.16": "ok" });
    const d = withTenant(T, () => dnsDiIp("192.168.4.16"))[0]!;
    assert.deepEqual([d.nomi.length, d.reverse.length, d.anomalie, d.allinea], [2, 2, [], null]);
    // Il nome di DA-IPAM si aggiunge: «uno» e «due» restano.
    assert.deepEqual(breve("host:allinea:192.168.4.17"), ["+A nuovo-multi.esempio.local 192.168.4.17", "+PTR 17.4.168.192.in-addr.arpa nuovo-multi.esempio.local"]);
    // Cambio di IP: il secondo nome e i reverse seguono l'host.
    assert.deepEqual(breve("host:allinea:192.168.4.32"), [
      "+A viaggia.esempio.local 192.168.4.32", "+PTR 32.4.168.192.in-addr.arpa viaggia.esempio.local",
      "+A posta.esempio.local 192.168.4.32", "+PTR 32.4.168.192.in-addr.arpa posta.esempio.local",
      "-PTR 21.4.168.192.in-addr.arpa viaggia.esempio.local", "-PTR 21.4.168.192.in-addr.arpa posta.esempio.local",
      "-A posta.esempio.local 192.168.4.21", "-A viaggia.esempio.local 192.168.4.21",
    ]);
  });

  it("il nome scritto a mano vince su quello scoperto, se ha la forma di un nome DNS", () => {
    assert.deepEqual(breve("host:allinea:192.168.4.14"), [
      "+A srv-posta.esempio.local 192.168.4.14", "+PTR 14.4.168.192.in-addr.arpa srv-posta.esempio.local",
      "-PTR 14.4.168.192.in-addr.arpa scoperto.esempio.local", "-A scoperto.esempio.local 192.168.4.14",
    ]);
    assert.deepEqual(withTenant(T, () => statoDnsDi(["192.168.4.14", "192.168.4.15"])), { "192.168.4.14": "diverso", "192.168.4.15": "ok" });
  });

  it("cambio di IP: il nome segue; il vecchio si toglie solo se lì non c'è più nessuno", () => {
    assert.deepEqual(breve("host:allinea:192.168.4.30"), [
      "+A mobile.esempio.local 192.168.4.30", "+PTR 30.4.168.192.in-addr.arpa mobile.esempio.local",
      "-PTR 20.4.168.192.in-addr.arpa mobile.esempio.local", "-A mobile.esempio.local 192.168.4.20",
    ]);
    assert.deepEqual(breve("host:allinea:192.168.4.31"), ["+A conteso.esempio.local 192.168.4.31", "+PTR 31.4.168.192.in-addr.arpa conteso.esempio.local"]);
  });

  it("togli: solo se in DA-IPAM a quell'indirizzo non c'è più nessuno, e mai un controller di dominio", () => {
    assert.deepEqual(breve("host:togli:192.168.4.40"), ["-PTR 40.4.168.192.in-addr.arpa sparito.esempio.local", "-A sparito.esempio.local 192.168.4.40"]);
    assert.match(String(breve("host:togli:192.168.4.10")), /c'è ancora un host/);
    const dc = withTenant(T, () => correzioniScelte(1, ["host:togli:192.168.4.2"]));
    assert.equal(dc.trovate.length, 0);
    assert.match(dc.motivi[0]!, /controller di dominio/);
    assert.equal(breve("host:togli:192.168.4.40:x"), "Richiesta non leggibile");
    assert.equal(breve("host:cancella:192.168.4.40"), "Richiesta non prevista");
  });
});
