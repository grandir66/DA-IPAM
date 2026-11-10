/**
 * «Servizi di rete» con la logica dei Findings (10/11/2026). Sull'hub la pagina era un elenco
 * piatto di 1.085 righe: 12 Telnet, 13 certificati scaduti e 618 servizi non identificati si
 * scoprivano una riga alla volta. Qui si prova che segnali, gruppi e rilievi per porta escano
 * dalle righe vere di `servizi_rete`.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ServizioReteCompleto } from "../db";
import { barreReteServizi, conteggiPerTipo, eCidr, filtraServizi, indicatoriServizi, preparaServizi, raggruppaServizi } from "../viste";

const ADESSO = new Date("2026-11-10T12:00:00Z");
let prossimo = 1;
function riga(p: Partial<ServizioReteCompleto>): ServizioReteCompleto {
  return {
    id: prossimo++, host_id: 1, ip: "192.168.4.10", hostname: null, network_id: 3, rete: "LAN", cidr: "192.168.4.0/24",
    porta: 22, protocollo: "tcp", nome: "ssh", prodotto: null, versione: null, metodo: "ssh", banner: null,
    tls_json: null, http_json: null, ssh_json: null, ntlm_json: null, controllo_json: null,
    primo_visto: "2026-11-09 10:00:00", ultimo_visto: "2026-11-10 11:00:00", ultima_sonda: "2026-11-10 11:00:00",
    ...p,
  };
}
const tls = (o: object) => JSON.stringify({ version: "TLSv1.3", cipher: "TLS_AES_256_GCM_SHA384", sans: [], ...o });

const RIGHE = [
  riga({ host_id: 1, ip: "192.168.4.10", porta: 22, prodotto: "OpenSSH", versione: "9.6" }),
  riga({ host_id: 2, ip: "192.168.4.11", porta: 22, nome: "tcpwrapped", prodotto: "OpenSSH", versione: "8.4" }),
  riga({ host_id: 2, ip: "192.168.4.11", porta: 23, nome: "telnet", metodo: "banner", banner: "login:" }),
  riga({ host_id: 3, ip: "192.168.5.20", network_id: 4, rete: "DMZ", porta: 443, nome: "https", metodo: "tls-http", tls_json: tls({ expired: true, not_after: "2025-01-01T00:00:00Z", subject_cn: "vecchio" }) }),
  riga({ host_id: 3, ip: "192.168.5.20", network_id: 4, rete: "DMZ", porta: 8443, nome: "https", metodo: "tls", tls_json: tls({ self_signed: true, not_after: "2030-01-01T00:00:00Z" }) }),
  riga({ host_id: 4, ip: "192.168.5.21", network_id: 4, rete: "DMZ", porta: 9000, nome: null, metodo: "silenzio" }),
  riga({ host_id: 4, ip: "192.168.5.21", network_id: 4, rete: "DMZ", porta: 9001, nome: null, metodo: "nmap", ultima_sonda: null, ultimo_visto: "2026-10-20 08:00:00" }),
];

test("i segnali escono dalle righe: chiaro, certificati, non identificati, non rivisti", () => {
  const n = indicatoriServizi(preparaServizi(RIGHE, ADESSO));
  assert.equal(n.servizi, 7);
  assert.equal(n.host, 4);
  assert.deepEqual(n.chiaro, { totale: 1, voci: [{ nome: "Telnet", n: 1 }] });
  assert.deepEqual(n.certificati, { totale: 2, scaduti: 1, autofirmati: 1 });
  assert.deepEqual(n.nonIdentificati, { totale: 2, muti: 1, daSondare: 1 });
  assert.equal(n.nonRivisti, 1);
});

test("i rilievi stanno sulla porta da cui nascono, con la chiave di triage di Findings", () => {
  const viste = preparaServizi(RIGHE, ADESSO);
  const scaduto = viste.find((r) => r.porta === 443);
  assert.ok(scaduto);
  assert.equal(scaduto.certificato, "scaduto");
  assert.ok(scaduto.rilievi.some((x) => x.chiave === "giro:tls-scaduto:3:443" && x.gravita === "High"));
  const telnet = viste.find((r) => r.porta === 23);
  assert.ok(telnet && telnet.rilievi.length > 0, "Telnet aperto è un rilievo");
  assert.ok(!("controllo_json" in viste[0]), "l'esito grezzo dei controlli non esce dal server");
});

test("per porta: la 22 è un gruppo solo, col nome vero e i prodotti contati", () => {
  const gruppi = raggruppaServizi(preparaServizi(RIGHE, ADESSO), "porta");
  const ssh = gruppi.find((g) => g.chiave === "porta:22/tcp");
  assert.ok(ssh);
  assert.equal(ssh.servizi, 2);
  assert.equal(ssh.host, 2);
  assert.equal(ssh.dettaglio, "ssh", "tcpwrapped non è il nome del servizio");
  assert.equal(ssh.sintesi, "OpenSSH 2");
  assert.deepEqual(ssh.filtro, { porta: 22 });
  assert.ok(gruppi[0].rilievi > 0, "in cima un gruppo con rilievi");
});

test("per prodotto, host e rete i conti tornano", () => {
  const viste = preparaServizi(RIGHE, ADESSO);
  const openssh = raggruppaServizi(viste, "prodotto").find((g) => g.nome === "OpenSSH");
  assert.ok(openssh);
  assert.match(openssh.sintesi, /^2 versioni · porte 22$/);
  const senza = raggruppaServizi(viste, "prodotto").find((g) => g.filtro.prodotto === "(senza)");
  assert.equal(senza?.servizi, 5);
  const host3 = raggruppaServizi(viste, "host").find((g) => g.chiave === "host:3");
  assert.equal(host3?.sintesi, "porte 443, 8443");
  assert.equal(host3?.scaduti, 1);
  assert.equal(host3?.autofirmati, 1);
  const dmz = raggruppaServizi(viste, "rete").find((g) => g.chiave === "rete:4");
  assert.equal(dmz?.servizi, 4);
  assert.equal(dmz?.nonIdentificati, 2);
});

test("filtri: rete, tipo, segnale, CIDR e solo con rilievi", () => {
  const viste = preparaServizi(RIGHE, ADESSO);
  assert.equal(filtraServizi(viste, { rete: 4 }).length, 4);
  assert.equal(filtraServizi(viste, { tipo: "tls" }).length, 2);
  assert.equal(filtraServizi(viste, { segnale: "chiaro" }).length, 1);
  assert.equal(filtraServizi(viste, { cidr: "192.168.4.0/24" }).length, 3);
  assert.ok(filtraServizi(viste, { conRilievi: true }).every((r) => r.rilievi.length > 0));
  assert.equal(eCidr("192.168.4.0/24"), true);
  assert.equal(eCidr("192.168.4.10"), false);
  assert.equal(eCidr("999.1.1.1/24"), false);
  assert.deepEqual(conteggiPerTipo(viste), { http: 0, tls: 2, ssh: 0, ntlm: 0, banner: 1, silenzio: 1, "da-sondare": 1 });
});

test("l'UDP non è «da sondare»: le sonde non lo toccano", () => {
  const [snmp] = preparaServizi([riga({ porta: 161, protocollo: "udp", nome: "snmp", metodo: "nmap", ultima_sonda: null })], ADESSO);
  assert.ok(!snmp.segnali.includes("non-identificati"));
  assert.equal(conteggiPerTipo([snmp])["da-sondare"], 0);
});

test("barre per rete: identificati e non, con gli host", () => {
  const barre = barreReteServizi(preparaServizi(RIGHE, ADESSO));
  assert.deepEqual(barre.map((b) => [b.nome, b.totale, b.identificati, b.nonIdentificati, b.host]), [
    ["DMZ", 4, 2, 2, 2],
    ["LAN", 3, 3, 0, 2],
  ]);
});
