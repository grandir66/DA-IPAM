/**
 * Controlli dei giri: findings da JSON già salvato, senza rete.
 * Run: node --import tsx --test src/lib/rilievi/__tests__/controlli.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TETTO_FABBRICA_PER_HOST,
  algoritmiSshDeboli,
  controlloDaJson,
  eSshVecchio,
  nomeConsolaWeb,
  rilieviDaControllo,
  rilieviDaHttp,
  rilieviDaNtlm,
  rilieviDaPorta,
  rilieviDaSsh,
} from "../controlli";
import type { InfoHttp, InfoNtlm } from "@/lib/servizi-rete/sonde";

const CTX = {
  host_id: 4,
  ip: "10.0.0.8",
  hostname: null,
  network_id: 1,
  network_name: "lan",
  porta: 445,
};

test("eSshVecchio: OpenSSH sotto 8 e SSH-1 sì, 9 no", () => {
  assert.equal(eSshVecchio("SSH-2.0-OpenSSH_7.4p1"), true);
  assert.equal(eSshVecchio("SSH-1.99-OpenSSH_3.9"), true);
  assert.equal(eSshVecchio("SSH-2.0-OpenSSH_9.6p1"), false);
  assert.equal(eSshVecchio(null), false);
});

test("SMB senza firma: Medium; con firma obbligatoria niente", () => {
  const n: InfoNtlm = {
    netbios: "PC",
    dominio_netbios: "LAN",
    dns_computer: null,
    dominio_dns: null,
    versione_os: "10.0",
    fonte: "smb",
    smb_signing: false,
  };
  const r = rilieviDaNtlm(n, CTX);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "Medium");
  assert.match(r[0]!.titolo, /SMB/);
  assert.equal(rilieviDaNtlm({ ...n, smb_signing: true }, CTX).length, 0);
});

test("RDP senza NLA: Medium", () => {
  const n: InfoNtlm = {
    netbios: null,
    dominio_netbios: null,
    dns_computer: null,
    dominio_dns: null,
    versione_os: null,
    fonte: "rdp",
    rdp_nla: false,
  };
  const r = rilieviDaNtlm(n, { ...CTX, porta: 3389 });
  assert.equal(r[0]!.gravita, "Medium");
  assert.match(r[0]!.titolo, /NLA/);
});

test("RDP Standard (senza TLS) vince su NLA: High", () => {
  const n: InfoNtlm = {
    netbios: null,
    dominio_netbios: null,
    dns_computer: null,
    dominio_dns: null,
    versione_os: null,
    fonte: "rdp",
    rdp_nla: false,
    rdp_tls: false,
  };
  const r = rilieviDaNtlm(n, { ...CTX, porta: 3389 });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "High");
  assert.match(r[0]!.titolo, /Standard/);
});

test("consola web da titolo Jenkins; nginx no", () => {
  const http = (title: string | null, server: string | null): InfoHttp => ({
    scheme: "http",
    status_code: 200,
    status_text: "OK",
    title,
    server,
    location: null,
    content_type: "text/html",
    headers: {},
    body_sha256: null,
  });
  assert.equal(nomeConsolaWeb(http("Dashboard [Jenkins]", null)), "Jenkins");
  assert.equal(nomeConsolaWeb(http("CUPS 2.4", null)), "CUPS");
  assert.equal(nomeConsolaWeb(http("Welcome", "nginx/1.27")), null);
  const r = rilieviDaHttp(http("phpMyAdmin", null), { ...CTX, porta: 80 });
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "Low");
});

test("Redis PING senza autenticazione: Critical (Riccardo 10/11: senza password = critico); JSON rotto: null", () => {
  const r = rilieviDaControllo({ redis_aperto: true }, { ...CTX, porta: 6379 });
  assert.equal(r[0]!.gravita, "Critical");
  assert.equal(controlloDaJson("nope"), null);
  assert.equal(controlloDaJson(JSON.stringify({ redis_aperto: true }))?.redis_aperto, true);
});

test("SSH vecchio produce un rilievo; ident nuovo no", () => {
  assert.equal(rilieviDaSsh({ ident: "SSH-2.0-OpenSSH_7.9" }, { ...CTX, porta: 22 }).length, 1);
  assert.equal(rilieviDaSsh({ ident: "SSH-2.0-OpenSSH_9.6" }, { ...CTX, porta: 22 }).length, 0);
});

test("SSH con group1 e 3des: Low; curve25519 niente", () => {
  const deboli = algoritmiSshDeboli({
    kex: ["diffie-hellman-group1-sha1", "curve25519-sha256"],
    cifrari: ["3des-cbc", "aes256-ctr"],
    mac: ["hmac-md5", "hmac-sha2-256"],
  });
  assert.ok(deboli.some((a) => /group1/.test(a)));
  assert.ok(deboli.some((a) => /3des/.test(a)));
  assert.ok(deboli.some((a) => /hmac-md5/.test(a)));
  const r = rilieviDaSsh(
    { ident: "SSH-2.0-OpenSSH_9.6", kex: ["diffie-hellman-group1-sha1"], cifrari: [], mac: [] },
    { ...CTX, porta: 22 },
  );
  assert.equal(r.length, 1);
  assert.equal(r[0]!.gravita, "Low");
  assert.equal(algoritmiSshDeboli({ kex: ["curve25519-sha256"], cifrari: ["aes256-gcm@openssh.com"], mac: ["hmac-sha2-256"] }).length, 0);
});

test("Telnet 23 Medium, WinRM Low, possibile WSUS Low, WSUS con TLS niente", () => {
  const telnet = rilieviDaPorta({ ...CTX, porta: 23 }, false);
  assert.equal(telnet[0]!.gravita, "Medium");
  assert.match(telnet[0]!.titolo, /Telnet/);
  const winrm = rilieviDaPorta({ ...CTX, porta: 5985 }, false);
  assert.equal(winrm[0]!.gravita, "Low");
  const wsus = rilieviDaPorta({ ...CTX, porta: 8530 }, false);
  assert.equal(wsus[0]!.gravita, "Low");
  assert.equal(rilieviDaPorta({ ...CTX, porta: 8530 }, true).length, 0);
  assert.equal(rilieviDaPorta({ ...CTX, porta: 22 }, false).length, 0);
  const rpc = rilieviDaPorta({ ...CTX, porta: 135 }, false);
  assert.equal(rpc[0]!.gravita, "Medium");
  const rsh = rilieviDaPorta({ ...CTX, porta: 514 }, false);
  assert.equal(rsh[0]!.gravita, "Medium");
  assert.match(rsh[0]!.titolo, /rsh/);
  const ipp = rilieviDaPorta({ ...CTX, porta: 631 }, false);
  assert.equal(ipp[0]!.gravita, "Low");
});

test("SMBv1, sessione anonima e EternalBlue dal JSON", () => {
  const r = rilieviDaControllo(
    { smbv1: true, smb_null: true, ms17_010: true },
    CTX,
  );
  assert.ok(r.some((x) => x.id.includes("smbv1") && x.gravita === "Medium"));
  assert.ok(r.some((x) => x.id.includes("smb-null")));
  assert.ok(r.some((x) => x.id.includes("ms17-010") && x.gravita === "Critical"));
  assert.equal(controlloDaJson(JSON.stringify({ smbv1: true, smb_share_anon: ["Users"] }))?.smb_share_anon?.[0], "Users");
});

test("Memcached e IPMI esposto; cipher0 vince su ping", () => {
  const m = rilieviDaControllo({ memcached: true }, { ...CTX, porta: 11211 });
  assert.equal(m[0]!.gravita, "Critical");
  const ipmi = rilieviDaControllo({ ipmi_esposto: true }, { ...CTX, porta: 623 });
  assert.equal(ipmi.length, 1);
  assert.match(ipmi[0]!.titolo, /IPMI/);
  const c0 = rilieviDaControllo({ ipmi_esposto: true, ipmi_cipher0: true }, { ...CTX, porta: 623 });
  assert.equal(c0.length, 1);
  assert.match(c0[0]!.titolo, /cipher zero/);
});

test("tetto login di fabbrica è 6", () => {
  assert.equal(TETTO_FABBRICA_PER_HOST, 6);
});

test("NFS *, DNS AXFR, SSH password e vecchi risultati non confermati", () => {
  const r = rilieviDaControllo(
    { nfs_export_pubblico: true, dns_axfr: true, ssh_password: true },
    { ...CTX, porta: 389 },
  );

  assert.ok(r.some((x) => x.id.includes("nfs-stella") && x.gravita === "High"));
  assert.ok(r.some((x) => x.id.includes("dns-axfr") && x.gravita === "High"));
  assert.ok(r.some((x) => x.id.includes("ssh-password") && x.gravita === "Low"));
  const vecchio = controlloDaJson(JSON.stringify({ ldap_senza_firma: true, adcs: true, jenkins_script: true, smart_install: true }));
  assert.deepEqual(rilieviDaControllo(vecchio, CTX), []);
  const nuovo = controlloDaJson(JSON.stringify({ adcs_enrollment: true, actuator_health: true }));
  assert.deepEqual(rilieviDaControllo(nuovo, CTX).map((x) => x.gravita), ["Low", "Low"]);
});

test("VNC tipo 2 solo se non c'è None; IPMI RAKP", () => {
  const debole = rilieviDaControllo({ vnc_auth_debole: true }, { ...CTX, porta: 5900 });
  assert.equal(debole[0]!.gravita, "Medium");
  const entrambi = rilieviDaControllo({ vnc_senza_auth: true, vnc_auth_debole: true }, { ...CTX, porta: 5900 });
  assert.ok(entrambi.some((x) => x.id.includes("vnc-aperto")));
  assert.ok(!entrambi.some((x) => x.id.includes("vnc-debole")));
  const rakp = rilieviDaControllo({ ipmi_rakp: true, ipmi_cipher0: true }, { ...CTX, porta: 623 });
  assert.ok(rakp.some((x) => x.id.includes("ipmi-rakp")));
});
