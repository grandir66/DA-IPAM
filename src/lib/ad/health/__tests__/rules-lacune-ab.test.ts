/**
 * Lacune rispetto ad ad-doctor, blocchi A e B.
 *
 * Run: node --import tsx --test src/lib/ad/health/__tests__/rules-lacune-ab.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { lacuneAbRules } from "../rules/lacune-ab";
import { gmsaReadersRow } from "../ldap-extras";
import { UAC } from "../uac";
import type { AdComputerRow, AdGroupRow, AdUserRow, HealthFinding, RuleContext } from "../types";

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
  const rule = lacuneAbRules.find((r) => r.id === id);
  assert.ok(rule, `regola ${id} assente`);
  return rule.run(c);
}

test("gruppo primario privilegiato: l'utente non è fra i membri ma viene trovato", () => {
  const nascosto = user("nascosto", { primaryGroupId: 512 });
  const c = ctx({ users: [nascosto, user("normale", { primaryGroupId: 513 })], groups: [group("Domain Admins", [])] });
  const f = run("DA-P-PrimaryGroupHidden", c);
  assert.deepEqual(f?.sampleDns, [nascosto.distinguishedName]);
  assert.equal(run("DA-P-PrimaryGroupHidden", ctx({ users: [user("normale", { primaryGroupId: 513 })], groups: [group("Domain Admins", [])] })), null);
});

test("account disabilitato in un gruppo privilegiato", () => {
  const spento = user("spento", { enabled: false });
  const acceso = user("acceso");
  const c = ctx({ users: [spento, acceso], groups: [group("Domain Admins", [spento.distinguishedName, acceso.distinguishedName])] });
  assert.deepEqual(run("DA-P-DisabledInPrivilegedGroup", c)?.sampleDns, [spento.distinguishedName]);
});

test("computer in un gruppo privilegiato, anche annidato; Domain Controllers non conta", () => {
  const srv = computer("SRV01");
  const dc = computer("DC01", { isDomainController: true });
  const c = ctx({
    computers: [srv, dc],
    groups: [
      group("Domain Admins", [`CN=Server,CN=Users,${BASE}`]),
      group("Server", [srv.distinguishedName]),
      group("Domain Controllers", [dc.distinguishedName]),
    ],
  });
  assert.deepEqual(run("DA-P-ComputerInPrivilegedGroup", c)?.sampleDns, [srv.distinguishedName]);
});

test("Schema Admins popolato; Enterprise Admins col solo Administrator non è un rilievo", () => {
  const adm = user("Administrator");
  const altro = user("mario");
  const solo = ctx({ users: [adm], groups: [group("Enterprise Admins", [adm.distinguishedName]), group("Schema Admins", [])] });
  assert.equal(run("DA-P-EnterpriseAdminsPopulated", solo), null);
  assert.equal(run("DA-P-SchemaAdminsPopulated", solo), null);
  const pieno = ctx({
    users: [adm, altro],
    groups: [group("Enterprise Admins", [adm.distinguishedName, altro.distinguishedName]), group("Schema Admins", [adm.distinguishedName])],
  });
  assert.deepEqual(run("DA-P-EnterpriseAdminsPopulated", pieno)?.sampleDns, [altro.distinguishedName]);
  assert.equal(run("DA-P-SchemaAdminsPopulated", pieno)?.objectCount, 1);
});

test("membri non identificati: rilievo da verificare, fuori dal punteggio", () => {
  const fsp = `CN=S-1-5-21-9-9-9-1104,CN=ForeignSecurityPrincipals,${BASE}`;
  const gmsa = `CN=svc-web,CN=Managed Service Accounts,${BASE}`;
  const noto = user("noto");
  const c = ctx({ users: [noto], groups: [group("Domain Admins", [fsp, gmsa, noto.distinguishedName])] });
  const f = run("DA-P-UnresolvedPrivilegedMember", c);
  assert.equal(f?.diagnostic, true);
  assert.equal(f?.points, 0);
  assert.deepEqual(f?.raw, { foreignSecurityPrincipals: 1, other: 1 });
  assert.equal(f?.objectCount, 2);
});

test("solo DES: utenti e computer abilitati", () => {
  const des = user("vecchio", { uac: UAC.USE_DES_KEY_ONLY });
  const spento = user("spento", { uac: UAC.USE_DES_KEY_ONLY, enabled: false });
  const pc = computer("PC1", { uac: UAC.USE_DES_KEY_ONLY });
  const f = run("DA-S-DesOnly", ctx({ users: [des, spento], computers: [pc] }));
  assert.deepEqual(f?.sampleDns, [des.distinguishedName, pc.distinguishedName]);
});

test("attributi con password: conta la presenza; non letto o vuoto = nessun rilievo", () => {
  assert.equal(run("DA-A-PwdAttributePresent", ctx({ passwordAttributeRows: null })), null);
  assert.equal(run("DA-A-PwdAttributePresent", ctx({ passwordAttributeRows: [] })), null);
  const dn = `CN=mario,CN=Users,${BASE}`;
  const f = run(
    "DA-A-PwdAttributePresent",
    ctx({ passwordAttributeRows: [{ dn, attribute: "userPassword" }, { dn, attribute: "unixUserPassword" }] }),
  );
  assert.equal(f?.objectCount, 1);
  assert.deepEqual(f?.raw, { perAttribute: { userPassword: 1, unixUserPassword: 1 } });
});

test("computer pre-creato: solo indizio, i DC e chi ha già fatto un accesso sono esclusi", () => {
  const pre = computer("NUOVO", { uac: UAC.PASSWD_NOTREQD, lastLogonAt: null });
  const usato = computer("USATO", { uac: UAC.PASSWD_NOTREQD });
  const f = run("DA-S-PreCreatedComputer", ctx({ computers: [pre, usato] }));
  assert.deepEqual(f?.sampleDns, [pre.distinguishedName]);
  assert.equal(f?.diagnostic, true);
});

/** Descrittore di sicurezza minimo: una DACL con un ACE «consenti» per ogni SID. */
function descrittore(sids: number[][]): Buffer {
  const aces = sids.map((sub) => {
    const sid = Buffer.alloc(8 + sub.length * 4);
    sid.writeUInt8(1, 0);
    sid.writeUInt8(sub.length, 1);
    sid.writeUInt8(5, 7);
    sub.forEach((v, i) => sid.writeUInt32LE(v, 8 + i * 4));
    const ace = Buffer.alloc(8 + sid.length);
    ace.writeUInt8(0, 0);
    ace.writeUInt16LE(ace.length, 2);
    ace.writeUInt32LE(0xf01ff, 4);
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

test("gMSA: Authenticated Users e Domain Computers sono lettori ampi, un gruppo dedicato no", () => {
  const dn = `CN=svc-web,CN=Managed Service Accounts,${BASE}`;
  const largo = gmsaReadersRow({ distinguishedName: dn, "msDS-GroupMSAMembership": descrittore([[11], [21, 1, 2, 3, 515]]) });
  assert.deepEqual(largo.broadSids, ["S-1-5-11", "S-1-5-21-1-2-3-515"]);
  const stretto = gmsaReadersRow({ distinguishedName: dn, "msDS-GroupMSAMembership": [descrittore([[21, 1, 2, 3, 1150]])] });
  assert.equal(stretto.readable, true);
  assert.deepEqual(stretto.broadSids, []);
  assert.equal(gmsaReadersRow({ distinguishedName: dn }).readable, false);

  assert.equal(run("DA-P-GmsaBroadReaders", ctx({ gmsaReaders: [stretto] })), null);
  assert.deepEqual(run("DA-P-GmsaBroadReaders", ctx({ gmsaReaders: [stretto, largo] }))?.raw, {
    broadSids: ["S-1-5-11", "S-1-5-21-1-2-3-515"],
  });
});
