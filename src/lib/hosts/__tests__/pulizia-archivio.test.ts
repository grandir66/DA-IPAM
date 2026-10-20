/**
 * Archivio degli host (pulizia degli host assenti, piano 2026-10-20, Task 1; scelta A di
 * Riccardo): l'istantanea in `hosts_archivio`, poi un DELETE diretto da `hosts` (mai
 * `deleteHost`: niente `excluded_ips`, se l'oggetto torna la scansione lo ritrova).
 * Zona rossa: dati del cliente e cancellazioni. Il recupero deve ridare l'host com'era,
 * e rifiutarsi (senza scrivere) se l'IP è di nuovo occupato o la rete non c'è più.
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/pulizia-archivio.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, migrateHostsArchivio, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  archiviaHost,
  archivioScaduto,
  cancellaArchivioScaduto,
  contaArchiviati,
  contaArchiviatiOTrattino,
  ipPrecedentiDi,
  listaArchivio,
  recuperaHost,
} from "@/lib/hosts/pulizia-archivio";
import { scriviRegistroPulizia } from "@/lib/hosts/registro-pulizia";

const T = "PULIZIA2010";
const T_FK = "PULIZIA2010FK"; // tenant a parte: la prova della chiave esterna altera hosts
after(() => {
  for (const t of [T, T_FK]) {
    try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
  }
  closeHubDb();
});

let reti = 0;
function nuovaRete(d: Database.Database): number {
  reti += 1;
  return Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`10.${80 + reti}.0.0/24`, `r${reti}`).lastInsertRowid);
}

/** Un host con tutti i campi d'identità pieni (quelli che una persona ha visto o scritto). */
function hostPieno(d: Database.Database, rete: number, ip: string, mac: string | null, status = "offline"): number {
  return Number(d.prepare(`INSERT INTO hosts (
      network_id, ip, mac, vendor, hostname, dns_forward, dns_reverse, classification, classification_manual,
      notes, os_info, status, first_seen, last_seen, inventory_code, model, serial_number, open_ports)
    VALUES (?, ?, ?, 'Dell Inc.', 'pc-contabilita', 'pc-contabilita.ufficio.local', 'pc-contabilita.ufficio.local',
      'workstation', 1, 'scrivania di Anna, secondo piano', 'Windows 11 Pro', ?,
      '2026-01-10 08:00:00', '2026-08-01 17:30:00', 'INV-0042', 'OptiPlex 7090', 'SN-ABC123', '[{"port":445}]')`)
    .run(rete, ip, mac, status).lastInsertRowid);
}

const riga = (d: Database.Database, id: number) => d.prepare("SELECT * FROM hosts WHERE id = ?").get(id) as Record<string, unknown> | undefined;
const contaHost = (d: Database.Database) => (d.prepare("SELECT COUNT(*) AS n FROM hosts").get() as { n: number }).n;

test("archivia e recupera: ogni campo torna com'era, status offline, id nuovo", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const id = hostPieno(d, rete, `10.${80 + reti}.0.10`, "AA:BB:CC:00:11:22");
    const prima = riga(d, id)!;
    const contatiPrima = contaArchiviati();

    const a = archiviaHost(id, "assente", "assente da 74 giorni", "anna");
    assert.equal(riga(d, id), undefined, "l'host non è più in hosts");
    assert.equal(a.hostIdOriginale, id);
    assert.equal(a.nome, "pc-contabilita");
    assert.equal(a.macHex, "AABBCC001122");
    assert.equal(a.motivo, "assente");
    assert.equal(a.dettaglio, "assente da 74 giorni");
    assert.equal(a.ultimaVista, "2026-08-01 17:30:00");
    assert.equal(a.archiviatoDa, "anna");
    assert.equal(a.recuperatoIl, null);
    const foto = JSON.parse((d.prepare("SELECT istantanea FROM hosts_archivio WHERE id = ?").get(a.id) as { istantanea: string }).istantanea) as
      { host: Record<string, unknown>; ip_precedenti: unknown[] };
    assert.equal(foto.host.notes, "scrivania di Anna, secondo piano");
    assert.ok(!("os_family" in foto.host), "la colonna generata non si fotografa");
    assert.deepEqual(foto.ip_precedenti, []);
    assert.equal(contaArchiviati(), contatiPrima + 1);
    assert.ok(listaArchivio().righe.some((r) => r.id === a.id));

    const esito = recuperaHost(a.id, "marco");
    assert.ok(esito.ok, JSON.stringify(esito));
    assert.notEqual(esito.nuovoHostId, id);
    const dopo = riga(d, esito.nuovoHostId)!;
    assert.equal(dopo.status, "offline");
    for (const [col, valore] of Object.entries(prima)) {
      if (col === "id" || col === "status") continue;
      assert.deepEqual(dopo[col], valore, `colonna ${col}`);
    }
    const archivio = d.prepare("SELECT recuperato_il, recuperato_da, nuovo_host_id FROM hosts_archivio WHERE id = ?").get(a.id) as
      { recuperato_il: string | null; recuperato_da: string | null; nuovo_host_id: number | null };
    assert.ok(archivio.recuperato_il);
    assert.equal(archivio.recuperato_da, "marco");
    assert.equal(archivio.nuovo_host_id, esito.nuovoHostId);
    assert.equal(contaArchiviati(), contatiPrima, "una riga recuperata non conta fra gli archiviati");
    assert.ok(!listaArchivio().righe.some((r) => r.id === a.id), "né compare nell'elenco");
  });
});

test("si archivia solo un host offline: online e unknown lanciano e restano dove sono", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const archiviatiPrima = (d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio").get() as { n: number }).n;
    for (const [i, status] of (["online", "unknown"] as const).entries()) {
      const id = hostPieno(d, rete, `10.${80 + reti}.0.${70 + i}`, null, status);
      assert.throws(() => archiviaHost(id, "assente", "x", "anna"), new RegExp(`host #${id} non è offline \\(${status}\\)`));
      assert.ok(riga(d, id), "l'host è ancora in hosts");
    }
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio").get() as { n: number }).n, archiviatiPrima);
  });
});

test("dopo l'archiviazione: figlie CASCADE via, SET NULL restano senza host, excluded_ips vuota", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const ip = `10.${80 + reti}.0.11`;
    const id = hostPieno(d, rete, ip, "AA:BB:CC:00:11:33");
    d.prepare("INSERT INTO status_history (host_id, status) VALUES (?, 'offline')").run(id);
    d.prepare("INSERT INTO status_history (host_id, status) VALUES (?, 'online')").run(id);
    const lease = Number(d.prepare("INSERT INTO dhcp_leases (source_type, ip_address, mac_address, host_id, network_id) VALUES ('other', ?, 'AA:BB:CC:00:11:33', ?, ?)")
      .run(ip, id, rete).lastInsertRowid);

    archiviaHost(id, "assente", "assente da 61 giorni", "job");

    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM status_history WHERE host_id = ?").get(id) as { n: number }).n, 0);
    const l = d.prepare("SELECT host_id FROM dhcp_leases WHERE id = ?").get(lease) as { host_id: number | null } | undefined;
    assert.ok(l, "il lease DHCP resta");
    assert.equal(l.host_id, null);
    assert.equal((d.prepare("SELECT COUNT(*) AS n FROM excluded_ips").get() as { n: number }).n, 0, "archiviare non è escludere");
  });
});

test("recupero rifiutato: IP occupato, rete cancellata, già recuperato — nessuna riga nuova in hosts", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);

    // IP di nuovo in uso
    const rete = nuovaRete(d);
    const ip = `10.${80 + reti}.0.12`;
    const a = archiviaHost(hostPieno(d, rete, ip, "AA:BB:CC:00:11:44"), "cambio_ip", "ora 10.0.0.99", "anna");
    const occupante = Number(d.prepare("INSERT INTO hosts (network_id, ip, hostname, status) VALUES (?, ?, 'stampante-nuova', 'online')").run(rete, ip).lastInsertRowid);
    let n = contaHost(d);
    const occupato = recuperaHost(a.id, "anna");
    assert.equal(occupato.ok, false);
    assert.ok(!occupato.ok && occupato.motivo.includes(`l'IP ${ip} è di nuovo in uso da stampante-nuova (#${occupante})`), JSON.stringify(occupato));
    assert.equal(contaHost(d), n);
    assert.equal((d.prepare("SELECT recuperato_il FROM hosts_archivio WHERE id = ?").get(a.id) as { recuperato_il: string | null }).recuperato_il, null);

    // rete cancellata
    const rete2 = nuovaRete(d);
    const b = archiviaHost(hostPieno(d, rete2, `10.${80 + reti}.0.13`, null), "assente", "assente da 90 giorni", "anna");
    d.prepare("DELETE FROM networks WHERE id = ?").run(rete2);
    n = contaHost(d);
    const senzaRete = recuperaHost(b.id, "anna");
    assert.deepEqual(senzaRete, { ok: false, motivo: "la rete non esiste più" });
    assert.equal(contaHost(d), n);

    // già recuperato
    const rete3 = nuovaRete(d);
    const c = archiviaHost(hostPieno(d, rete3, `10.${80 + reti}.0.14`, null), "assente", "assente da 70 giorni", "anna");
    assert.ok(recuperaHost(c.id, "anna").ok);
    n = contaHost(d);
    const dueVolte = recuperaHost(c.id, "anna");
    assert.equal(dueVolte.ok, false);
    assert.ok(!dueVolte.ok && dueVolte.motivo.startsWith("già recuperato il "), JSON.stringify(dueVolte));
    assert.equal(contaHost(d), n);

    // IP escluso a mano dopo l'archiviazione: il recupero non lo rimette in elenco
    const rete4 = nuovaRete(d);
    const ipEscluso = `10.${80 + reti}.0.15`;
    const e = archiviaHost(hostPieno(d, rete4, ipEscluso, null), "assente", "assente da 70 giorni", "anna");
    d.prepare("INSERT INTO excluded_ips (network_id, ip, reason, excluded_at) VALUES (?, ?, 'a mano', '2026-10-20 08:00:00')").run(rete4, ipEscluso);
    n = contaHost(d);
    const escluso = recuperaHost(e.id, "anna");
    assert.equal(escluso.ok, false);
    assert.ok(!escluso.ok && escluso.motivo.startsWith(`l'IP ${ipEscluso} è fra gli IP esclusi della rete`) && escluso.motivo.includes("20/10/26"), JSON.stringify(escluso));
    assert.equal(contaHost(d), n);
    assert.equal((d.prepare("SELECT recuperato_il FROM hosts_archivio WHERE id = ?").get(e.id) as { recuperato_il: string | null }).recuperato_il, null);

    // riga d'archivio che non c'è
    assert.equal(recuperaHost(999_999, "anna").ok, false);
  });
});

test("cancellaArchivioScaduto toglie la riga a 91 giorni e lascia quella a 89; una recuperata resta finché c'è il suo host (I1)", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const vecchia = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.20`, null), "assente", "x", "job");
    // I1 (revisione finale, 20/10): la riga recuperata è il segno «recuperato a mano» che tiene l'host fuori dalla
    // pulizia. Resta finché l'host recuperato esiste; se quell'host non c'è più si cancella coi 90 giorni.
    const recuperataViva = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.21`, null), "assente", "x", "job");
    assert.ok(recuperaHost(recuperataViva.id, "anna").ok);
    const recuperataSparita = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.23`, null), "assente", "x", "job");
    const r = recuperaHost(recuperataSparita.id, "anna");
    assert.ok(r.ok);
    d.prepare("DELETE FROM hosts WHERE id = ?").run(r.nuovoHostId);
    const recente = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.22`, null), "assente", "x", "job");
    const indietro = d.prepare("UPDATE hosts_archivio SET archiviato_il = datetime('now', ?) WHERE id = ?");
    indietro.run("-91 days", vecchia.id);
    indietro.run("-200 days", recuperataViva.id);
    indietro.run("-200 days", recuperataSparita.id);
    indietro.run("-89 days", recente.id);

    const attese = [vecchia.id, recuperataSparita.id].sort((x, y) => x - y);
    assert.deepEqual(archivioScaduto().map((t) => t.id), attese, "la lettura dice le stesse righe, senza cancellarle");
    const resta = (id: number) => !!d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(id);
    assert.ok(resta(vecchia.id) && resta(recuperataSparita.id), "archivioScaduto non scrive");

    const tolte = cancellaArchivioScaduto();
    assert.deepEqual(tolte.map((t) => t.id).sort((x, y) => x - y), attese);
    assert.ok(tolte.every((t) => t.nome === "pc-contabilita" && t.ip.startsWith(`10.${80 + reti}.0.`)));
    assert.equal(resta(vecchia.id), false);
    assert.equal(resta(recuperataSparita.id), false);
    assert.equal(resta(recuperataViva.id), true, "recuperata a 200 giorni col suo host vivo: resta");
    assert.equal(resta(recente.id), true);
    assert.deepEqual(cancellaArchivioScaduto(), [], "una seconda volta non c'è più niente");
  });
});

test("cancellaArchivioScaduto scrive il registro con una scrittura sola, dopo le cancellazioni", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const ids = [0, 1, 2].map((i) => archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.${40 + i}`, null), "assente", "x", "job").id);
    for (const id of ids) d.prepare("UPDATE hosts_archivio SET archiviato_il = datetime('now', '-95 days') WHERE id = ?").run(id);
    const scritture = mock.method(fs, "appendFileSync");
    try {
      assert.deepEqual(cancellaArchivioScaduto().map((t) => t.id), ids);
      assert.equal(scritture.mock.callCount(), 1);
    } finally {
      scritture.mock.restore();
    }
    const cancellate = righeRegistro().filter((x) => x.azione === "cancella" && ids.includes(x.archivioId as number));
    assert.deepEqual(cancellate.map((x) => x.archivioId), ids);
  });
});

/** Le righe del registro di oggi (UTC, come il nome del file). */
function righeRegistro(): Array<Record<string, unknown>> {
  const f = path.join(TEST_DATA_DIR, "audit", `pulizia-host-${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

test("registro: una riga JSONL per operazione; registro non scrivibile → l'archiviazione fallisce e l'host resta", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const a = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.30`, "AA:BB:CC:00:11:55"), "assente", "assente da 65 giorni", "anna");
    const r = recuperaHost(a.id, "marco");
    assert.ok(r.ok);
    d.prepare("UPDATE hosts_archivio SET archiviato_il = datetime('now', '-100 days') WHERE id = ?").run(a.id);
    // I1: una riga recuperata si cancella coi 90 giorni solo quando il suo host recuperato non c'è più.
    d.prepare("DELETE FROM hosts WHERE id = ?").run(r.nuovoHostId);
    cancellaArchivioScaduto();

    const mie = righeRegistro().filter((x) => x.archivioId === a.id);
    assert.deepEqual(mie.map((x) => x.azione), ["archivia", "recupera", "cancella"]);
    for (const x of mie) {
      assert.equal(x.nome, "pc-contabilita");
      assert.equal(x.tenant, T);
      assert.equal(x.ip, `10.${80 + reti}.0.30`);
      assert.ok(typeof x.il === "string" && !Number.isNaN(Date.parse(x.il)) && x.il.endsWith("Z"), `il ISO: ${String(x.il)}`);
    }
    assert.equal(mie[0].da, "anna");
    assert.equal(mie[0].hostId, a.hostIdOriginale);
    assert.equal(mie[1].da, "marco");
    assert.equal(mie[1].hostId, r.ok ? r.nuovoHostId : -1);

    // La cartella del registro diventa un file: archiviare, recuperare e cancellare devono fallire senza toccare niente.
    // Preparati PRIMA di rompere il registro (archiviare scrive il registro): uno da recuperare, uno scaduto.
    const errFs = (e: NodeJS.ErrnoException) => e.code === "EEXIST" || e.code === "ENOTDIR";
    const dir = path.join(TEST_DATA_DIR, "audit");
    const accanto = `${dir}.vera`;
    const daRecuperare = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.32`, null), "assente", "x", "anna");
    const scaduto = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.33`, null), "assente", "x", "anna");
    d.prepare("UPDATE hosts_archivio SET archiviato_il = datetime('now', '-100 days') WHERE id = ?").run(scaduto.id);
    fs.renameSync(dir, accanto);
    fs.writeFileSync(dir, "non sono una cartella");
    try {
      const id = hostPieno(d, rete, `10.${80 + reti}.0.31`, null);
      const archiviatiPrima = (d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio").get() as { n: number }).n;
      assert.throws(() => archiviaHost(id, "assente", "assente da 65 giorni", "anna"), errFs);
      assert.ok(riga(d, id), "l'host è ancora in hosts");
      assert.equal((d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio").get() as { n: number }).n, archiviatiPrima, "nessuna riga d'archivio");

      const hostPrima = contaHost(d);
      assert.throws(() => recuperaHost(daRecuperare.id, "anna"), errFs);
      assert.equal(contaHost(d), hostPrima, "il recupero non ha rimesso niente in hosts");
      assert.equal((d.prepare("SELECT recuperato_il FROM hosts_archivio WHERE id = ?").get(daRecuperare.id) as { recuperato_il: string | null }).recuperato_il, null);

      assert.throws(() => cancellaArchivioScaduto(), errFs);
      assert.ok(d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(scaduto.id), "la riga scaduta è ancora in archivio");
    } finally {
      fs.rmSync(dir, { force: true });
      fs.renameSync(accanto, dir);
    }
  });
});

test("ipPrecedentiDi: storico del MAC e archivio, un IP una volta, il più recente prima; diNuovoInRete in elenco", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const base = `10.${80 + reti}.0.`;
    const mac = "AA:BB:CC:00:11:66";
    const hex = "AABBCC001166";
    // Due host vecchi dello stesso MAC finiti in archivio: .40 visto 5 giorni fa, .10 visto 40 giorni fa.
    const h40 = hostPieno(d, rete, `${base}40`, mac);
    d.prepare("UPDATE hosts SET last_seen = datetime('now', '-5 days') WHERE id = ?").run(h40);
    const a40 = archiviaHost(h40, "cambio_ip", `ora ${base}30`, "job");
    const h10 = hostPieno(d, rete, `${base}10`, mac);
    d.prepare("UPDATE hosts SET last_seen = datetime('now', '-40 days') WHERE id = ?").run(h10);
    archiviaHost(h10, "cambio_ip", `ora ${base}30`, "job");
    // Una riga recuperata non conta come IP precedente.
    const h50 = hostPieno(d, rete, `${base}50`, mac);
    const a50 = archiviaHost(h50, "cambio_ip", `ora ${base}30`, "job");
    const r50 = recuperaHost(a50.id, "anna");
    assert.ok(r50.ok);
    d.prepare("DELETE FROM hosts WHERE id = ?").run(r50.nuovoHostId);

    // L'host di adesso, online su .30.
    const ora = hostPieno(d, rete, `${base}30`, mac, "online");
    const storico = d.prepare("INSERT INTO mac_ip_history (mac_normalized, ip, source, changed_at) VALUES (?, ?, 'arp', datetime('now', ?))");
    storico.run(hex, `${base}10`, "-30 days");
    storico.run(hex, `${base}20`, "-20 days");
    storico.run(hex, `${base}20`, "-10 days");
    storico.run(hex, `${base}30`, "-1 days"); // l'IP attuale: non è «precedente»
    storico.run("FFEEDDCCBBAA", `${base}99`, "-2 days"); // un altro MAC

    const giorni = (n: number) => (d.prepare("SELECT datetime('now', ?) AS t").get(`-${n} days`) as { t: string }).t;
    const precedenti = ipPrecedentiDi(ora);
    assert.deepEqual(precedenti.map((p) => [p.ip, p.fonte]), [
      [`${base}40`, "archivio"],
      [`${base}20`, "storico"],
      [`${base}10`, "storico"], // dallo storico (30 giorni fa) e dall'archivio (40): una volta, la più recente
    ]);
    assert.equal(precedenti[0].fino_al, giorni(5));
    assert.equal(precedenti[1].fino_al, giorni(10));
    assert.equal(precedenti[2].fino_al, giorni(30));

    // P2: l'elenco dell'archivio dice dove è tornato il MAC; archiviaHost no (l'host appena archiviato era offline).
    const a70 = archiviaHost(hostPieno(d, rete, `${base}70`, mac), "cambio_ip", `ora ${base}30`, "job");
    assert.equal(a70.diNuovoInRete, null);
    const r = listaArchivio().righe.find((x) => x.id === a40.id);
    assert.ok(r);
    assert.equal(r.diNuovoInRete, `${base}30`);
    assert.equal(listaArchivio().righe.find((x) => x.id === a70.id)?.diNuovoInRete, `${base}30`);
    assert.deepEqual(ipPrecedentiDi(9_999_999), []);
  });
});

test("m10: ipPrecedentiDi non elenca gli IP che oggi stanno su un host con lo stesso MAC (router con più VLAN)", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const altra = nuovaRete(d);
    const base = `10.${80 + reti - 1}.0.`;
    const baseAltra = `10.${80 + reti}.0.`;
    const hex = "AABBCC0011AA";
    const router = hostPieno(d, rete, `${base}1`, "AA:BB:CC:00:11:AA", "online");
    // Stesso MAC, altra VLAN, scritto in un'altra forma e offline: è ancora un IP dell'apparato, non un IP «precedente».
    hostPieno(d, altra, `${baseAltra}1`, "aa-bb-cc-00-11-aa", "offline");
    const storico = d.prepare("INSERT INTO mac_ip_history (mac_normalized, ip, source, changed_at) VALUES (?, ?, 'arp', datetime('now', ?))");
    storico.run(hex, `${baseAltra}1`, "-3 days");
    storico.run(hex, `${base}9`, "-30 days"); // questo sì: nessun host lo tiene oggi
    // Archiviato e poi ritrovato dalla scansione come host nuovo, stesso IP e stesso MAC: in archivio c'è, ma oggi è suo.
    archiviaHost(hostPieno(d, altra, `${baseAltra}2`, "AA:BB:CC:00:11:AA"), "assente", "assente da 100 giorni", "job");
    hostPieno(d, altra, `${baseAltra}2`, "AABBCC0011AA", "unknown");

    assert.deepEqual(ipPrecedentiDi(router).map((p) => p.ip), [`${base}9`]);
  });
});

test("m11: contaArchiviatiOTrattino dà il numero, e «—» con il solo nome dell'errore nel journal se la lettura fallisce", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    assert.equal(typeof contaArchiviatiOTrattino(), "number");
    const righe: unknown[][] = [];
    const err = mock.method(console, "error", (...a: unknown[]) => { righe.push(a); });
    const orig = d.prepare.bind(d);
    const prep = mock.method(d, "prepare", (sql: string) => {
      if (sql.includes("hosts_archivio")) throw new TypeError("no such table: hosts_archivio (10.0.0.1 pc-anna)");
      return orig(sql);
    });
    try {
      assert.equal(contaArchiviatiOTrattino(), "—");
    } finally {
      prep.mock.restore();
      err.mock.restore();
    }
    assert.equal(righe.length, 1);
    const testo = righe[0].map(String).join(" ");
    assert.match(testo, /TypeError/);
    assert.doesNotMatch(testo, /10\.0\.0\.1|pc-anna/);
  });
});

test("MAC non valido → mac_hex NULL; apparato fisico sparito → il recupero lascia physical_device_id vuoto", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const base = `10.${80 + reti}.0.`;
    // macToHex riempie di zeri: «AB:CD» diventerebbe ABCD00000000 e si legherebbe a un MAC che non c'è.
    const corto = archiviaHost(hostPieno(d, rete, `${base}60`, "AB:CD"), "assente", "x", "job");
    const zeri = archiviaHost(hostPieno(d, rete, `${base}61`, "00:00:00:00:00:00"), "assente", "x", "job");
    assert.equal(corto.macHex, null);
    assert.equal(zeri.macHex, null);
    assert.equal(corto.diNuovoInRete, null);

    const fisico = Number(d.prepare("INSERT INTO physical_devices (vendor) VALUES ('Dell')").run().lastInsertRowid);
    const id = hostPieno(d, rete, `${base}62`, null);
    d.prepare("UPDATE hosts SET physical_device_id = ? WHERE id = ?").run(fisico, id);
    const a = archiviaHost(id, "assente", "x", "job");
    d.prepare("DELETE FROM physical_devices WHERE id = ?").run(fisico);
    const r = recuperaHost(a.id, "anna");
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(riga(d, r.nuovoHostId)!.physical_device_id, null);
    const voce = righeRegistro().find((x) => x.archivioId === a.id && x.azione === "recupera");
    assert.ok(voce && String(voce.motivo).includes(`senza apparato fisico #${fisico}`), JSON.stringify(voce));
  });
});

test("recupero: una chiave esterna che non è SET NULL verso una riga sparita → rifiuto, niente scritto", () => {
  withTenant(T_FK, () => {
    const d = getTenantDb(T_FK);
    // Una colonna futura con chiave esterna senza ON DELETE (NO ACTION): non si vuota da sola.
    d.exec("ALTER TABLE hosts ADD COLUMN location_prova_id INTEGER REFERENCES locations(id)");
    const rete = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES ('10.99.0.0/24', 'fk')").run().lastInsertRowid);
    const luogo = Number(d.prepare("INSERT INTO locations (name) VALUES ('magazzino')").run().lastInsertRowid);
    const id = hostPieno(d, rete, "10.99.0.5", null);
    d.prepare("UPDATE hosts SET location_prova_id = ? WHERE id = ?").run(luogo, id);
    const a = archiviaHost(id, "assente", "x", "job");
    d.prepare("DELETE FROM locations WHERE id = ?").run(luogo);
    const n = contaHost(d);
    const esito = recuperaHost(a.id, "anna");
    assert.equal(esito.ok, false);
    assert.ok(!esito.ok && esito.motivo.includes(`location_prova_id`) && esito.motivo.includes(`#${luogo}`), JSON.stringify(esito));
    assert.equal(contaHost(d), n);
    assert.equal((d.prepare("SELECT recuperato_il FROM hosts_archivio WHERE id = ?").get(a.id) as { recuperato_il: string | null }).recuperato_il, null);
  });
});

test("registro: i file più vecchi di 400 giorni si tolgono alla prima scrittura del giorno, gli altri restano", () => {
  const dir = path.join(TEST_DATA_DIR, "audit");
  fs.mkdirSync(dir, { recursive: true });
  const adesso = new Date("2031-03-15T10:00:00Z"); // un giorno in cui questo processo non ha ancora pulito
  const vecchio = path.join(dir, "pulizia-host-2030-02-01.jsonl"); // 407 giorni prima
  const tenuto = path.join(dir, "pulizia-host-2030-02-20.jsonl"); // 388 giorni prima
  const altro = path.join(dir, "altro-2020-01-01.jsonl"); // non è del registro: non si tocca
  for (const f of [vecchio, tenuto, altro]) fs.writeFileSync(f, "{}\n");
  try {
    scriviRegistroPulizia({ azione: "cancella", tenant: T, archivioId: 0, hostId: null, ip: "10.0.0.1", mac: null, nome: "prova", motivo: "prova", da: "prova" }, adesso);
    assert.equal(fs.existsSync(vecchio), false);
    assert.equal(fs.existsSync(tenuto), true);
    assert.equal(fs.existsSync(altro), true);
    assert.ok(fs.existsSync(path.join(dir, "pulizia-host-2031-03-15.jsonl")));
  } finally {
    for (const f of [vecchio, tenuto, altro, path.join(dir, "pulizia-host-2031-03-15.jsonl")]) fs.rmSync(f, { force: true });
  }
});

test("migrazione: tabella e due indici all'apertura del tenant, una seconda volta non aggiunge niente", () => {
  const d = getTenantDb(T);
  const nomi = (d.prepare("SELECT name FROM sqlite_master WHERE tbl_name = 'hosts_archivio' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
  assert.deepEqual(nomi, ["hosts_archivio", "idx_hosts_archivio_il", "idx_hosts_archivio_mac"]);
  assert.deepEqual(migrateHostsArchivio(d), []);
});
