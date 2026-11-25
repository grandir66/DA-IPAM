import { test } from "node:test";
import assert from "node:assert/strict";
import { leggiAscolto, separaIndirizzo } from "../ascolto";
import { leggiContainer, moduloDelContainer } from "../container";
import { interneEsposte, portePresentate } from "../porte";
import { inRete, leggiConnessioni } from "../sistemi";
import { righeStato, type FattiStato } from "../stato";

// Forma vera di `ss -H -tulnp` su un'appliance (indirizzi degli intervalli di documentazione).
const SS = `udp   UNCONN 0      0            0.0.0.0:51820      0.0.0.0:*
udp   UNCONN 0      0      127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=600,fd=14))
tcp   LISTEN 0      4096         0.0.0.0:443        0.0.0.0:*    users:(("docker-proxy",pid=2001,fd=7))
tcp   LISTEN 0      4096            [::]:443           [::]:*    users:(("docker-proxy",pid=2008,fd=7))
tcp   LISTEN 0      511          0.0.0.0:3001       0.0.0.0:*    users:(("node",pid=1479,fd=22))
tcp   LISTEN 0      128          0.0.0.0:22         0.0.0.0:*    users:(("sshd",pid=900,fd=3))
tcp   LISTEN 0      4096       127.0.0.1:8000       0.0.0.0:*    users:(("docker-proxy",pid=2100,fd=7))
tcp   LISTEN 0      4096     100.64.0.12:53         0.0.0.0:*    users:(("netbird",pid=700,fd=9))
tcp   LISTEN 0      5            0.0.0.0:9999       0.0.0.0:*    users:(("python3",pid=4242,fd=3))
udp   UNCONN 0      0         0.0.0.0%lo:3128       0.0.0.0:*    users:(("netbird",pid=700,fd=11))
udp   UNCONN 0      0            0.0.0.0:37165      0.0.0.0:*    users:(("node",pid=1479,fd=40))
tcp   LISTEN 0      4096         0.0.0.0:7443       0.0.0.0:*    users:(("docker-proxy",pid=2011,fd=7))
`;

const INSPECT = JSON.stringify([
  {
    Name: "/appliance-nginx",
    Config: { Image: "nginx:1.27-alpine", Env: ["SEGRETO=non-deve-uscire"], ExposedPorts: { "80/tcp": {}, "443/tcp": {} } },
    HostConfig: { NetworkMode: "stack-net", Privileged: false, CapAdd: null },
    NetworkSettings: { Ports: { "443/tcp": [{ HostIp: "0.0.0.0", HostPort: "443" }, { HostIp: "::", HostPort: "443" }], "7443/tcp": [{ HostIp: "0.0.0.0", HostPort: "7443" }], "80/tcp": null } },
  },
  {
    Name: "/appliance-edge",
    Config: { Image: "appliance/scanner-edge:latest" },
    HostConfig: { NetworkMode: "host", Privileged: false, CapAdd: ["CAP_NET_ADMIN", "CAP_NET_RAW"] },
    NetworkSettings: { Ports: {} },
  },
]);

test("ss: indirizzo e porta nelle quattro forme", () => {
  assert.deepEqual(separaIndirizzo("[::]:443"), { indirizzo: "::", porta: 443 });
  assert.deepEqual(separaIndirizzo("127.0.0.53%lo:53"), { indirizzo: "127.0.0.53", porta: 53 });
  assert.deepEqual(separaIndirizzo("*:80"), { indirizzo: "*", porta: 80 });
  assert.equal(separaIndirizzo("senza-porta"), null);
  const a = leggiAscolto(SS);
  assert.equal(a.length, 12);
  assert.equal(a.find((x) => x.porta === 3128)?.scheda, "lo");
  assert.equal(a.find((x) => x.porta === 51820)?.processo, null);
});

test("container: porte pubblicate e interne, permessi, e mai le variabili d'ambiente", () => {
  const c = leggiContainer(INSPECT);
  assert.ok(c);
  const nginx = c.find((x) => x.nome === "appliance-nginx");
  assert.deepEqual(nginx?.pubblicate.map((p) => p.suMacchina), [443, 443, 7443]);
  assert.deepEqual(nginx?.interne, [{ porta: 80, proto: "tcp" }]);
  assert.deepEqual(c.find((x) => x.nome === "appliance-edge")?.permessi, ["NET_ADMIN", "NET_RAW"]);
  assert.equal(JSON.stringify(c).includes("non-deve-uscire"), false);
  assert.equal(leggiContainer("non è json"), null);
  assert.equal(moduloDelContainer("appliance-stack-gvmd-1"), "Scanner-Edge");
  assert.equal(moduloDelContainer("appliance-librenms-db"), "LibreNMS");
});

test("porte presentate: chi le raggiunge oggi, e la porta che nessuno conosce resta in vista", () => {
  const fatti = { ascolto: leggiAscolto(SS), container: leggiContainer(INSPECT), indirizziNetbird: ["100.64.0.12"], porteInterneChiuse: false };
  const p = portePresentate(fatti);
  const di = (porta: number, proto = "tcp") => p.find((x) => x.porta === porta && x.proto === proto);
  assert.equal(di(443)?.raggiunge, "tutti");
  assert.equal(di(443)?.tiene, "appliance-nginx");
  assert.equal(di(443)?.ipv6, true);
  assert.equal(di(8000)?.raggiunge, "macchina");
  assert.equal(di(53)?.raggiunge, "netbird");
  assert.equal(di(53, "udp")?.raggiunge, "macchina");
  assert.equal(di(9999)?.gruppo, "Non attribuita");
  // Visti sbagliati sui dati veri dell'hub (25/11): un ascolto legato a `lo` non è «a tutti»; i client UDP dell'app
  // non sono porte presentate; una porta di nginx che non conosciamo non è «di DA-IPAM».
  assert.equal(di(3128, "udp")?.raggiunge, "macchina");
  assert.equal(di(37165, "udp"), undefined);
  assert.equal(di(7443)?.modulo, "dietro nginx, da attribuire");
  assert.deepEqual(interneEsposte(p).map((x) => x.porta), [3001]);
  // Con le porte interne chiuse dal firewall di DA-Link la 3001 non è più esposta.
  assert.deepEqual(interneEsposte(portePresentate({ ...fatti, porteInterneChiuse: true })), []);
});

test("sistemi remoti: verso e porta, senza la macchina e senza i container", () => {
  const testo = `0 0 192.0.2.8:443 192.0.2.31:51000
0 0 192.0.2.8:443 192.0.2.31:51001
0 0 192.0.2.8:40000 198.51.100.40:443
0 0 127.0.0.1:3001 127.0.0.1:50000
0 0 172.19.0.1:44000 172.19.0.5:8000
0 0 [::ffff:192.0.2.8]:22 [::ffff:192.0.2.77]:60000
`;
  const s = leggiConnessioni(testo, new Set([443, 22, 3001]), (ip) => inRete(ip, "172.19.0.0/16"));
  assert.deepEqual(s, [
    { indirizzo: "192.0.2.31", verso: "entra", porta: 443, connessioni: 2 },
    { indirizzo: "192.0.2.77", verso: "entra", porta: 22, connessioni: 1 },
    { indirizzo: "198.51.100.40", verso: "esce", porta: 443, connessioni: 1 },
  ]);
  assert.equal(inRete("100.107.32.1", "100.64.0.0/10"), true);
  assert.equal(inRete("192.0.2.1", "100.64.0.0/10"), false);
});

const BUONI: FattiStato = {
  filtro: "acceso", porteATutti: 0, interneEsposte: [], nonAttribuite: 0, conIpv6: 0, adminTotali: 2, adminSenzaSeconda: 0,
  sshConPassword: false, vaultLocale: true, permessiChiave: 0o600, credenzialiSnmpVecchio: 0, firma: "blocca", root: false, containerPrivilegiati: [],
};

test("stato: tutto a posto non inventa rilievi; ogni debolezza ha gravità e rimedio; le gravi stanno in cima", () => {
  assert.equal(righeStato(BUONI).every((r) => r.esito === "a_posto"), true);
  const r = righeStato({ ...BUONI, filtro: "assente", porteATutti: 7, interneEsposte: [3001, 8080], adminSenzaSeconda: 1, vaultLocale: false, permessiChiave: 0o644, credenzialiSnmpVecchio: 6, root: true, conIpv6: 5 });
  const male = r.filter((x) => x.esito === "da_sistemare");
  assert.deepEqual(male.map((x) => x.chiave).sort(), ["chiave", "filtro", "interne", "ipv6", "permessi", "root", "seconda", "snmp"]);
  assert.equal(male.every((x) => x.gravita !== null && x.rimedio !== null), true);
  assert.equal(r[0].gravita, "alta");
  assert.equal(r[r.length - 1].esito, "a_posto");
  assert.match(r.find((x) => x.chiave === "filtro")?.parole ?? "", /7 porte.*NON protetta/);
});

test("stato: una fonte non letta dice «non so», mai «a posto»", () => {
  const r = righeStato({ ...BUONI, filtro: null, porteATutti: null, interneEsposte: null, sshConPassword: null, permessiChiave: null, credenzialiSnmpVecchio: null, root: null, containerPrivilegiati: null });
  for (const k of ["filtro", "interne", "ssh", "permessi", "snmp", "root", "container"]) assert.equal(r.find((x) => x.chiave === k)?.esito, "non_so", k);
});
