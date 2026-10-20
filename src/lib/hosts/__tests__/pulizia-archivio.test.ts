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
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, migrateHostsArchivio, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import {
  archiviaHost,
  cancellaArchivioScaduto,
  contaArchiviati,
  ipPrecedentiDi,
  listaArchivio,
  recuperaHost,
} from "@/lib/hosts/pulizia-archivio";
import { scriviRegistroPulizia } from "@/lib/hosts/registro-pulizia";

const T = "PULIZIA2010";
after(() => {
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
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
    // online apposta: il recupero deve rimetterlo offline in ogni caso (lo stato vero lo dirà la scansione).
    const id = hostPieno(d, rete, `10.${80 + reti}.0.10`, "AA:BB:CC:00:11:22", "online");
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

    // riga d'archivio che non c'è
    assert.equal(recuperaHost(999_999, "anna").ok, false);
  });
});

test("cancellaArchivioScaduto toglie la riga a 91 giorni (anche recuperata) e lascia quella a 89", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const vecchia = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.20`, null), "assente", "x", "job");
    const vecchiaRecuperata = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.21`, null), "assente", "x", "job");
    assert.ok(recuperaHost(vecchiaRecuperata.id, "anna").ok);
    const recente = archiviaHost(hostPieno(d, rete, `10.${80 + reti}.0.22`, null), "assente", "x", "job");
    const indietro = d.prepare("UPDATE hosts_archivio SET archiviato_il = datetime('now', ?) WHERE id = ?");
    indietro.run("-91 days", vecchia.id);
    indietro.run("-91 days", vecchiaRecuperata.id);
    indietro.run("-89 days", recente.id);

    const tolte = cancellaArchivioScaduto();
    assert.deepEqual(tolte.map((t) => t.id).sort((x, y) => x - y), [vecchia.id, vecchiaRecuperata.id].sort((x, y) => x - y));
    assert.ok(tolte.every((t) => t.nome === "pc-contabilita" && t.ip.startsWith(`10.${80 + reti}.0.`)));
    const resta = (id: number) => !!d.prepare("SELECT 1 FROM hosts_archivio WHERE id = ?").get(id);
    assert.equal(resta(vecchia.id), false);
    assert.equal(resta(vecchiaRecuperata.id), false);
    assert.equal(resta(recente.id), true);
    assert.deepEqual(cancellaArchivioScaduto(), [], "una seconda volta non c'è più niente");
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

    // La cartella del registro diventa un file: l'archiviazione deve fallire senza toccare niente.
    const dir = path.join(TEST_DATA_DIR, "audit");
    const accanto = `${dir}.vera`;
    fs.renameSync(dir, accanto);
    fs.writeFileSync(dir, "non sono una cartella");
    try {
      const id = hostPieno(d, rete, `10.${80 + reti}.0.31`, null);
      const archiviatiPrima = (d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio").get() as { n: number }).n;
      assert.throws(() => archiviaHost(id, "assente", "assente da 65 giorni", "anna"),
        (e: NodeJS.ErrnoException) => e.code === "EEXIST" || e.code === "ENOTDIR");
      assert.ok(riga(d, id), "l'host è ancora in hosts");
      assert.equal((d.prepare("SELECT COUNT(*) AS n FROM hosts_archivio").get() as { n: number }).n, archiviatiPrima, "nessuna riga d'archivio");
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

    // P2: l'elenco dell'archivio dice dove è tornato il MAC.
    const r = listaArchivio().righe.find((x) => x.id === a40.id);
    assert.ok(r);
    assert.equal(r.diNuovoInRete, `${base}30`);
    assert.deepEqual(ipPrecedentiDi(9_999_999), []);
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
