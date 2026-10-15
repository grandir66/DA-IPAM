/**
 * Fotografia delle scelte delle credenziali (tappa 2, T1 del piano
 * `plans/2026-10-15-tappa2-archivio-credenziali.md`).
 *
 * Perché: la tappa 2 sposta in sette rilasci la scelta delle credenziali degli
 * apparati, degli host, delle catene di rete, dell'anteprima edge e delle patch.
 * La fotografia, presa sulla stessa copia dei dati col codice di prima e con
 * quello di dopo, è la misura di arresto di ogni rilascio: una differenza non
 * attesa ferma la sotto-tappa. Tre rischi coperti qui:
 *   1. un segreto, o il suo testo cifrato, che finisce nel file o a terminale;
 *   2. un'impronta senza chiave (sha256 nudo): con community e password deboli
 *      sarebbe un oracolo per un dizionario;
 *   3. lo script che apre i dati del servizio invece della copia: l'ambiente
 *      del servizio sulle appliance contiene DA_INVENT_DATA_DIR verso i dati
 *      veri (appliance-systemd-install.sh:69-70), e db-tenant/db-hub fissano i
 *      percorsi quando si caricano.
 *
 * Run: DA_INVENT_DATA_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ipam.XXXXXX")" node --import tsx --test src/lib/credentials/__tests__/fotografia.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { encrypt } from "@/lib/crypto";
import { getHubDb, closeHubDb, setSetting } from "@/lib/db-hub";
import { getTenantDb, closeTenantDb } from "@/lib/db-tenant";
import {
  chiaroDaParti,
  confrontaFotografie,
  impronta,
  leggiFotografia,
  type RigaFotografia,
} from "@/lib/credentials/fotografia";

const REPO = process.cwd();
const SCRIPT = path.join(REPO, "scripts", "credenziali", "fotografia-scelte.ts");
const SCRIPT_MISURE = path.join(REPO, "scripts", "credenziali", "misure-2a.ts");
const K = process.env.ENCRYPTION_KEY ?? "";
const T = "TESTFOTOGRAFIA";

// ─────────────────────────────────────────────────────────────────────────────
// Parte pura: impronta e confronto
// ─────────────────────────────────────────────────────────────────────────────

describe("impronta", () => {
  it("stessa community e stessa chiave → stessa impronta, 8 caratteri esadecimali", () => {
    const a = impronta(Buffer.from("comunita"), "chiave-uno");
    assert.match(a, /^[0-9a-f]{8}$/);
    assert.equal(impronta(Buffer.from("comunita"), "chiave-uno"), a);
  });

  it("un'altra chiave dà un'altra impronta: non è uno sha256 senza chiave", () => {
    const a = impronta(Buffer.from("comunita"), "chiave-uno");
    const b = impronta(Buffer.from("comunita"), "chiave-due");
    assert.notEqual(a, b);
    const nudo = crypto.createHash("sha256").update("comunita").digest("hex").slice(0, 8);
    assert.notEqual(a, nudo);
    assert.notEqual(b, nudo);
  });

  it("testi diversi danno impronte diverse; le parti si separano (a+bc ≠ ab+c)", () => {
    assert.notEqual(impronta(Buffer.from("public"), "k"), impronta(Buffer.from("private"), "k"));
    assert.notEqual(impronta(chiaroDaParti("a", "bc"), "k"), impronta(chiaroDaParti("ab", "c"), "k"));
  });

  it("senza ENCRYPTION_KEY non calcola niente: errore, non un'impronta senza chiave", () => {
    assert.throws(() => impronta(Buffer.from("x"), ""), /ENCRYPTION_KEY/);
  });
});

function riga(p: Partial<RigaFotografia> = {}): RigaFotografia {
  return {
    tenant: "T1",
    oggetto: "apparato",
    chiave: "1:ssh",
    nome: "Switch uno",
    scelta: { credential_id: 5, port: 22, fonte: "lettore_vecchio:binding", impronta: "a1b2c3d4" },
    piano: "switch_mac",
    haSnmp: true,
    ...p,
  };
}

describe("confrontaFotografie", () => {
  it("senza conFonte ignora la fonte, con conFonte la vede", () => {
    const prima = [riga()];
    const dopo = [riga({ scelta: { credential_id: 5, port: 22, fonte: "binding_riuscito", impronta: "a1b2c3d4" } })];
    assert.deepEqual(confrontaFotografie(prima, dopo, { conFonte: false }), []);
    const d = confrontaFotografie(prima, dopo, { conFonte: true });
    assert.equal(d.length, 1);
    assert.deepEqual(d[0].campi.map((c) => c.campo), ["fonte"]);
  });

  it("vede credential_id, porta, impronta, piano e haSnmp", () => {
    const dopo = [riga({
      scelta: { credential_id: 6, port: 2222, fonte: "lettore_vecchio:binding", impronta: "ffffffff" },
      piano: "snmp_peripheral",
      haSnmp: false,
    })];
    const d = confrontaFotografie([riga()], dopo, { conFonte: false });
    assert.equal(d.length, 1);
    assert.equal(d[0].tipo, "cambiata");
    assert.deepEqual(d[0].campi.map((c) => c.campo).sort(), ["credential_id", "haSnmp", "impronta", "piano", "port"]);
  });

  it("vede la scelta che sparisce o che arriva, e le righe solo da un lato", () => {
    const senza = [riga({ scelta: null })];
    const d1 = confrontaFotografie([riga()], senza, { conFonte: false });
    assert.deepEqual(d1.map((x) => x.campi.map((c) => c.campo)), [["scelta"]]);

    const d2 = confrontaFotografie([riga(), riga({ chiave: "2:ssh", nome: "Switch due" })], [riga(), riga({ chiave: "3:ssh" })], { conFonte: false });
    assert.deepEqual(d2.map((x) => `${x.tipo}:${x.chiave}`).sort(), ["solo_dopo:3:ssh", "solo_prima:2:ssh"]);
  });

  it("due righe con la stessa chiave nella stessa fotografia sono un errore, non un confronto", () => {
    assert.throws(() => confrontaFotografie([riga(), riga()], [riga()], { conFonte: false }), /doppia/);
  });
});

describe("leggiFotografia", () => {
  it("una riga illeggibile si dice col numero, non si salta", () => {
    const buona = JSON.stringify(riga());
    assert.throws(() => leggiFotografia(`${buona}\n{non json\n`, "prima.jsonl"), /prima\.jsonl.*riga 2/);
    assert.throws(() => leggiFotografia(`${JSON.stringify({ tenant: "T1" })}\n`, "prima.jsonl"), /riga 1/);
    assert.equal(leggiFotografia(`${buona}\n\n`, "prima.jsonl").length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Lo script, come processo figlio: copia contro cartella del servizio
// ─────────────────────────────────────────────────────────────────────────────

const SEGRETI = {
  passBinding: "Segreto-Binding-7Q",
  passColonna: "Segreto-Colonna-4Z",
  community: "Comunita-Segreta-9X",
  passInline: "Segreto-Inline-2W",
  communityInline: "Comunita-Inline-6R",
  passWindows: "Segreto-Windows-5K",
  communityRete: "Comunita-Rete-3T",
};
const cifrati: string[] = [];
let idApparato = 0;
let idApparatoInline = 0;
let idApparatoSnmp = 0;
let idHost = 0;
let idRete = 0;
let credBinding = 0;
let credColonna = 0;
let credSnmp = 0;
let credWindows = 0;

function cifra(s: string): string {
  const c = encrypt(s);
  cifrati.push(c);
  return c;
}

/** Elenco dei file con mtime e dimensione: due chiamate uguali = cartella non toccata. */
function statoCartella(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const giro = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) giro(p);
      else {
        const s = fs.statSync(p);
        out[path.relative(dir, p)] = `${s.mtimeMs}:${s.size}`;
      }
    }
  };
  giro(dir);
  return out;
}

/** `datiServizio` null: l'ambiente senza DA_INVENT_DATA_DIR, come sull'hub. */
function lancia(args: string[], datiServizio: string | null, script = SCRIPT) {
  const env: NodeJS.ProcessEnv = { ...process.env, ENCRYPTION_KEY: K };
  if (datiServizio == null) delete env.DA_INVENT_DATA_DIR;
  else env.DA_INVENT_DATA_DIR = datiServizio;
  delete env.DA_IPAM_HUB_DB_PATH;
  return spawnSync(process.execPath, ["--import", "tsx", script, ...args], {
    cwd: REPO,
    env,
    encoding: "utf8",
    timeout: 180_000,
  });
}

describe("fotografia-scelte.ts sulla copia", () => {
  let radice = "";
  let servizio = "";

  before(() => {
    getHubDb();
    const d = getTenantDb(T);
    const insCred = d.prepare(
      "INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)"
    );
    credBinding = Number(insCred.run("Voce del binding", "ssh", cifra("op-binding"), cifra(SEGRETI.passBinding)).lastInsertRowid);
    credColonna = Number(insCred.run("Voce della colonna", "ssh", cifra("op-colonna"), cifra(SEGRETI.passColonna)).lastInsertRowid);
    credSnmp = Number(insCred.run("Community di prova", "snmp", null, cifra(SEGRETI.community)).lastInsertRowid);
    credWindows = Number(insCred.run("Account WinRM dell'AD", "windows", cifra("DOM\\op-ad"), cifra(SEGRETI.passWindows)).lastInsertRowid);
    idRete = Number(
      d.prepare("INSERT INTO networks (cidr, name, snmp_community) VALUES ('10.99.0.0/24', 'Rete di prova', ?)").run(SEGRETI.communityRete)
        .lastInsertRowid
    );
    // Apparato API senza binding: utente e password nelle colonne, community inline cifrata.
    idApparatoInline = Number(
      d.prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, classification, username, encrypted_password, community_string, port)
         VALUES ('AP di prova', '10.99.0.3', 'access_point', 'ubiquiti', 'api', 'access_point', 'op-inline', ?, ?, 443)`
      ).run(cifra(SEGRETI.passInline), cifra(SEGRETI.communityInline)).lastInsertRowid
    );
    // Apparato SNMP senza nessuna fonte: oggi riceve «public».
    idApparatoSnmp = Number(
      d.prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, port)
         VALUES ('Stampante di prova', '10.99.0.4', 'switch', 'other', 'snmp_v2', 161)`
      ).run().lastInsertRowid
    );
    // AD con l'account WinRM: ripiego delle patch per gli host Windows senza righe WinRM.
    d.prepare(
      `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, winrm_credential_id)
       VALUES ('AD di prova', 'dc.prova.local', 'prova.local', 'DC=prova,DC=local', ?, ?, ?)`
    ).run(cifra("ldap-op"), cifra("Segreto-Ldap-8P"), credWindows);
    // Chiave Windows «di default» dell'hub (misura #31): si accoda alla catena WinRM della rete.
    setSetting("host_windows_credential_id", String(credWindows));
    idHost = Number(
      d.prepare("INSERT INTO hosts (network_id, ip, hostname, os_info) VALUES (?, '10.99.0.10', 'srv-prova', 'Windows Server 2022')")
        .run(idRete).lastInsertRowid
    );
    d.prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (?, ?, 'ssh', 22, 1)")
      .run(idHost, credBinding);
    // La stampante senza fonti propria è collegata all'host: con D1b = (b) riceverebbe la voce SNMP della catena.
    d.prepare("UPDATE network_devices SET host_id = ? WHERE id = ?").run(idHost, idApparatoSnmp);
    idApparato = Number(
      d.prepare(
        `INSERT INTO network_devices (name, host, device_type, vendor, protocol, credential_id, snmp_credential_id, port)
         VALUES ('Switch di prova', '10.99.0.2', 'switch', 'hp', 'ssh', ?, ?, 22)`
      ).run(credColonna, credSnmp).lastInsertRowid
    );
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, 'ssh', 22, 0)")
      .run(idApparato, credBinding);
    const insRete = d.prepare("INSERT INTO network_credentials (network_id, credential_id, sort_order) VALUES (?, ?, ?)");
    insRete.run(idRete, credBinding, 0);
    insRete.run(idRete, credSnmp, 1);
    closeTenantDb(T);
    closeHubDb();

    // La «cartella del servizio»: una copia a parte, che lo script NON deve toccare.
    radice = fs.mkdtempSync(path.join(os.tmpdir(), "fotografia-prova-"));
    servizio = path.join(radice, "servizio");
    fs.mkdirSync(path.join(servizio, "tenants"), { recursive: true });
    fs.copyFileSync(path.join(TEST_DATA_DIR, "hub.db"), path.join(servizio, "hub.db"));
    fs.copyFileSync(path.join(TEST_DATA_DIR, "tenants", `${T}.db`), path.join(servizio, "tenants", `${T}.db`));
  });

  after(() => {
    if (radice) fs.rmSync(radice, { recursive: true, force: true });
  });

  it("con DA_INVENT_DATA_DIR verso il servizio lavora su --dati e lascia il servizio intatto", () => {
    const statoPrima = statoCartella(servizio);
    const out = path.join(radice, "fotografie", "base.jsonl");
    const r = lancia(["--dati", TEST_DATA_DIR, "--out", out], servizio);
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(statoCartella(servizio), statoPrima, "la cartella del servizio è stata toccata");
    // La provenienza ricostruita torna col lettore vero ovunque, e la chiave decifra.
    assert.match(r.stdout, new RegExp(`\\[${T}\\] .*leggibili 4/4; provenienza non ricostruita 0`));

    const righe = leggiFotografia(fs.readFileSync(out, "utf8"), out).filter((x) => x.tenant === T);
    const trova = (oggetto: RigaFotografia["oggetto"], chiave: string) => {
      const x = righe.find((y) => y.oggetto === oggetto && y.chiave === chiave);
      assert.ok(x, `manca la riga ${oggetto} ${chiave}`);
      return x;
    };

    // Apparato: il binding vince sulla colonna (D1 = (a)). Dalla 2b la fonte è quella del motore (T8).
    const app = trova("apparato", `${idApparato}:ssh`);
    assert.equal(app.scelta?.credential_id, credBinding);
    assert.equal(app.scelta?.port, 22);
    assert.equal(app.scelta?.impronta, impronta(chiaroDaParti("op-binding", SEGRETI.passBinding), K));
    assert.equal(app.scelta?.fonte, "device_binding");
    assert.equal(typeof app.piano, "string");
    assert.equal(app.haSnmp, true);

    const snmp = trova("apparato", `${idApparato}:snmp`);
    assert.equal(snmp.scelta?.credential_id, credSnmp);
    assert.equal(snmp.scelta?.fonte, "device_column");
    assert.equal(snmp.scelta?.port, 161);
    assert.equal(snmp.scelta?.impronta, impronta(chiaroDaParti(SEGRETI.community), K));

    // Colonne inline e community_string: nessun id, la fonte del motore.
    const inline = trova("apparato", `${idApparatoInline}:api`);
    assert.equal(inline.scelta?.credential_id, null);
    assert.equal(inline.scelta?.port, 443);
    assert.equal(inline.scelta?.fonte, "device_column_inline");
    assert.equal(inline.scelta?.impronta, impronta(chiaroDaParti("op-inline", SEGRETI.passInline), K));
    const comInline = trova("apparato", `${idApparatoInline}:snmp`);
    assert.equal(comInline.scelta?.fonte, "device_column_inline");
    assert.equal(comInline.scelta?.impronta, impronta(chiaroDaParti(SEGRETI.communityInline), K));
    // L'apparato SNMP senza fonti: «public», dichiarato come tale (D5), non la voce SNMP della catena (D1b = (a)).
    const pubblico = trova("apparato", `${idApparatoSnmp}:snmp`);
    assert.equal(pubblico.scelta?.fonte, "snmp_ripiego");
    assert.equal(pubblico.scelta?.impronta, impronta(chiaroDaParti("public"), K));
    assert.equal(pubblico.haSnmp, true);
    assert.equal(righe.some((y) => y.chiave === `${idApparatoSnmp}:ssh`), false, "un apparato SNMP ha solo la riga snmp");

    // Host: la riga validata; rete: la catena SSH e quella SNMP (voce, poi community della rete, poi public).
    assert.equal(trova("host", `${idHost}:ssh`).scelta?.credential_id, credBinding);
    assert.equal(trova("rete", `${idRete}:ssh:0`).scelta?.credential_id, credBinding);
    assert.equal(trova("rete", `${idRete}:snmp:0`).scelta?.credential_id, credSnmp);
    assert.equal(trova("rete", `${idRete}:snmp:1`).scelta?.fonte, "lettore_vecchio:community_rete");
    assert.equal(trova("rete", `${idRete}:snmp:2`).scelta?.fonte, "lettore_vecchio:public");
    const chiaveHub = trova("rete", `${idRete}:winrm:0`);
    assert.equal(chiaveHub.scelta?.credential_id, credWindows);
    assert.equal(chiaveHub.scelta?.fonte, "lettore_vecchio:chiave_hub");
    // Anteprima edge: passa dal facade db.ts; se il contesto tenant si perdesse,
    // leggerebbe DEFAULT e questa riga non ci sarebbe.
    assert.equal(trova("edge", `${idRete}:ssh:0`).scelta?.credential_id, credBinding);
    // Patch: host Windows senza righe WinRM → l'account WinRM dell'AD, sulla 5985,
    // con la fonte del motore (T9).
    const patch = trova("patch", `${idHost}:winrm`);
    assert.equal(patch.scelta?.credential_id, credWindows);
    assert.equal(patch.scelta?.fonte, "ad_fallback");
    assert.equal(patch.scelta?.port, 5985);

    // Nessun segreto né testo cifrato nel file e a terminale.
    const tutto = `${fs.readFileSync(out, "utf8")}\n${r.stdout}\n${r.stderr}`;
    for (const s of [...Object.values(SEGRETI), ...cifrati]) {
      assert.ok(!tutto.includes(s), "un segreto o un testo cifrato è uscito dallo script");
    }
    // Cartella 0700, file 0600.
    assert.equal(fs.statSync(path.dirname(out)).mode & 0o777, 0o700);
    assert.equal(fs.statSync(out).mode & 0o777, 0o600);
  });

  it("misure-2a.ts: solo conteggi, servizio intatto, nessun segreto", () => {
    const statoPrima = statoCartella(servizio);
    const r = lancia(["--dati", TEST_DATA_DIR], servizio, SCRIPT_MISURE);
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.deepEqual(statoCartella(servizio), statoPrima, "la cartella del servizio è stata toccata");
    const o = r.stdout;
    assert.match(o, /chiave Windows dell'hub \(host_windows_credential_id\): impostata/);
    assert.match(o, /\[#31\/D3\] chiave Windows: esiste, tipo windows \(giusto\); reti 1, già in catena 0, manca 1 → N = 1/);
    assert.match(o, /\[#31\/D3\] chiave Linux: non impostata/);
    assert.match(o, /\[D5\] apparati 3; con «public» di ripiego 1 \(protocollo SNMP principale 1, «ha SNMP\?» vero 1\); per vendor: other 1/);
    assert.match(o, new RegExp(`\\[D8\\]   #${credWindows} windows: .*ad_integrations\\.winrm_credential_id=1.*chiave_hub_windows=1`));
    assert.match(o, /\[D8\] voci senza nessun uso: 0/);
    assert.match(o, /\[D1b\] snmp: apparati senza fonte propria 1 \(senza host_id 0\) → candidati da righe host validate 0, catena della rete 1, catene vecchie 0, chiave dell'hub 0; almeno uno 1; tipo del primo: snmp 1/);
    assert.match(o, /\[2e\] utente\/password in colonna: 1 \(api 1\) → con binding dello stesso protocollo 0 \(uguale 0, diverso 0\), senza binding 1/);
    assert.match(o, /\[2e\] colonna SNMP verso una voce: 1 → già con binding snmp alla stessa voce 0, senza 1/);
    assert.match(o, /\[2e\] credential_id verso una voce non SNMP: 1 \(ssh su ssh 1\) → .*nessun binding alla voce 1/);
    assert.match(o, /\[2e\] community_string in colonna: 1 → .*senza binding snmp 1/);
    const tutto = `${r.stdout}\n${r.stderr}`;
    for (const s of [...Object.values(SEGRETI), ...cifrati]) {
      assert.ok(!tutto.includes(s), "un segreto o un testo cifrato è uscito dalle misure");
    }
  });

  it("--dati uguale alla cartella del servizio: esce con 2 senza aprire niente", () => {
    const statoPrima = statoCartella(servizio);
    const out = path.join(radice, "fotografie-2", "x.jsonl");
    const r = lancia(["--dati", servizio, "--out", out], servizio);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /servizio/);
    assert.deepEqual(statoCartella(servizio), statoPrima);
    assert.equal(fs.existsSync(out), false);
  });

  // Revisione della 2a: senza DA_INVENT_DATA_DIR la cartella del servizio si
  // ricavava da process.cwd()/data, ma gli script girano da $L/codice-*, non
  // dalla cartella dell'app. Sull'hub l'unità non ha la variabile (i dati sono
  // in /opt/da-invent/data): la guardia confrontava --dati con la cartella
  // sbagliata e lasciava passare anche i dati veri.
  it("senza DA_INVENT_DATA_DIR e senza --dati-servizio: esce con 2 senza aprire niente", () => {
    const statoPrima = statoCartella(servizio);
    const out = path.join(radice, "fotografie-3", "x.jsonl");
    // --dati è proprio la cartella «del servizio»: con la guardia aperta passerebbe.
    const r = lancia(["--dati", servizio, "--out", out], null);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /--dati-servizio/);
    assert.deepEqual(statoCartella(servizio), statoPrima);
    assert.equal(fs.existsSync(out), false);
    const m = lancia(["--dati", servizio], null, SCRIPT_MISURE);
    assert.equal(m.status, 2, `${m.stdout}\n${m.stderr}`);
    assert.match(m.stderr, /--dati-servizio/);
    assert.deepEqual(statoCartella(servizio), statoPrima);
  });

  it("senza DA_INVENT_DATA_DIR, con --dati-servizio: la guardia confronta con quella", () => {
    const statoPrima = statoCartella(servizio);
    const sbagliata = lancia(["--dati", servizio, "--dati-servizio", servizio], null, SCRIPT_MISURE);
    assert.equal(sbagliata.status, 2, `${sbagliata.stdout}\n${sbagliata.stderr}`);
    assert.match(sbagliata.stderr, /servizio/);
    const giusta = lancia(["--dati", TEST_DATA_DIR, "--dati-servizio", servizio], null, SCRIPT_MISURE);
    assert.equal(giusta.status, 0, `${giusta.stdout}\n${giusta.stderr}`);
    assert.deepEqual(statoCartella(servizio), statoPrima);
  });

  it("si rifiuta di scrivere in una cartella con permessi più larghi di 0700", () => {
    const larga = path.join(radice, "larga");
    fs.mkdirSync(larga, { mode: 0o755 });
    fs.chmodSync(larga, 0o755);
    const r = lancia(["--dati", TEST_DATA_DIR, "--out", path.join(larga, "x.jsonl")], servizio);
    assert.equal(r.status, 2, `${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /permessi/);
    assert.equal(fs.existsSync(path.join(larga, "x.jsonl")), false);
  });

  it("--confronta: 0 senza differenze, 1 con differenze stampate per nome", () => {
    const dir = path.join(radice, "confronto");
    fs.mkdirSync(dir, { mode: 0o700 });
    const a = path.join(dir, "prima.jsonl");
    const b = path.join(dir, "dopo.jsonl");
    fs.writeFileSync(a, `${JSON.stringify(riga())}\n`);
    fs.writeFileSync(b, `${JSON.stringify(riga())}\n`);
    const uguali = lancia(["--confronta", a, b], servizio);
    assert.equal(uguali.status, 0, `${uguali.stdout}\n${uguali.stderr}`);

    fs.writeFileSync(b, `${JSON.stringify(riga({ scelta: { credential_id: 9, port: 22, fonte: "x", impronta: "00000000" } }))}\n`);
    const diverse = lancia(["--confronta", a, b], servizio);
    assert.equal(diverse.status, 1, `${diverse.stdout}\n${diverse.stderr}`);
    assert.match(diverse.stdout, /Switch uno/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Revisione della 2a: gli apparati col protocollo snmp_v3 senza una v3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Dal T4 le cinque sessioni v3 (lettura dati, switch, router, sonda delle
 * interfacce, walk dei NAS) danno «Credenziale SNMPv3 assente o illeggibile»
 * a un apparato snmp_v3 senza una v3, invece di ripiegare sulla community. La
 * fotografia della 2a scriveva ancora la community: prima e dopo coincidevano
 * e il criterio d'arresto («0 differenze») non vedeva l'unico cambio di
 * lettura della 2a. E nessuna misura contava questi apparati.
 */
describe("fotografia e misure della 2a sugli apparati snmp_v3", () => {
  const TV3 = "TESTFOTOV3";
  let radiceV3 = "";
  let servizioV3 = "";
  const id: Record<string, number> = {};
  const voce: Record<string, number> = {};

  before(() => {
    getHubDb();
    const d = getTenantDb(TV3);
    const ins = d.prepare(
      `INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password, security_level, auth_protocol, encrypted_auth_key, priv_protocol, encrypted_priv_key)
       VALUES (?, 'snmp', ?, ?, ?, ?, ?, ?, ?)`
    );
    voce.community = Number(ins.run("Community v2c", null, cifra("Comunita-V2c-1A"), null, null, null, null, null).lastInsertRowid);
    voce.v3 = Number(
      ins.run("V3 completa", cifra("monitor"), null, "authPriv", "SHA", cifra("Chiave-Auth-2B"), "AES", cifra("Chiave-Priv-3C")).lastInsertRowid
    );
    voce.vecchia = Number(ins.run("V3 vecchia", cifra("monitor-vecchio"), cifra("Chiave-Vecchia-4D"), null, null, null, null, null).lastInsertRowid);
    const app = d.prepare(
      `INSERT INTO network_devices (name, host, device_type, vendor, protocol, port, credential_id, community_string)
       VALUES (?, ?, 'switch', 'hp', 'snmp_v3', 161, ?, ?)`
    );
    id.colonna = Number(app.run("V3 con la community in colonna", "10.98.0.1", voce.community, null).lastInsertRowid);
    id.completa = Number(app.run("V3 completa", "10.98.0.2", voce.v3, null).lastInsertRowid);
    id.vecchia = Number(app.run("V3 formato vecchio", "10.98.0.3", voce.vecchia, null).lastInsertRowid);
    id.nulla = Number(app.run("V3 senza niente", "10.98.0.4", null, null).lastInsertRowid);
    id.stringa = Number(app.run("V3 con community_string", "10.98.0.5", null, cifra("Comunita-Stringa-5E")).lastInsertRowid);
    id.binding = Number(app.run("V3 con un binding a community", "10.98.0.6", null, null).lastInsertRowid);
    d.prepare("INSERT INTO device_credential_bindings (device_id, credential_id, protocol_type, port, sort_order) VALUES (?, ?, 'snmp', 161, 0)")
      .run(id.binding, voce.community);
    closeTenantDb(TV3);
    closeHubDb();
    radiceV3 = fs.mkdtempSync(path.join(os.tmpdir(), "fotografia-v3-"));
    servizioV3 = path.join(radiceV3, "servizio");
    fs.mkdirSync(path.join(servizioV3, "tenants"), { recursive: true });
  });

  after(() => {
    if (radiceV3) fs.rmSync(radiceV3, { recursive: true, force: true });
  });

  it("la fotografia: snmp_v3 senza v3 → nessuna scelta (era la community, fino alla 2a); la v3 resta", () => {
    const out = path.join(radiceV3, "fotografie", "v3.jsonl");
    const r = lancia(["--dati", TEST_DATA_DIR, "--out", out], servizioV3);
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stdout, new RegExp(`\\[${TV3}\\] .*provenienza non ricostruita 0`));
    const righe = leggiFotografia(fs.readFileSync(out, "utf8"), out).filter((x) => x.tenant === TV3);
    const snmp = (k: string) => {
      const x = righe.find((y) => y.oggetto === "apparato" && y.chiave === `${id[k]}:snmp`);
      assert.ok(x, `manca la riga snmp di ${k}`);
      return x;
    };
    for (const k of ["colonna", "nulla", "stringa", "binding"]) {
      assert.equal(snmp(k).scelta, null, `${k}: la 2a non legge più la community di un apparato snmp_v3 senza v3`);
    }
    // Dalla 2b la fonte è quella del motore (T8); l'impronta resta quella della 2a.
    assert.equal(snmp("completa").scelta?.credential_id, voce.v3);
    assert.equal(snmp("completa").scelta?.fonte, "device_column");
    assert.equal(snmp("completa").scelta?.impronta, impronta(chiaroDaParti("monitor", "Chiave-Auth-2B", "Chiave-Priv-3C"), K));
    assert.equal(snmp("vecchia").scelta?.credential_id, voce.vecchia);
    assert.equal(snmp("vecchia").scelta?.fonte, "device_column");
    assert.equal(snmp("vecchia").scelta?.impronta, impronta(chiaroDaParti("monitor-vecchio", "Chiave-Vecchia-4D"), K));
  });

  it("misure-2a.ts conta gli apparati snmp_v3: v3 completa, formato vecchio, senza v3 e da dove leggono oggi", () => {
    const r = lancia(["--dati", TEST_DATA_DIR], servizioV3, SCRIPT_MISURE);
    assert.equal(r.status, 0, `uscita ${r.status}\n${r.stdout}\n${r.stderr}`);
    const blocco = r.stdout.split(`== Tenant ${TV3}`)[1]?.split("== Tenant")[0] ?? "";
    assert.match(
      blocco,
      /\[snmp_v3\] apparati col protocollo snmp_v3: 6 → v3 completa 1, formato vecchio 1, senza v3 4 \(oggi leggono la community da binding 1, colonna 1, community_string 1, «public» 1\)/
    );
    assert.match(blocco, /\[snmp_v3\] .*la 2a li ferma.*ci si ferma/);
    // Il tenant del primo blocco non ha apparati snmp_v3: la riga c'è e dice 0, senza l'arresto.
    const primo = r.stdout.split(`== Tenant ${T}`)[1]?.split("== Tenant")[0] ?? "";
    assert.match(primo, /\[snmp_v3\] apparati col protocollo snmp_v3: 0 → v3 completa 0, formato vecchio 0, senza v3 0\n/);
  });
});
