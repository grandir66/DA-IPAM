/**
 * OS dalle prove già fatte: NTLM, SNMP, SSH; si scrive solo se os_info è vuoto.
 * Run: node --import tsx --test src/lib/servizi-rete/__tests__/os-da-prove.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { leggiPrimaLettura, osDaBannerSsh, osDaSysDescr, osDaVersioneNtlm, riempiOsVuoti, scegliOs } from "../os-da-prove";

const T = "PROVAOSDA";

after(() => {
  closeTenantDb(T);
  deleteTenantDatabase(T);
  closeHubDb();
});

test("NTLM: build nota e fallback Windows (x.y)", () => {
  assert.equal(osDaVersioneNtlm("10.0.20348"), "Windows Server 2022");
  assert.equal(osDaVersioneNtlm("10.0.22000"), "Windows 11");
  assert.equal(osDaVersioneNtlm("6.1"), "Windows 7 / Server 2008 R2");
  assert.equal(osDaVersioneNtlm("10.0.99999"), "Windows (10.0.99999)");
  assert.equal(osDaVersioneNtlm("Windows Server 2019"), "Windows Server 2019");
  assert.equal(osDaVersioneNtlm(""), null);
  assert.equal(osDaVersioneNtlm(null), null);
});

test("SSH: distro dal banner; SNMP: prima riga", () => {
  assert.equal(osDaBannerSsh("SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13"), "Linux (Ubuntu)");
  assert.equal(osDaBannerSsh("SSH-2.0-OpenSSH_for_Windows_8.1"), "Windows");
  assert.equal(osDaBannerSsh("HTTP/1.1"), null);
  assert.equal(osDaSysDescr("Cisco IOS Software\nmore"), "Cisco IOS Software");
  assert.equal(osDaSysDescr("  "), null);
});

test("scegliOs: NTLM prima di SNMP, SSH, archivio", () => {
  assert.equal(scegliOs({ ntlm: "10.0.17763", snmp: "Linux", ssh: "SSH-2.0-OpenSSH_9 Ubuntu", os_info: "Debian" })?.fonte, "ntlm");
  assert.equal(scegliOs({ snmp: "HP iLO 5", os_info: "Unknown" })?.os, "HP iLO 5");
  assert.equal(scegliOs({ ssh: "SSH-2.0-OpenSSH_9.2p1 Debian-2" })?.os, "Linux (Debian)");
  assert.equal(scegliOs({ os_info: "macOS 14" })?.fonte, "archivio");
  assert.equal(scegliOs({}), null);
});

test("riempiOsVuoti scrive NTLM e non tocca os_info già pieno; prima lettura ha servizi e dominio", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const n = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.9.0.0/24', 'lan')").run().lastInsertRowid);
    const ins = d.prepare("INSERT INTO hosts (network_id, ip, status, os_info) VALUES (?, ?, 'online', ?)");
    const vuoto = Number(ins.run(n, "10.9.0.10", null).lastInsertRowid);
    const pieno = Number(ins.run(n, "10.9.0.11", "Windows Server 2019 Standard").lastInsertRowid);
    d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)",
    ).run(
      vuoto,
      JSON.stringify({
        netbios: "SRV1",
        dominio_netbios: "CORP",
        dns_computer: "srv1.corp.local",
        dominio_dns: "corp.local",
        versione_os: "10.0.20348",
        fonte: "smb",
      }),
    );
    d.prepare(
      "INSERT INTO servizi_rete (host_id, porta, protocollo, metodo, ntlm_json) VALUES (?, 445, 'tcp', 'ntlm', ?)",
    ).run(
      pieno,
      JSON.stringify({ versione_os: "10.0.20348", netbios: "X", dominio_netbios: null, dns_computer: null, dominio_dns: null, fonte: "smb" }),
    );

    assert.equal(riempiOsVuoti(d), 1);
    const osVuoto = (d.prepare("SELECT os_info FROM hosts WHERE id = ?").get(vuoto) as { os_info: string }).os_info;
    const osPieno = (d.prepare("SELECT os_info FROM hosts WHERE id = ?").get(pieno) as { os_info: string }).os_info;
    assert.equal(osVuoto, "Windows Server 2022");
    assert.equal(osPieno, "Windows Server 2019 Standard");

    const lettura = leggiPrimaLettura(d, vuoto);
    assert.ok(lettura);
    assert.equal(lettura.os, "Windows Server 2022");
    assert.equal(lettura.os_fonte, "ntlm");
    assert.equal(lettura.dominio, "corp.local");
    assert.equal(lettura.servizi.length, 1);
    assert.equal(lettura.servizi[0]!.porta, 445);
    assert.equal(lettura.altri_ip.length, 0);
  });
});
