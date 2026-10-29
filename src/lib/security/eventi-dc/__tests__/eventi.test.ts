/**
 * Eventi di sicurezza dai DC senza Wazuh (29/10/2026): XPath, lettura della risposta di PowerShell,
 * classificazione, cursore e grafici dall'archivio locale.
 *
 * Run: node --import tsx --test src/lib/security/eventi-dc/__tests__/eventi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  classificaEvento,
  comeAlert,
  eAllarme,
  gruppoPrivilegiato,
  leggiRispostaDc,
  motivoFallimento,
  prossimoCursore,
  queryListRegistro,
  scriptEventiDc,
  xpathEventi,
  xpathRegistro,
  type EventoGrezzo,
} from "../eventi";
import { ensureEventiDcSchema, salvaEventiDc } from "../db";
import { bucketDa, statisticheDc } from "../statistiche";
import { motivoPerNonLeggere } from "../raccolta";

const grezzo = (eventId: number, dati: Record<string, string>, record = 100, quando = "2026-10-29T08:15:00.000Z"): EventoGrezzo => ({ record, quando, eventId, dati });

test("la XPath riparte dal cursore e scarta sul DC i 4776 riusciti", () => {
  const x = xpathEventi(1234);
  assert.match(x, /EventRecordID>1234/);
  assert.match(x, /EventID=4625/);
  assert.match(x, /EventID=4740/);
  assert.match(x, /EventID=4776 and EventRecordID>1234\] and EventData\[Data\[@Name='Status'\]!='0x0'\]/);
  assert.doesNotMatch(x.split(" or *[System[EventID=4776")[0]!, /EventID=4776/, "4776 solo nel ramo con il filtro sullo stato");
});

test("senza cursore la XPath guarda le ultime 24 ore", () => {
  assert.match(xpathEventi(null), /timediff\(@SystemTime\) <= 86400000/);
  assert.doesNotMatch(xpathEventi(null), /EventRecordID/);
});

test("lo script raddoppia gli apici della XPath dentro la stringa PowerShell", () => {
  const s = scriptEventiDc(5);
  assert.match(s, /Data\[@Name=''Status''\]!=''0x0''/);
  assert.match(s, /-Oldest -MaxEvents 2000/);
});

test("lo script dà a ConvertTo-Json solo pscustomobject (PowerShell 5.1 dei DC: «Argument types do not match»)", () => {
  const s = scriptEventiDc(null);
  assert.doesNotMatch(s, /List\[object\]/);
  assert.doesNotMatch(s, /\n@\{ nuovo/);
  assert.match(s, /\[pscustomobject\]@\{ registro = \[string\]\$nome; nuovo = \$nuovo;/);
  assert.match(s, /\[pscustomobject\]@\{ registri = \$out \} \| ConvertTo-Json/);
  assert.match(s, /d = \[pscustomobject\]\$d/);
});

test("risposta di PowerShell: BOM davanti, un solo evento come oggetto nudo, ordine per record", () => {
  const r = leggiRispostaDc('﻿  {"nuovo":900,"vecchio":10,"errore":null,"eventi":{"r":"55","t":"2026-10-29T08:00:00.0000000Z","id":4625,"d":{"TargetUserName":"mrossi","IpAddress":"::ffff:10.0.0.7"}}}');
  assert.equal(r.nuovo, 900);
  assert.equal(r.vecchio, 10);
  assert.equal(r.eventi.length, 1);
  assert.equal(r.eventi[0]!.record, 55);
  assert.equal(r.eventi[0]!.quando, "2026-10-29T08:00:00.000Z");
  const due = leggiRispostaDc('{"nuovo":3,"vecchio":1,"eventi":[{"r":3,"t":"2026-10-29T08:00:01Z","id":4740,"d":{}},{"r":2,"t":"2026-10-29T08:00:00Z","id":4625,"d":{}}]}');
  assert.deepEqual(due.eventi.map((e) => e.record), [2, 3]);
  assert.throws(() => leggiRispostaDc("Accesso negato"), /senza JSON/);
});

test("motivi in italiano da SubStatus, Status e codici Kerberos", () => {
  assert.equal(motivoFallimento(4625, { Status: "0xC000006D", SubStatus: "0xC000006A" }), "password errata");
  assert.equal(motivoFallimento(4625, { Status: "0xC000006D", SubStatus: "0xC0000064" }), "utente inesistente");
  assert.equal(motivoFallimento(4776, { Status: "0xC0000234" }), "account bloccato");
  assert.equal(motivoFallimento(4771, { FailureCode: "0x18" }), "password errata");
  assert.equal(motivoFallimento(4771, { FailureCode: "0x99" }), "codice Kerberos 0x99");
});

test("4625: utente, IP senza ::ffff:, postazione, categoria degli accessi falliti", () => {
  const e = classificaEvento("DC01.cliente.local", grezzo(4625, { TargetUserName: "mrossi", TargetDomainName: "CLIENTE", IpAddress: "::ffff:10.0.0.7", WorkstationName: "PC-07", SubStatus: "0xC000006A" }))!;
  assert.equal(e.categoria, "auth_failure");
  assert.equal(e.account, "mrossi");
  assert.equal(e.ip, "10.0.0.7");
  assert.equal(e.postazione, "PC-07");
  assert.equal(e.livello, 5);
  const a = comeAlert(e);
  assert.equal(a.agentId, "dc:dc01.cliente.local");
  assert.equal(a.ruleId, "dc-4625");
  assert.equal(a.ruleDescription, "Accesso non riuscito (password errata)");
  assert.ok(a.groups.includes("windows"), "il filtro «Windows» dell'elenco lo prende");
});

test("4740: la postazione da cui arrivano i tentativi sta nel chiamante", () => {
  const e = classificaEvento("DC01", grezzo(4740, { TargetUserName: "mrossi", TargetDomainName: "PC-07", SubjectUserName: "DC01$" }))!;
  assert.equal(e.postazione, "PC-07");
  assert.equal(e.dominio, null);
  assert.equal(e.livello, 10);
});

test("aggiunta a Domain Admins: membro dal DN, gruppo nella descrizione, livello 12 (notifica subito)", () => {
  const e = classificaEvento("DC01", grezzo(4728, { TargetUserName: "Domain Admins", TargetSid: "S-1-5-21-1-2-3-512", MemberName: "CN=Mario Rossi,OU=Utenti,DC=cliente,DC=local", SubjectUserName: "admin" }))!;
  assert.equal(e.categoria, "privileged_change");
  assert.equal(e.account, "Mario Rossi");
  assert.equal(e.autore, "admin");
  assert.equal(e.descrizione, "Membro aggiunto a un gruppo globale: Domain Admins");
  assert.equal(e.livello, 12);
  const normale = classificaEvento("DC01", grezzo(4728, { TargetUserName: "Contabilità", TargetSid: "S-1-5-21-1-2-3-1105", MemberName: "CN=Mario Rossi,DC=x" }))!;
  assert.equal(normale.livello, 8);
  assert.ok(gruppoPrivilegiato("S-1-5-32-544"));
  assert.ok(!gruppoPrivilegiato("S-1-5-21-1-2-3-5120"));
});

test("le nostre sonde non sono un attacco: self_probe", () => {
  const e = classificaEvento("DC01", grezzo(4625, { TargetUserName: "CLIENTE\\svc-ipam", IpAddress: "10.0.0.2" }), { ips: [], accounts: ["svc-ipam"] })!;
  assert.equal(e.categoria, "self_probe");
});

test("login e logout: 4768 riuscito è un accesso al dominio, rifiutato è un fallimento; 4624 col tipo", () => {
  const ok = classificaEvento("DC01", grezzo(4768, { TargetUserName: "mrossi", IpAddress: "::ffff:10.0.0.7", Status: "0x0" }))!;
  assert.equal(ok.categoria, "accesso");
  assert.equal(ok.motivo, null);
  assert.equal(ok.ip, "10.0.0.7");
  assert.ok(!eAllarme(ok.categoria), "un login non va fra gli allarmi");
  const no = classificaEvento("DC01", grezzo(4768, { TargetUserName: "mrossi", Status: "0x12" }))!;
  assert.equal(no.categoria, "auth_failure");
  assert.equal(no.motivo, "account disabilitato, bloccato o scaduto");
  assert.equal(classificaEvento("DC01", grezzo(4624, { TargetUserName: "admin", LogonType: "10" }))!.descrizione, "Accesso al DC (desktop remoto)");
  assert.equal(classificaEvento("DC01", grezzo(4634, { TargetUserName: "admin", LogonType: "2" }))!.categoria, "uscita");
  const diritto = classificaEvento("DC01", grezzo(4704, { TargetSid: "S-1-5-21-1-2-3-1105", PrivilegeList: "SeDebugPrivilege", SubjectUserName: "admin" }))!;
  assert.equal(diritto.descrizione, "Diritto utente assegnato: SeDebugPrivilege");
  assert.equal(diritto.account, "S-1-5-21-1-2-3-1105");
  assert.equal(diritto.autore, "admin");
});

test("la XPath prende 4624/4634 solo di console e desktop remoto", () => {
  assert.match(xpathEventi(9), /\(EventID=4624 or EventID=4634\) and EventRecordID>9\] and EventData\[Data\[@Name='LogonType'\]='2' or Data\[@Name='LogonType'\]='10'\]/);
  assert.match(xpathEventi(9), /EventID=4768/);
});

test("il cursore riparte dall'ultimo record esaminato, anche se scartato sul DC", () => {
  assert.deepEqual(prossimoCursore(100, { nuovo: 9000, vecchio: 1, esaminato: 2100, errore: null, eventi: [] }), { record: 2100, persi: 0, ripartito: false });
  assert.deepEqual(prossimoCursore(100, { nuovo: 9000, vecchio: 1, esaminato: 2100, errore: null, eventi: [grezzo(4625, {}, 150)] }), { record: 2100, persi: 0, ripartito: false });
});

test("un ID fuori elenco non passa", () => {
  assert.equal(classificaEvento("DC01", grezzo(4672, {})), null);
});

test("cursore: avanza all'ultimo letto, si accorge del registro girato e di quello svuotato", () => {
  const r = (nuovo: number, vecchio: number, records: number[]) => ({ nuovo, vecchio, esaminato: null, errore: null, eventi: records.map((x) => grezzo(4625, {}, x)) });
  assert.deepEqual(prossimoCursore(100, r(500, 50, [120, 130])), { record: 130, persi: 0, ripartito: false });
  assert.deepEqual(prossimoCursore(100, r(500, 50, [])), { record: 500, persi: 0, ripartito: false }, "niente di nostro: si salta al più nuovo");
  assert.deepEqual(prossimoCursore(100, r(900, 300, [301])), { record: 301, persi: 199, ripartito: false });
  assert.deepEqual(prossimoCursore(1000, r(40, 1, [5])), { record: 5, persi: 0, ripartito: true });
  assert.deepEqual(prossimoCursore(null, r(80, 1, [])), { record: 80, persi: 0, ripartito: false });
});

test("auto: legge solo dove Wazuh non legge; sempre e mai come dicono", () => {
  assert.equal(motivoPerNonLeggere("auto", false), null);
  assert.equal(motivoPerNonLeggere("auto", true), "Wazuh legge già gli allarmi");
  assert.equal(motivoPerNonLeggere("sempre", true), null);
  assert.equal(motivoPerNonLeggere("mai", false), "spento per questo cliente");
});

test("bucket allineati all'epoca, dall'inizio della finestra a adesso", () => {
  const b = bucketDa("2026-10-29T07:20:00.000Z", "1h", new Date("2026-10-29T10:05:00.000Z"));
  assert.deepEqual(b.map((t) => new Date(t).toISOString()), ["2026-10-29T07:00:00.000Z", "2026-10-29T08:00:00.000Z", "2026-10-29T09:00:00.000Z", "2026-10-29T10:00:00.000Z"]);
});

test("grafici e classifiche dall'archivio dei DC, nostre sonde fuori dalle classifiche", () => {
  const db = new Database(":memory:");
  ensureEventiDcSchema(db);
  const self = { ips: [], accounts: ["svc-ipam"] };
  const ev = [
    classificaEvento("DC01", grezzo(4625, { TargetUserName: "mrossi", IpAddress: "10.0.0.7", WorkstationName: "PC-07" }, 1, "2026-10-29T08:10:00.000Z")),
    classificaEvento("DC01", grezzo(4625, { TargetUserName: "mrossi", IpAddress: "10.0.0.7" }, 2, "2026-10-29T08:20:00.000Z")),
    classificaEvento("DC02", grezzo(4771, { TargetUserName: "lbianchi", IpAddress: "10.0.0.9", FailureCode: "0x18" }, 1, "2026-10-29T09:10:00.000Z")),
    classificaEvento("DC01", grezzo(4740, { TargetUserName: "mrossi", TargetDomainName: "PC-07" }, 3, "2026-10-29T08:30:00.000Z")),
    classificaEvento("DC01", grezzo(4625, { TargetUserName: "svc-ipam", IpAddress: "10.0.0.2" }, 4, "2026-10-29T09:30:00.000Z"), self),
    classificaEvento("DC01", grezzo(4625, { TargetUserName: "vecchio" }, 5, "2026-10-20T09:30:00.000Z")),
  ].filter((e) => e !== null);
  assert.equal(salvaEventiDc(db, ev), 6);
  assert.equal(salvaEventiDc(db, ev), 0, "un record già visto non si duplica");

  const s = statisticheDc(db, { since: "2026-10-29T08:00:00.000Z", interval: "1h", ora: new Date("2026-10-29T09:59:00.000Z") });
  assert.equal(s.totals.alerts, 5);
  assert.equal(s.totals.agents, 2);
  assert.equal(s.series.length, 2);
  assert.equal(s.series[0]!.auth_failure, 3);
  assert.equal(s.series[1]!.auth_failure, 1);
  assert.equal(s.series[1]!.self_probe, 1);
  assert.equal(s.series[0]!.self_probe, 0, "categorie a 0 dove mancano");
  assert.equal(s.byCategory.find((c) => c.id === "self_probe")?.diagnostic, true);
  assert.deepEqual(s.topAccounts.map((a) => [a.account, a.count]), [["mrossi", 2], ["lbianchi", 1]], "4740 e nostre sonde fuori");
  assert.equal(s.topAccounts[0]!.sourceIp, "10.0.0.7");
  assert.equal(s.topAccounts[0]!.workstation, "PC-07");
  assert.equal(s.topAccounts[0]!.detectedBy, "DC01");
  assert.ok(!s.bySource.some((x) => x.key === "10.0.0.2"));
  assert.deepEqual(s.byTarget.map((x) => [x.key, x.count]), [["DC01", 3], ["DC02", 1]]);

  const linux = statisticheDc(db, { since: "2026-10-29T08:00:00.000Z", interval: "1h", system: "linux", ora: new Date("2026-10-29T09:59:00.000Z") });
  assert.equal(linux.totals.alerts, 0, "i DC sono solo Windows");
});

// ---- Arricchimento del 29/10: altri eventi e altri registri ----

test("ogni Select ha al massimo 10 ID semplici; i filtri di DCSync, Kerberoasting e GPO stanno sul DC", () => {
  const sel = xpathRegistro("Security", 7);
  for (const x of sel) assert.ok((x.match(/EventID=/g) ?? []).length <= 10, x);
  const tutto = sel.join("\n");
  assert.match(tutto, /EventID=4662 and EventRecordID>7\] and EventData\[Data\[@Name='AccessMask'\]='0x100'\]/);
  assert.match(tutto, /EventID=4769 .*TicketEncryptionType'\]='0x17' and Data\[@Name='Status'\]='0x0'/);
  assert.match(tutto, /AttributeLDAPDisplayName'\]='versionNumber' and Data\[@Name='ObjectClass'\]='groupPolicyContainer' or Data\[@Name='AttributeLDAPDisplayName'\]='gPLink'/);
  assert.doesNotMatch(tutto, /EventID=7045|EventID=1116/, "System e Defender hanno le loro query");
  assert.deepEqual(xpathRegistro("System", null).length, 1);
  assert.match(xpathRegistro("System", 9)[0]!, /EventID=7045\) and EventRecordID>9/);
  assert.match(xpathRegistro("Defender", null)[0]!, /EventID=1116 or EventID=1117/);
});

test("la QueryList protegge < in XML e punta al registro giusto", () => {
  const q = queryListRegistro("Defender", null);
  assert.match(q, /<Select Path="Microsoft-Windows-Windows Defender\/Operational">/);
  assert.match(q, /timediff\(@SystemTime\) &lt;= 86400000/);
  assert.doesNotMatch(q, /<= /);
  assert.match(queryListRegistro("Security", 5), /EventRecordID>5/);
});

test("lo script legge i tre registri, ognuno dal suo cursore; la risposta vecchia di un solo registro vale ancora", () => {
  const s = scriptEventiDc({ Security: 10, System: 20, Defender: null });
  assert.match(s, /Leggi 'Security' 'Security' '<QueryList>/);
  assert.match(s, /Leggi 'System' 'System' '.*EventRecordID>20/);
  assert.match(s, /Leggi 'Defender' 'Microsoft-Windows-Windows Defender\/Operational' '.*timediff/);
  const vecchia = leggiRispostaDc('{"nuovo":3,"vecchio":1,"errore":null,"eventi":[]}');
  assert.equal(vecchia.registro, "Security");
  assert.deepEqual(vecchia.altri, []);
});

test("risposta con più registri: Defender assente, System con un servizio, chiavi di record per registro", () => {
  const r = leggiRispostaDc(JSON.stringify({
    registri: [
      { registro: "Security", nuovo: 50, vecchio: 1, esaminato: null, errore: null, assente: false, eventi: [] },
      { registro: "System", nuovo: 900, vecchio: 1, esaminato: 900, errore: null, assente: false, eventi: { r: 900, t: "2026-10-29T08:00:00Z", id: 7045, d: { ServiceName: "PSEXESVC", ImagePath: "C:\\Windows\\PSEXESVC.exe", AccountName: "LocalSystem" } } },
      { registro: "Defender", nuovo: null, vecchio: null, esaminato: null, errore: null, assente: true, eventi: [] },
    ],
  }));
  assert.equal(r.nuovo, 50);
  assert.equal(r.altri.length, 2);
  const sys = r.altri.find((a) => a.registro === "System")!;
  assert.equal(sys.eventi[0]!.registro, "System");
  assert.equal(r.altri.find((a) => a.registro === "Defender")!.assente, true);
  const e = classificaEvento("DC01", sys.eventi[0]!)!;
  assert.equal(e.record, 10_000_000_000_900, "record di System con l'offset del registro: non si scontra con Sicurezza");
  assert.equal(e.descrizione, "Servizio installato sul DC: PSEXESVC (C:\\Windows\\PSEXESVC.exe)");
  assert.equal(e.categoria, "privileged_change");
  assert.throws(() => leggiRispostaDc('{"registri":[]}'), /senza il registro Sicurezza/);
});

test("DCSync: chi chiede la replica, livello 15, categoria attacchi al dominio", () => {
  const e = classificaEvento("DC01", grezzo(4662, { SubjectUserName: "mrossi", Properties: "%%7688 {1131f6ad-9c07-11d1-f79f-00c04fc2dcd2}", AccessMask: "0x100" }))!;
  assert.equal(e.categoria, "domain_attack");
  assert.equal(e.livello, 15);
  assert.equal(e.account, "mrossi");
  assert.equal(e.autore, "mrossi");
  assert.ok(eAllarme(e.categoria));
  assert.equal(comeAlert(e).ruleId, "dc-4662");
});

test("GPO, account a rischio, Kerberoasting, malware: la descrizione dice che cosa", () => {
  const gplink = classificaEvento("DC01", grezzo(5136, { SubjectUserName: "admin", ObjectDN: "OU=Uffici,DC=cliente,DC=local", AttributeLDAPDisplayName: "gPLink", ObjectClass: "organizationalUnit" }))!;
  assert.equal(gplink.descrizione, "GPO modificata: collegamenti cambiati su OU=Uffici");
  assert.equal(gplink.account, null);
  assert.equal(gplink.autore, "admin");
  const gpo = classificaEvento("DC01", grezzo(5136, { ObjectDN: "CN={31B2F340-016D-11D2-945F-00C04FB984F9},CN=Policies,CN=System,DC=cliente,DC=local", AttributeLDAPDisplayName: "versionNumber" }))!;
  assert.equal(gpo.descrizione, "GPO modificata: {31B2F340-016D-11D2-945F-00C04FB984F9}");
  const acc = classificaEvento("DC01", grezzo(4738, { TargetUserName: "svc-backup", SubjectUserName: "admin", UserAccountControl: "%%2089 %%2091", SidHistory: "-", AllowedToDelegateTo: "-" }))!;
  assert.equal(acc.descrizione, "Account modificato: password senza scadenza, delega senza vincoli");
  assert.equal(acc.account, "svc-backup");
  const kerb = classificaEvento("DC01", grezzo(4769, { TargetUserName: "mrossi@CLIENTE.LOCAL", ServiceName: "svc-sql", TicketEncryptionType: "0x17", IpAddress: "::ffff:10.0.0.9" }))!;
  assert.equal(kerb.categoria, "domain_attack");
  assert.equal(kerb.descrizione, "Ticket di servizio con cifratura debole RC4 (possibile Kerberoasting): servizio svc-sql");
  assert.equal(kerb.ip, "10.0.0.9");
  const mal = classificaEvento("DC01", { registro: "Defender", record: 4, quando: "2026-10-29T08:00:00.000Z", eventId: 1117, dati: { "Threat Name": "Trojan:Win32/Mimikatz", "Action Name": "Quarantine", Path: "file:_C:\\tmp\\m.exe", "Detection User": "CLIENTE\\mrossi" } })!;
  assert.equal(mal.categoria, "malware");
  assert.equal(mal.livello, 12);
  assert.equal(mal.account, "CLIENTE\\mrossi");
  assert.match(mal.descrizione, /Mimikatz · Quarantine · file:_C:/);
  assert.equal(mal.record, 20_000_000_000_004);
});

test("lo script scarta sul DC i casi normali: DC e Azure AD Connect in DCSync, computer e krbtgt in Kerberoasting", () => {
  const s = scriptEventiDc(null);
  assert.match(s, /\$s\.EndsWith\('\$'\) -or \$s\.StartsWith\('MSOL_'\)/);
  assert.match(s, /\$n\.EndsWith\('\$'\) -or \$n -like 'krbtgt\*'/);
  assert.match(s, /'%%2089'/);
  assert.match(s, /'1131f6aa-9c07-11d1-f79f-00c04fc2dcd2'/);
});
