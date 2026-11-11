/**
 * Le funzioni di un apparato e come si riconoscono (11/11/2026).
 * Run: node --import tsx --test src/lib/classification/__tests__/funzioni.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FUNZIONI, funzioniDi, gruppiFunzioni } from "../funzioni";

const slug = (r: ReturnType<typeof funzioniDi>) => r.map((x) => x.funzione).sort();

describe("catalogo", () => {
  it("ogni funzione ha uno slug solo e sta in un gruppo dell'elenco", () => {
    assert.equal(new Set(FUNZIONI.map((f) => f.slug)).size, FUNZIONI.length);
    assert.equal(gruppiFunzioni().flatMap((g) => g.voci).length, FUNZIONI.length);
  });
});

describe("funzioniDi dai servizi (nomi veri del cliente 70791)", () => {
  it("un controller di dominio Windows: AD, DNS, DHCP", () => {
    assert.deepEqual(slug(funzioniDi({ servizi: ["NTDS", "DNS", "DHCPServer", "Dnscache", "LanmanServer", "Spooler", "W32Time"] })), ["ad_ldap", "dhcp", "dns"]);
  });
  it("il client DNS, la condivisione file e lo spooler di ogni Windows non dicono niente", () => {
    assert.deepEqual(funzioniDi({ servizi: ["Dnscache", "LanmanServer", "Spooler", "TermService", "SessionEnv"] }), []);
  });
  it("SQL Server sì, anche con istanza; la banca dati interna di Windows no", () => {
    assert.deepEqual(slug(funzioniDi({ servizi: ["MSSQLSERVER"] })), ["db_server"]);
    assert.deepEqual(slug(funzioniDi({ servizi: ["MSSQL$SQLEXPRESS"] })), ["db_server"]);
    assert.deepEqual(funzioniDi({ servizi: ["MSSQL$MICROSOFT##WID", "SQLWriter", "SQLBrowser"] }), []);
  });
  it("i client VPN e gli agenti non sono funzioni", () => {
    assert.deepEqual(funzioniDi({ servizi: ["netbird", "OpenVPNService", "WireGuardManager", "Zabbix Agent 2", "WazuhSvc", "VeeamEndpointBackupSvc"] }), []);
  });
  it("Linux: il nome dell'unità, con o senza «.service»", () => {
    assert.deepEqual(slug(funzioniDi({ servizi: ["nginx.service", "postgresql@16-main.service", "docker.service"] })), ["container", "db_server", "web"]);
  });
});

describe("funzioniDi dalle porte e dalla categoria", () => {
  it("53, 1433, 25 dicono la funzione; 80, 443, 445 e 22 no", () => {
    assert.deepEqual(slug(funzioniDi({ porte: [53, 1433, 25] })), ["db_server", "dns", "posta"]);
    assert.deepEqual(funzioniDi({ porte: [80, 443, 445, 22, 3389] }), []);
  });
  it("prova a vuoto del 70791: la 21 da sola non è «trasferimento file», la 88 da sola non è AD (ogni Mac ce l'ha)", () => {
    assert.deepEqual(funzioniDi({ porte: [21, 22, 80, 8291] }), []);
    assert.deepEqual(funzioniDi({ porte: [88, 445, 5900] }), []);
    assert.deepEqual(slug(funzioniDi({ porte: [88, 389, 445] })), ["ad_ldap"]);
    assert.deepEqual(slug(funzioniDi({ servizi: ["ftpsvc"] })), ["trasferimento_file"]);
  });
  it("chi è un router fa da router; un NAS fa da storage", () => {
    assert.deepEqual(slug(funzioniDi({ classe: "router", porte: [53] })), ["dns", "router"]);
    assert.deepEqual(slug(funzioniDi({ classe: "nas" })), ["storage"]);
  });
  it("l'origine è la prima che l'ha detta: il servizio vale più della porta", () => {
    const r = funzioniDi({ servizi: ["DNS"], porte: [53] });
    assert.equal(r.length, 1);
    assert.match(r[0].origine, /servizio/);
  });
  it("i ruoli vecchi della scheda valgono, e l'elenco dei server di dominio pure", () => {
    assert.deepEqual(slug(funzioniDi({ ruoli: ["database", "web"], serverDiDominio: true })), ["ad_ldap", "db_server", "web"]);
  });
});
