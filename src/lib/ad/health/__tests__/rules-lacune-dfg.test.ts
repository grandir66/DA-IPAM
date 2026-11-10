/**
 * Lacune rispetto ad ad-doctor, blocchi D (DNS), F (infrastruttura) e G (Entra).
 *
 * Run: node --import tsx --test src/lib/ad/health/__tests__/rules-lacune-dfg.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lacuneDfgRules } from "../rules/lacune-dfg";
import { dnsAllowUpdate, sysvolReplicationFromFlags, zoneBroadWriters } from "../infra-extras";
import { getRuleGuide } from "../rule-catalog";
import type { AdComputerRow, AdGroupRow, AdUserRow, HealthFinding, InfraExtras, RuleContext } from "../types";

const NOW = new Date("2026-07-25T12:00:00.000Z");
const RECENT = "2026-07-20T00:00:00.000Z";
const BASE = "DC=prova,DC=local";

function user(sam: string, partial: Partial<AdUserRow> = {}): AdUserRow {
  return {
    samAccountName: sam,
    distinguishedName: `CN=${sam},CN=Users,${BASE}`,
    enabled: true,
    lastLogonAt: RECENT,
    passwordLastSetAt: RECENT,
    uac: 0,
    servicePrincipalNames: [],
    memberOfDns: [],
    primaryGroupId: null,
    adminCount: null,
    description: null,
    sidHistory: [],
    allowedToDelegateTo: [],
    ...partial,
  };
}

function computer(sam: string, partial: Partial<AdComputerRow> = {}): AdComputerRow {
  return {
    samAccountName: `${sam}$`,
    distinguishedName: `CN=${sam},CN=Computers,${BASE}`,
    enabled: true,
    lastLogonAt: RECENT,
    passwordLastSetAt: RECENT,
    operatingSystem: "Windows Server 2019",
    uac: 0,
    isDomainController: false,
    isRodc: false,
    allowedToDelegateTo: [],
    allowedToActOnBehalfOf: false,
    lapsState: "non_verificabile",
    ...partial,
  };
}

function group(sam: string, memberDns: string[]): AdGroupRow {
  return { samAccountName: sam, distinguishedName: `CN=${sam},CN=Users,${BASE}`, memberDns };
}

function ctx(partial: Partial<RuleContext>): RuleContext {
  return {
    now: NOW,
    domainFqdn: "prova.local",
    users: [],
    computers: [],
    groups: [],
    trusts: [],
    krbtgtPasswordLastSetAt: RECENT,
    guestEnabled: false,
    recycleBinEnabled: true,
    minPwdLength: 14,
    lockoutThreshold: 5,
    machineAccountQuota: 0,
    lapsSchemaPresent: null,
    ldapsConfigured: true,
    ...partial,
  };
}

function run(id: string, c: RuleContext): HealthFinding | null {
  const rule = lacuneDfgRules.find((r) => r.id === id);
  assert.ok(rule, `regola ${id} assente`);
  return rule.run(c);
}

function infra(partial: Partial<InfraExtras>): InfraExtras {
  return {
    dnsZones: [],
    dnsWildcardDns: [],
    dsHeuristics: "",
    sysvolReplication: "dfsr",
    rodcPolicies: [],
    dmsas: [],
    entraSyncedPrivilegedDns: [],
    ...partial,
  };
}

/** dNSProperty: DataLength, NameLength, Flag, Version, Id, poi il dato. */
function proprieta(id: number, valore: number): Buffer {
  const b = Buffer.alloc(22);
  b.writeUInt32LE(1, 0);
  b.writeUInt32LE(1, 12);
  b.writeUInt32LE(id, 16);
  b.writeUInt8(valore, 20);
  return b;
}

/** Descrittore di sicurezza minimo: una DACL con un ACE «consenti» per ogni [maschera, SID]. */
function descrittore(voci: Array<[number, number[]]>): Buffer {
  const aces = voci.map(([maschera, sub]) => {
    const sid = Buffer.alloc(8 + sub.length * 4);
    sid.writeUInt8(1, 0);
    sid.writeUInt8(sub.length, 1);
    sid.writeUInt8(5, 7);
    sub.forEach((v, i) => sid.writeUInt32LE(v, 8 + i * 4));
    const ace = Buffer.alloc(8 + sid.length);
    ace.writeUInt8(0, 0);
    ace.writeUInt16LE(ace.length, 2);
    ace.writeUInt32LE(maschera, 4);
    sid.copy(ace, 8);
    return ace;
  });
  const corpo = Buffer.concat(aces);
  const acl = Buffer.alloc(8);
  acl.writeUInt8(2, 0);
  acl.writeUInt16LE(8 + corpo.length, 2);
  acl.writeUInt16LE(aces.length, 4);
  const testa = Buffer.alloc(20);
  testa.writeUInt8(1, 0);
  testa.writeUInt16LE(0x8004, 2);
  testa.writeUInt32LE(20, 16);
  return Buffer.concat([testa, acl, corpo]);
}

test("ogni regola ha la sua voce nel catalogo italiano", () => {
  assert.equal(lacuneDfgRules.length, 12);
  for (const r of lacuneDfgRules) assert.notEqual(getRuleGuide(r.id).titleIt, r.id, `manca ${r.id}`);
});

test("senza raccolta (infra assente o campi a null) nessuna regola scatta", () => {
  const vuoto = infra({ dnsZones: null, dnsWildcardDns: null, dsHeuristics: null, sysvolReplication: null, rodcPolicies: null, dmsas: null, entraSyncedPrivilegedDns: null });
  for (const r of lacuneDfgRules) {
    assert.equal(r.run(ctx({})), null, r.id);
    assert.equal(r.run(ctx({ infra: vuoto })), null, r.id);
  }
});

test("dNSProperty: si legge il modo degli aggiornamenti, non le altre proprietà", () => {
  assert.equal(dnsAllowUpdate([proprieta(1, 1), proprieta(2, 2)]), 2);
  assert.equal(dnsAllowUpdate(proprieta(2, 1)), 1);
  assert.equal(dnsAllowUpdate([proprieta(1, 1)]), null);
  assert.equal(dnsAllowUpdate([Buffer.alloc(4)]), null);
  assert.equal(dnsAllowUpdate(undefined), null);
});

test("zona DNS: aggiornamenti non sicuri sì, solo sicuri o non letto no", () => {
  const zona = (name: string, allowUpdate: number | null) => ({ dn: `DC=${name},CN=MicrosoftDNS,DC=DomainDnsZones,${BASE}`, name, allowUpdate, broadWriters: [] });
  const f = run("DA-A-DnsZoneInsecureUpdate", ctx({ infra: infra({ dnsZones: [zona("aperta.local", 1), zona("sicura.local", 2), zona("ignota.local", null)] }) }));
  assert.deepEqual(f?.raw, { zones: ["aperta.local"] });
  assert.equal(run("DA-A-DnsZoneInsecureUpdate", ctx({ infra: infra({ dnsZones: [zona("sicura.local", 2)] }) })), null);
});

test("delega della zona: creare record è di serie, scrivere o cambiare ACL no", () => {
  const CREATE_CHILD = 0x1;
  assert.deepEqual(zoneBroadWriters(descrittore([[CREATE_CHILD, [11]]])), []);
  assert.deepEqual(zoneBroadWriters(descrittore([[0x20, [11]], [0x40000, [21, 1, 2, 3, 513]], [0xf01ff, [21, 1, 2, 3, 1150]]])), ["S-1-5-11", "S-1-5-21-1-2-3-513"]);
  assert.equal(zoneBroadWriters(undefined), null);
  assert.equal(zoneBroadWriters(Buffer.from([1, 2, 3])), null);
  const zona = { dn: `DC=z,${BASE}`, name: "z", allowUpdate: 2, broadWriters: ["S-1-5-11"] };
  assert.equal(run("DA-A-DnsZoneBroadWrite", ctx({ infra: infra({ dnsZones: [zona] }) }))?.objectCount, 1);
  assert.equal(run("DA-A-DnsZoneBroadWrite", ctx({ infra: infra({ dnsZones: [{ ...zona, broadWriters: null }] }) })), null);
});

test("record jolly: indizio fuori dal punteggio", () => {
  const f = run("DA-A-DnsWildcardRecord", ctx({ infra: infra({ dnsWildcardDns: [`DC=*,DC=z,${BASE}`] }) }));
  assert.equal(f?.diagnostic, true);
  assert.equal(f?.points, 0);
});

test("dSHeuristics: settimo carattere 2 = anonimo, sedicesimo diverso da 0 = AdminSDHolder ridotto", () => {
  assert.equal(run("DA-A-AnonymousLdapOps", ctx({ infra: infra({ dsHeuristics: "0000002" }) }))?.points, 20);
  assert.equal(run("DA-A-AnonymousLdapOps", ctx({ infra: infra({ dsHeuristics: "0000000" }) })), null);
  assert.equal(run("DA-A-AnonymousLdapOps", ctx({ infra: infra({ dsHeuristics: "" }) })), null);
  assert.deepEqual(run("DA-P-AdminSdExMask", ctx({ infra: infra({ dsHeuristics: "000000000100000f" }) }))?.raw, { dsHeuristics: "000000000100000f", mask: "f" });
  assert.equal(run("DA-P-AdminSdExMask", ctx({ infra: infra({ dsHeuristics: "0000000001000000" }) })), null);
  assert.equal(run("DA-P-AdminSdExMask", ctx({ infra: infra({ dsHeuristics: "0000002" }) })), null);
});

test("SYSVOL: FRS e migrazione a metà sì, DFSR no", () => {
  assert.equal(sysvolReplicationFromFlags(48, false), "dfsr");
  assert.equal(sysvolReplicationFromFlags(16, false), "migrating");
  assert.equal(sysvolReplicationFromFlags(null, true), "frs");
  assert.equal(sysvolReplicationFromFlags(null, false), null);
  assert.deepEqual(run("DA-A-SysvolFrs", ctx({ infra: infra({ sysvolReplication: "frs" }) }))?.raw, { state: "frs" });
  assert.ok(run("DA-A-SysvolFrs", ctx({ infra: infra({ sysvolReplication: "migrating" }) })));
  assert.equal(run("DA-A-SysvolFrs", ctx({ infra: infra({ sysvolReplication: "dfsr" }) })), null);
});

test("domain controller fuori dalla sua OU", () => {
  const dentro = computer("DC01", { isDomainController: true, distinguishedName: `CN=DC01,OU=Domain Controllers,${BASE}` });
  const fuori = computer("DC02", { isDomainController: true, distinguishedName: `CN=DC02,OU=Server,${BASE}` });
  const spento = computer("DC03", { isDomainController: true, enabled: false });
  assert.deepEqual(run("DA-A-DcOutsideDcOu", ctx({ computers: [dentro, fuori, spento, computer("SRV01")] }))?.sampleDns, [fuori.distinguishedName]);
  assert.equal(run("DA-A-DcOutsideDcOu", ctx({ computers: [dentro] })), null);
});

test("RODC: privilegiati o gruppi ampi fra i consentiti, o nessun negato", () => {
  const admin = user("admin");
  const da = group("Domain Admins", [admin.distinguishedName]);
  const negati = `CN=Denied RODC Password Replication Group,CN=Users,${BASE}`;
  const c = (revealDns: string[], neverRevealDns: string[]) =>
    ctx({ users: [admin], groups: [da], infra: infra({ rodcPolicies: [{ dn: `CN=RODC01,OU=Domain Controllers,${BASE}`, revealDns, neverRevealDns }] }) });
  assert.equal(run("DA-P-RodcPasswordPolicy", c([`CN=Filiale,OU=Gruppi,${BASE}`], [negati])), null);
  assert.ok(run("DA-P-RodcPasswordPolicy", c([da.distinguishedName], [negati])));
  assert.ok(run("DA-P-RodcPasswordPolicy", c([admin.distinguishedName], [negati])));
  assert.ok(run("DA-P-RodcPasswordPolicy", c([`CN=Domain Users,CN=Users,${BASE}`], [negati])));
  assert.ok(run("DA-P-RodcPasswordPolicy", c([], [])));
});

test("dMSA: conta solo se succede a un account privilegiato", () => {
  const admin = user("admin");
  const protetto = user("protetto", { adminCount: 1 });
  const normale = user("normale");
  const da = group("Domain Admins", [admin.distinguishedName]);
  const dmsa = (n: string, precededByDn: string | null) => ({ dn: `CN=${n},CN=Managed Service Accounts,${BASE}`, precededByDn });
  const f = run("DA-P-DmsaSupersedesPrivileged", ctx({
    users: [admin, protetto, normale],
    groups: [da],
    infra: infra({ dmsas: [dmsa("a", admin.distinguishedName), dmsa("b", protetto.distinguishedName), dmsa("c", normale.distinguishedName), dmsa("d", null)] }),
  }));
  assert.equal(f?.objectCount, 2);
  assert.equal(run("DA-P-DmsaSupersedesPrivileged", ctx({ users: [normale], groups: [da], infra: infra({ dmsas: [dmsa("c", normale.distinguishedName)] }) })), null);
});

test("Seamless SSO: chiave più vecchia di 30 giorni", () => {
  const vecchia = computer("AZUREADSSOACC", { passwordLastSetAt: "2026-01-01T00:00:00.000Z" });
  assert.equal(run("DA-S-AzureSsoKeyOld", ctx({ computers: [vecchia] }))?.raw?.ageDays, 205);
  assert.equal(run("DA-S-AzureSsoKeyOld", ctx({ computers: [computer("AZUREADSSOACC")] })), null);
  assert.equal(run("DA-S-AzureSsoKeyOld", ctx({ computers: [computer("SRV01", { passwordLastSetAt: "2026-01-01T00:00:00.000Z" })] })), null);
});

test("account di sincronizzazione Entra in un gruppo privilegiato", () => {
  const msol = user("MSOL_0a1b2c3d4e5f");
  const da = group("Domain Admins", [msol.distinguishedName]);
  assert.deepEqual(run("DA-P-EntraSyncAccountPrivileged", ctx({ users: [msol], groups: [da] }))?.sampleDns, [msol.distinguishedName]);
  assert.equal(run("DA-P-EntraSyncAccountPrivileged", ctx({ users: [msol], groups: [group("Domain Admins", [])] })), null);
});

test("privilegiati sincronizzati con Entra: solo se Entra Connect c'è", () => {
  const admin = user("admin", { adminCount: 1 });
  const ex = user("ex", { adminCount: 1 });
  const da = group("Domain Admins", [admin.distinguishedName]);
  const dati = infra({ entraSyncedPrivilegedDns: [admin.distinguishedName, ex.distinguishedName] });
  assert.equal(run("DA-P-PrivilegedSyncedToEntra", ctx({ users: [admin, ex], groups: [da], infra: dati })), null);
  const f = run("DA-P-PrivilegedSyncedToEntra", ctx({ users: [admin, ex, user("MSOL_0a1b2c3d4e5f")], groups: [da], infra: dati }));
  assert.deepEqual(f?.sampleDns, [admin.distinguishedName]);
});
