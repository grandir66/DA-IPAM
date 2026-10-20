/**
 * Link verso i servizi dell'appliance con l'host del browser (Riccardo, 21/10, «ok per 1»).
 *
 * L'installatore registra gli URL con l'IP LAN dell'appliance (`https://192.168.99.61:6443`):
 * chi apre DA-IPAM da un nome DNS o da NetBird finiva su un indirizzo irraggiungibile o
 * con un certificato che non corrisponde. Un URL dell'appliance stessa si apre con l'host
 * del browser; quello di un'altra macchina resta com'è. Nel database resta l'URL vero.
 *
 * Run: node --import tsx --test src/lib/integrations/__tests__/url-per-browser.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { raccogliHostAppliance, urlPerIlBrowser } from "../url-per-browser";

const APPLIANCE = ["192.168.99.61", "127.0.0.1", "localhost", "[::1]", "da-ipam"];

test("IP LAN dell'appliance → host del browser, porta e percorso conservati", () => {
  assert.equal(
    urlPerIlBrowser("https://192.168.99.61:6443/networks?x=1#a", APPLIANCE, "da-ipam.domarc.it"),
    "https://da-ipam.domarc.it:6443/networks?x=1#a",
  );
});

test("127.0.0.1 e localhost → host del browser", () => {
  assert.equal(urlPerIlBrowser("https://127.0.0.1:8443/", APPLIANCE, "100.64.1.2"), "https://100.64.1.2:8443/");
  assert.equal(urlPerIlBrowser("https://localhost:4443", APPLIANCE, "100.64.1.2"), "https://100.64.1.2:4443");
});

test("porta predefinita: resta senza porta", () => {
  assert.equal(urlPerIlBrowser("https://192.168.99.61/", APPLIANCE, "da-ipam.domarc.it"), "https://da-ipam.domarc.it/");
});

test("lo schema salvato non cambia (gli URL dell'installatore sono https)", () => {
  assert.equal(urlPerIlBrowser("http://192.168.99.61:8080/x", APPLIANCE, "nas.local"), "http://nas.local:8080/x");
});

test("un'altra macchina resta com'è", () => {
  assert.equal(urlPerIlBrowser("https://192.168.99.10:8006", APPLIANCE, "da-ipam.domarc.it"), "https://192.168.99.10:8006");
  assert.equal(urlPerIlBrowser("https://wazuh.cliente.it/app", APPLIANCE, "da-ipam.domarc.it"), "https://wazuh.cliente.it/app");
});

test("senza percorso resta senza «/» finale (chi concatena non fa «//»)", () => {
  assert.equal(urlPerIlBrowser("https://192.168.99.61:8443", APPLIANCE, "x.it") + "/app", "https://x.it:8443/app");
  assert.equal(urlPerIlBrowser("https://192.168.99.61:8443/", APPLIANCE, "x.it"), "https://x.it:8443/");
});

test("il nome della macchina conta, senza distinguere maiuscole", () => {
  assert.equal(urlPerIlBrowser("https://DA-IPAM:7443/", APPLIANCE, "10.1.1.1"), "https://10.1.1.1:7443/");
});

test("browser già sullo stesso host: URL identico", () => {
  const u = "https://192.168.99.61:6443";
  assert.equal(urlPerIlBrowser(u, APPLIANCE, "192.168.99.61"), u);
});

test("URL non valido, relativo, vuoto o non http: invariato", () => {
  assert.equal(urlPerIlBrowser("non un url", APPLIANCE, "x.it"), "non un url");
  assert.equal(urlPerIlBrowser("/rmm", APPLIANCE, "x.it"), "/rmm");
  assert.equal(urlPerIlBrowser("", APPLIANCE, "x.it"), "");
  assert.equal(urlPerIlBrowser("ssh://192.168.99.61", APPLIANCE, "x.it"), "ssh://192.168.99.61");
  assert.equal(urlPerIlBrowser(null, APPLIANCE, "x.it"), null);
  assert.equal(urlPerIlBrowser(undefined, APPLIANCE, "x.it"), undefined);
});

test("host del browser sconosciuto (render sul server senza Host): invariato", () => {
  assert.equal(urlPerIlBrowser("https://192.168.99.61:6443", APPLIANCE, ""), "https://192.168.99.61:6443");
  assert.equal(urlPerIlBrowser("https://192.168.99.61:6443", APPLIANCE, null), "https://192.168.99.61:6443");
});

test("browser su IPv6: host fra parentesi quadre", () => {
  assert.equal(urlPerIlBrowser("https://192.168.99.61:6443/", APPLIANCE, "[fd00::5]"), "https://[fd00::5]:6443/");
  assert.equal(urlPerIlBrowser("https://192.168.99.61:6443/", APPLIANCE, "fd00::5"), "https://[fd00::5]:6443/");
});

test("raccolta: loopback, nome, interfacce vere (Docker escluso), env e URL noti", () => {
  const host = raccogliHostAppliance({
    nomeMacchina: "DA-IPAM.lan",
    interfacce: {
      lo: [{ address: "127.0.0.1", family: "IPv4", internal: true }],
      eth0: [
        { address: "192.168.99.61", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      wt0: [{ address: "100.64.1.2", family: "IPv4", internal: false }],
      docker0: [{ address: "172.17.0.1", family: "IPv4", internal: false }],
      "br-1a2b": [{ address: "172.18.0.1", family: "IPv4", internal: false }],
      veth1: [{ address: "169.254.1.1", family: "IPv4", internal: false }],
    },
    hostDichiarati: ["Appliance.Cliente.it", " ", "https://10.0.0.5:3000"],
  });
  for (const h of ["127.0.0.1", "localhost", "[::1]", "da-ipam.lan", "da-ipam", "192.168.99.61", "100.64.1.2", "appliance.cliente.it", "10.0.0.5"]) {
    assert.ok(host.includes(h), `manca ${h}`);
  }
  for (const h of ["172.17.0.1", "172.18.0.1", "169.254.1.1", "fe80::1", "[fe80::1]", ""]) {
    assert.ok(!host.includes(h), `non deve esserci ${h}`);
  }
});
