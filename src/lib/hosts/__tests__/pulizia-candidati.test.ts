/**
 * Le esclusioni della pulizia degli host sul DB vero di prova (piano 2026-10-20, Task 2; decisione 2 di
 * Riccardo del 20/10): non si archivia mai un host legato a qualcosa che una persona ha scritto —
 * apparato, monitorato, nome a mano, asset, credenziali, unione a mano, gruppo multihomed. `notes` non
 * esclude: sull'hub è piena su tutti gli assenti, testo automatico. Zona rossa: un'esclusione persa è un
 * host del cliente che sparisce. Una tabella di legame che manca (DB vecchio) è un errore che la nomina,
 * mai un «nessun legame» in silenzio.
 *
 * Run: node --import tsx --test src/lib/hosts/__tests__/pulizia-candidati.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { caricaHostPerPulizia, candidatiPulizia } from "@/lib/hosts/pulizia-candidati";
import { archiviaHost, recuperaHost } from "@/lib/hosts/pulizia-archivio";

const T = "PULIZIACAND2010";
const T_VECCHIO = "PULIZIACAND2010V"; // tenant a parte: la prova delle tabelle mancanti le toglie
after(() => {
  for (const t of [T, T_VECCHIO]) {
    try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
  }
  closeHubDb();
});

let reti = 0;
function nuovaRete(d: Database.Database): { id: number; prefisso: string } {
  reti += 1;
  const prefisso = `10.${60 + reti}.0`;
  const id = Number(d.prepare("INSERT INTO networks (cidr, name) VALUES (?, ?)").run(`${prefisso}.0/24`, `r${reti}`).lastInsertRowid);
  return { id, prefisso };
}

/** Un host come lo scrive la scansione: hostname, note automatiche, date di SQLite. */
function host(d: Database.Database, rete: number, ip: string, o: { status?: string; giorni?: number; mac?: string | null; hostname?: string | null } = {}): number {
  return Number(d.prepare(`INSERT INTO hosts (network_id, ip, mac, hostname, notes, status, first_seen, last_seen)
      VALUES (?, ?, ?, ?, '[DHCP: mikrotik] lease 2026-07-12', ?, datetime('now', '-200 days'), datetime('now', ?))`)
    .run(rete, ip, o.mac ?? null, o.hostname === undefined ? `pc-${ip.split(".").at(-1)}` : o.hostname,
      o.status ?? "offline", `-${o.giorni ?? 100} days`).lastInsertRowid);
}

function credenziale(d: Database.Database): number {
  return Number(d.prepare("INSERT INTO credentials (name, credential_type) VALUES ('ssh-admin', 'ssh')").run().lastInsertRowid);
}

/** I sette legami della decisione 2, ognuno scritto come lo scrive l'app. */
const LEGAMI: ReadonlyArray<readonly [string, (d: Database.Database, id: number, ip: string) => void]> = [
  ["apparato", (d, id, ip) => {
    d.prepare(`INSERT INTO network_devices (name, host, device_type, vendor, protocol, host_id)
      VALUES ('sw-core', ?, 'switch', 'hp', 'snmp_v2', ?)`).run(ip, id);
  }],
  ["monitorato", (d, id) => { d.prepare("UPDATE hosts SET known_host = 1 WHERE id = ?").run(id); }],
  ["nome scritto a mano", (d, id) => { d.prepare("UPDATE hosts SET custom_name = 'Stampante amministrazione' WHERE id = ?").run(id); }],
  ["asset", (d, id) => {
    d.prepare("INSERT INTO inventory_assets (asset_id, host_id, hostname, categoria) VALUES (?, ?, 'pc-ufficio', 'Desktop')").run(`AST-${id}`, id);
  }],
  ["credenziali", (d, id) => {
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port) VALUES (?, ?, 'ssh', 22)").run(id, credenziale(d));
  }],
  ["unione a mano", (d, id) => {
    d.prepare("INSERT INTO topology_unioni (gruppo, membro, creato_da) VALUES (?, ?, 'anna')").run(1000 + id, `host:${id}`);
  }],
  ["gruppo multihomed", (d, id) => {
    d.prepare("INSERT INTO multihomed_links (group_id, host_id, match_type, match_value) VALUES (?, ?, 'hostname', 'srv-file')").run(`mh-${id}`, id);
  }],
  // Decisione del controllore del 20/10 (revisione finale), per prudenza: il vecchio cleanup proteggeva
  // classification_manual, e i registri delle sessioni remote (MeshCentral) non si cancellano.
  ["classificazione a mano", (d, id) => { d.prepare("UPDATE hosts SET classification = 'printer', classification_manual = 1 WHERE id = ?").run(id); }],
  ["sessioni remote registrate", (d, id) => {
    d.prepare("INSERT INTO mc_remote_session (host_id, operator, mesh_user, viewmode) VALUES (?, 'anna', 'anna@mesh', 11)").run(id);
  }],
];

for (const [perche, lega] of LEGAMI) {
  test(`escluso «${perche}»: offline da 100 giorni, in esclusi col perché e non fra i candidati`, () => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      const rete = nuovaRete(d);
      const ip = `${rete.prefisso}.10`;
      const id = host(d, rete.id, ip);
      const libero = host(d, rete.id, `${rete.prefisso}.11`);
      lega(d, id, ip);
      const esito = candidatiPulizia();
      assert.ok(!esito.candidati.some((c) => c.id === id), "non è fra i candidati");
      assert.ok(esito.candidati.some((c) => c.id === libero), "il vicino senza legami sì");
      const escluso = esito.esclusi.find((e) => e.id === id);
      assert.ok(escluso, "è fra gli esclusi");
      assert.equal(escluso.perche, perche);
      assert.equal(escluso.ip, ip);
    });
  });
}

test("comandi remoti registrati (mc_command_log, senza sessione): escluso «sessioni remote registrate»", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const id = host(d, rete.id, `${rete.prefisso}.12`);
    d.prepare("INSERT INTO mc_command_log (host_id, operator, command) VALUES (?, 'anna', 'ipconfig /all')").run(id);
    const esito = candidatiPulizia();
    assert.ok(!esito.candidati.some((c) => c.id === id), "non è fra i candidati");
    assert.equal(esito.esclusi.find((e) => e.id === id)?.perche, "sessioni remote registrate");
  });
});

test("I1: un host recuperato a mano dall'archivio non torna candidato al giro dopo («recuperato a mano»)", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const id = host(d, rete.id, `${rete.prefisso}.14`);
    const riga = archiviaHost(id, "assente", "assente da 100 giorni", "job");
    const r = recuperaHost(riga.id, "anna");
    assert.ok(r.ok);
    // Torna offline con la last_seen di prima: per le sole regole dei giorni sarebbe di nuovo candidato.
    const esito = candidatiPulizia();
    assert.ok(!esito.candidati.some((c) => c.id === r.nuovoHostId), "il recuperato non è fra i candidati");
    assert.equal(esito.esclusi.find((e) => e.id === r.nuovoHostId)?.perche, "recuperato a mano");
  });
});

test("notes piena non esclude, un nome a mano di soli spazi nemmeno, un'unione tolta nemmeno", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const conNote = host(d, rete.id, `${rete.prefisso}.20`);
    d.prepare("UPDATE hosts SET notes = 'scrivania di Anna, secondo piano' WHERE id = ?").run(conNote);
    const spazi = host(d, rete.id, `${rete.prefisso}.21`);
    d.prepare("UPDATE hosts SET custom_name = '   ' WHERE id = ?").run(spazi);
    const tolta = host(d, rete.id, `${rete.prefisso}.22`);
    d.prepare("INSERT INTO topology_unioni (gruppo, membro, creato_da, tolto_da, tolto_il) VALUES (?, ?, 'anna', 'marco', datetime('now', '-1 day'))")
      .run(5000 + tolta, `host:${tolta}`);
    const esito = candidatiPulizia();
    for (const id of [conNote, spazi, tolta]) {
      assert.ok(esito.candidati.some((c) => c.id === id), `host #${id} candidato`);
      assert.ok(!esito.esclusi.some((e) => e.id === id), `host #${id} non escluso`);
    }
  });
});

test("con più legami vale il primo nell'ordine della decisione 2 (apparato prima di credenziali)", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const ip = `${rete.prefisso}.30`;
    const id = host(d, rete.id, ip);
    LEGAMI.find(([p]) => p === "credenziali")![1](d, id, ip);
    LEGAMI.find(([p]) => p === "apparato")![1](d, id, ip);
    assert.equal(caricaHostPerPulizia().find((x) => x.id === id)?.escluso, "apparato");
  });
});

test("il caricatore: nome da hostname, poi IP; date e stato come stanno nel DB", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const conNome = host(d, rete.id, `${rete.prefisso}.40`, { hostname: "pc-contabilita", mac: "AA:BB:CC:00:11:22" });
    const senzaNome = host(d, rete.id, `${rete.prefisso}.41`, { hostname: null, status: "unknown" });
    const tutti = caricaHostPerPulizia();
    const a = tutti.find((x) => x.id === conNome)!;
    const grezzo = d.prepare("SELECT last_seen, first_seen, created_at FROM hosts WHERE id = ?").get(conNome) as
      { last_seen: string; first_seen: string; created_at: string };
    assert.deepEqual(a, {
      id: conNome, networkId: rete.id, ip: `${rete.prefisso}.40`, mac: "AA:BB:CC:00:11:22", nome: "pc-contabilita", nomeVero: "pc-contabilita", status: "offline",
      lastSeen: grezzo.last_seen, firstSeen: grezzo.first_seen, createdAt: grezzo.created_at, escluso: null,
    });
    const b = tutti.find((x) => x.id === senzaNome)!;
    assert.equal(b.nome, `${rete.prefisso}.41`);
    assert.equal(b.nomeVero, null, "l'IP di ripiego non è un nome vero");
    assert.equal(b.status, "unknown");
  });
});

test("cambio IP sul DB: MAC scritti AA:BB:… e aa-bb-…, il vecchio IP senza nome candidato a 2 giorni", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    const nuovo = host(d, rete.id, `${rete.prefisso}.51`, { status: "online", giorni: 0, mac: "AA:BB:CC:00:66:0F", hostname: "monitor.domarc.it" });
    const vecchio = host(d, rete.id, `${rete.prefisso}.50`, { giorni: 2, mac: "aa-bb-cc-00-66-0f", hostname: null });
    const esito = candidatiPulizia();
    const c = esito.candidati.find((x) => x.id === vecchio);
    assert.ok(c, "il vecchio IP è candidato");
    assert.equal(c.motivo, "cambio_ip");
    assert.equal(c.dettaglio, `ora ${rete.prefisso}.51`);
    assert.ok(!esito.candidati.some((x) => x.id === nuovo), "l'online resta");
  });
});

test("cambio IP sul DB: due hostname diversi con lo stesso MAC (router in proxy ARP) → nessun cambio IP", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    host(d, rete.id, `${rete.prefisso}.155`, { status: "online", giorni: 0, mac: "82:FA:6F:7D:6D:54", hostname: "MikroTik" });
    const veeam = host(d, rete.id, `${rete.prefisso}.20`, { giorni: 2, mac: "82-fa-6f-7d-6d-54", hostname: "VEEAM-PX-02" });
    const esito = candidatiPulizia();
    assert.ok(!esito.candidati.some((x) => x.id === veeam), "non sparisce «ora .155»");
    assert.ok(!esito.esclusi.some((x) => x.id === veeam));
  });
});

test("cambio IP di un vecchio IP con credenziali: fra gli esclusi, non fra i candidati", () => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    const rete = nuovaRete(d);
    host(d, rete.id, `${rete.prefisso}.61`, { status: "online", giorni: 0, mac: "AA:BB:CC:00:77:1A", hostname: "pc-60" });
    const vecchioIp = `${rete.prefisso}.60`;
    const vecchio = host(d, rete.id, vecchioIp, { giorni: 2, mac: "aa-bb-cc-00-77-1a" });
    LEGAMI.find(([p]) => p === "credenziali")![1](d, vecchio, vecchioIp);
    const esito = candidatiPulizia();
    assert.ok(!esito.candidati.some((c) => c.id === vecchio), "non è fra i candidati");
    assert.deepEqual(esito.esclusi.find((e) => e.id === vecchio), { id: vecchio, ip: vecchioIp, nome: "pc-60", perche: "credenziali" });
  });
});

test("senza contesto tenant lancia: mai ripieghi su DEFAULT", () => {
  assert.throws(() => caricaHostPerPulizia(), /contesto tenant/);
});

test("una tabella di legame che manca: errore che la nomina, non un «nessun legame»", () => {
  withTenant(T_VECCHIO, () => {
    const d = getTenantDb(T_VECCHIO);
    const rete = nuovaRete(d);
    host(d, rete.id, `${rete.prefisso}.10`);
    assert.ok(caricaHostPerPulizia().length > 0, "con tutte le tabelle il caricatore va");
    const tolte: string[] = [];
    for (const tabella of ["mc_command_log", "mc_remote_session", "hosts_archivio", "multihomed_links", "topology_unioni", "host_credentials", "inventory_assets", "network_devices"]) {
      d.exec(`DROP TABLE ${tabella}`);
      tolte.push(tabella);
      assert.throws(() => caricaHostPerPulizia(), (e: unknown) => {
        assert.ok(e instanceof Error);
        assert.match(e.message, /^Pulizia degli host: nel DB del tenant mancano le tabelle di legame/);
        for (const t of tolte) assert.ok(e.message.includes(t), `il messaggio nomina ${t}: ${e.message}`);
        return true;
      });
      assert.throws(() => candidatiPulizia(), new RegExp(tabella));
    }
  });
});
