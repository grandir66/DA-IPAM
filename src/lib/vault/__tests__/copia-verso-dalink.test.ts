/**
 * Vault semplice, passo 6 (piano DA-Link `2026-10-29-vault-passo6-app.md`, S2): la copia delle voci da OpenBao a
 * DA-Link, in vista del passo 7 sul live. Si prova:
 * - l'elenco = cartella dell'app (con sottocartelle) + `credential_ref` del database, senza doppioni;
 * - classificazione `copierei` / `uguale` / `diversa` / `manca in OpenBao` (e `percorso non valido`);
 * - a vuoto di serie (niente scritto), `--applica` scrive solo i `copierei`, la sostituzione solo con `--sostituisci`
 *   (caso 5 del piano), `--verifica` solo confronto; dopo la scrittura si rilegge da DA-Link;
 * - un errore di OpenBao o di DA-Link ferma tutto con un messaggio chiaro (mai «0 voci» su un guasto);
 * - l'uscita non contiene mai valori, né il gettone di DA-Link, né il secret_id di OpenBao, né il corpo delle risposte;
 * - la CLI legge entrambe le configurazioni senza guardare gli interruttori `DA_VAULT_*`.
 *
 * Contro un OpenBao finto (in-process per la logica, in HTTP locale per la CLI) e il DA-Link finto col TLS vero.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/copia-verso-dalink.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encrypt } from "@/lib/crypto";
import { cartellaTenant, closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, createTenant, getHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { copiaVersoDalink, ErroreCopia, type EsitoCopia } from "../copia-verso-dalink";
import { DaLinkStore } from "../dalink";
import { OpenBaoStore } from "../openbao";
import { creaDaLinkFinto, MARCA_CORPO, type DaLinkFinto } from "./support/dalink-finto";
import { creaOpenBaoFinto, servaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const PW_A = "pw-A-segretissima-4471";
const PW_B_OB = "pw-B-openbao-5582";
const PW_B_DL = "pw-B-dalink-6693";
const PW_X = "pw-X-cliente-7704";
const PW_GONE = "pw-GONE-8815";
/** Il server HTTP di Node rifiuta `LIST`: il processo figlio lo manda come `GET ?list=true` (vedi il file). */
const SHIM_LIST = join(process.cwd(), "src", "lib", "vault", "__tests__", "support", "fetch-list-come-get.ts");
const VALORI = [PW_A, PW_B_OB, PW_B_DL, PW_X, PW_GONE, "utente-segreto-9926"];

// ── la logica, con i due store veri su due finti ─────────────────────────────

describe("copiaVersoDalink (logica)", () => {
  let dl: DaLinkFinto;
  let ob: OpenBaoFinto;
  const ora = () => Date.parse("2026-10-29T08:00:00Z");

  const openbao = () => new OpenBaoStore({ url: ob.url, roleId: ob.roleId, secretId: () => ob.secretId, cartelle: [], fetch: ob.fetch, ora });
  const dalink = () => new DaLinkStore({ url: dl.url, gettone: dl.gettone, impronta: dl.impronta, ora });

  /** OpenBao: a (cartella), sub/b (sottocartella), x (riferimento di un cliente). DA-Link: a uguale, b diversa, x manca. */
  function scenario() {
    ob.kv.set("app/da-ipam/a", { username: "utente-segreto-9926", password: PW_A });
    ob.kv.set("app/da-ipam/sub/b", { password: PW_B_OB });
    ob.kv.set("clienti/c1/da-ipam/x", { password: PW_X });
    dl.scriviDaFuori("app/da-ipam/a", { username: "utente-segreto-9926", password: PW_A });
    dl.scriviDaFuori("app/da-ipam/sub/b", { password: PW_B_DL });
  }

  const riferimenti = [
    { percorso: "clienti/c1/da-ipam/x", origine: "C1#1" },
    { percorso: "app/da-ipam/a", origine: "C1#2" }, // doppione di uno della cartella
    { percorso: "clienti/c1/da-ipam/gone", origine: "C1#3" }, // nel database ma non in OpenBao
    { percorso: "Percorso Cattivo", origine: "C1#4" },
  ];

  const classi = (e: EsitoCopia) => Object.fromEntries(e.voci.map((v) => [v.percorso, v.classe]));
  const scrittureDalink = () => dl.richieste.filter((r) => r.metodo !== "GET");
  const scrittureOpenbao = () => ob.richieste.filter((r) => (r.metodo === "POST" || r.metodo === "PUT" || r.metodo === "DELETE") && !r.percorso.startsWith("/v1/auth/"));

  beforeEach(async () => {
    dl = await creaDaLinkFinto();
    ob = creaOpenBaoFinto({ ora });
    scenario();
  });
  afterEach(async () => {
    await dl.chiudi();
  });

  it("a vuoto: classifica ogni percorso una volta sola e non scrive in nessuno dei due", async () => {
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti, modo: "a_vuoto" });
    assert.deepEqual(classi(e), {
      "app/da-ipam/a": "uguale",
      "app/da-ipam/sub/b": "diversa",
      "clienti/c1/da-ipam/x": "copierei",
      "clienti/c1/da-ipam/gone": "manca_in_openbao",
      "Percorso Cattivo": "non_valido",
    });
    assert.equal(e.voci.length, 5, "il doppione non conta due volte");
    assert.equal(e.ok, false, "diversa, mancante e non valido non tornano");
    assert.equal(e.scritte, 0);
    assert.deepEqual(scrittureDalink(), []);
    assert.deepEqual(scrittureOpenbao(), []);
    assert.equal(dl.voci.size, 2);
    assert.equal(dl.voci.get("app/da-ipam/sub/b")?.valori.password, PW_B_DL);
    // l'origine del doppione resta con la voce
    assert.deepEqual(e.voci.find((v) => v.percorso === "app/da-ipam/a")?.origini, ["C1#2"]);
  });

  it("a vuoto con solo copierei e uguali: esito ok (il da farsi non è un errore)", async () => {
    ob.kv.delete("app/da-ipam/sub/b");
    dl.voci.delete("app/da-ipam/sub/b");
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [riferimenti[0]], modo: "a_vuoto" });
    assert.deepEqual(classi(e), { "app/da-ipam/a": "uguale", "clienti/c1/da-ipam/x": "copierei" });
    assert.equal(e.ok, true);
  });

  it("--verifica: solo confronto, niente scritto, e un copierei è già un 'non torna'", async () => {
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [riferimenti[0]], modo: "verifica" });
    assert.equal(classi(e)["clienti/c1/da-ipam/x"], "copierei");
    assert.equal(e.ok, false);
    assert.deepEqual(scrittureDalink(), []);
  });

  it("--applica scrive solo i copierei: la voce diversa resta com'è (caso 5), l'esito non è ok", async () => {
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti, modo: "applica" });
    assert.equal(e.scritte, 1);
    assert.equal(dl.voci.get("clienti/c1/da-ipam/x")?.valori.password, PW_X);
    assert.equal(dl.voci.get("app/da-ipam/sub/b")?.valori.password, PW_B_DL, "la voce diversa non si tocca senza --sostituisci");
    assert.equal(dl.voci.get("app/da-ipam/a")?.versione, 1, "l'uguale non si riscrive");
    const x = e.voci.find((v) => v.percorso === "clienti/c1/da-ipam/x");
    assert.equal(x?.classe, "uguale", "dopo la scrittura si rilegge da DA-Link e torna uguale");
    assert.equal(x?.scritta, true);
    assert.equal(e.voci.find((v) => v.percorso === "app/da-ipam/sub/b")?.classe, "diversa");
    assert.equal(e.ok, false);
    assert.equal(scrittureOpenbao().length, 0);
  });

  it("--applica --sostituisci sostituisce anche la diversa; senza mancanti né non validi l'esito è ok", async () => {
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [riferimenti[0]], modo: "applica", sostituisci: true });
    assert.equal(e.scritte, 2);
    assert.equal(dl.voci.get("app/da-ipam/sub/b")?.valori.password, PW_B_OB);
    assert.equal(dl.voci.get("app/da-ipam/sub/b")?.versione, 2, "la sostituzione porta la versione attesa, non azzera");
    assert.ok(e.voci.every((v) => v.classe === "uguale"));
    assert.equal(e.ok, true);
  });

  it("un campo vuoto della sorgente non conta nel confronto (DA-Link lo scarta): uguale, e uguale dopo la scrittura", async () => {
    ob.kv.clear();
    dl.voci.clear();
    ob.kv.set("app/da-ipam/a", { username: "u-vuoto-1", password: PW_A, note: "" });
    dl.scriviDaFuori("app/da-ipam/a", { username: "u-vuoto-1", password: PW_A });
    ob.kv.set("clienti/c1/da-ipam/x", { password: PW_X, community: "" });
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [riferimenti[0]], modo: "a_vuoto" });
    assert.deepEqual(classi(e), { "app/da-ipam/a": "uguale", "clienti/c1/da-ipam/x": "copierei" });
    assert.equal(e.ok, true);
    const a = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [riferimenti[0]], modo: "applica" });
    assert.equal(a.voci.find((v) => v.percorso === "clienti/c1/da-ipam/x")?.classe, "uguale", "riletta da DA-Link senza il campo vuoto: uguale");
    assert.equal(a.ok, true);
    assert.equal(dl.voci.get("app/da-ipam/a")?.versione, 1, "l'uguale non si riscrive");
  });

  it("voci che DA-Link non può tenere: «non copiabile» a vuoto, mai scritte con --applica, l'esito non è ok", async () => {
    ob.kv.clear();
    dl.voci.clear();
    ob.kv.set("app/da-ipam/buona", { username: "è-già-così", password: "pässwörd-😀-ok\ttab" });
    ob.kv.set("app/da-ipam/maiuscola", { Password: "x-maiuscola-1" });
    ob.kv.set("app/da-ipam/spazio", { "nome con spazio": "x-spazio-2" });
    ob.kv.set("app/da-ipam/lungo", { ["a".repeat(65)]: "x-lungo-3" });
    ob.kv.set("app/da-ipam/zero", { password: "x-zero\u0000-4" });
    ob.kv.set("app/da-ipam/controllo", { password: "x-ctrl\u0001-5" });
    ob.kv.set("app/da-ipam/surrogato", { password: "x-sur\ud800-6" });
    ob.kv.set("app/da-ipam/otp", { password: "x-otp-7", otp: "otpauth://totp/x" });
    ob.kv.set("app/da-ipam/vuoto-ma-storto", { Strano: "" });
    const attese = {
      "app/da-ipam/buona": "copierei",
      "app/da-ipam/maiuscola": "non_copiabile",
      "app/da-ipam/spazio": "non_copiabile",
      "app/da-ipam/lungo": "non_copiabile",
      "app/da-ipam/zero": "non_copiabile",
      "app/da-ipam/controllo": "non_copiabile",
      "app/da-ipam/surrogato": "non_copiabile",
      "app/da-ipam/otp": "non_copiabile",
      "app/da-ipam/vuoto-ma-storto": "non_copiabile",
    };
    const vuoto = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [], modo: "a_vuoto" });
    assert.deepEqual(classi(vuoto), attese);
    assert.equal(vuoto.ok, false);
    assert.deepEqual(scrittureDalink(), []);
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [], modo: "applica" });
    assert.equal(e.errore, null, e.errore ?? "");
    assert.equal(e.scritte, 1, "solo la buona");
    assert.deepEqual([...dl.voci.keys()], ["app/da-ipam/buona"]);
    assert.deepEqual(classi(e), { ...attese, "app/da-ipam/buona": "uguale" });
    assert.equal(e.ok, false);
    assert.ok(!JSON.stringify(e).includes("x-zero"), "l'esito non porta valori");
  });

  it("OpenBao spento: errore chiaro di OpenBao, niente 0 voci, niente scritto in DA-Link", async () => {
    ob.giu = true;
    const p = copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti, modo: "applica", sostituisci: true });
    await assert.rejects(p, (e: unknown) => e instanceof ErroreCopia && e.backend === "OpenBao" && /OpenBao/.test(e.message));
    assert.deepEqual(scrittureDalink(), []);
  });

  it("OpenBao che rifiuta una lettura di un riferimento: ferma tutto (non lo spaccia per 'manca')", async () => {
    const o = openbao();
    const get = o.get.bind(o);
    o.get = async (p, op) => {
      if (p === "clienti/c1/da-ipam/x") throw new (await import("../tipi")).ErroreVault("rifiutato", "OpenBao ha rifiutato la lettura (HTTP 403)");
      return get(p, op);
    };
    await assert.rejects(copiaVersoDalink({ openbao: o, dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti, modo: "applica" }), (e: unknown) => e instanceof ErroreCopia && e.backend === "OpenBao");
    assert.deepEqual(scrittureDalink(), []);
  });

  it("DA-Link in 503 / gettone rifiutato / certificato diverso: errore di DA-Link, niente scritto, niente 'copierei' inventati", async () => {
    dl.giu = true;
    await assert.rejects(copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti, modo: "a_vuoto" }), (e: unknown) => e instanceof ErroreCopia && e.backend === "DA-Link");
    dl.giu = false;
    const sbagliato = new DaLinkStore({ url: dl.url, gettone: "dlv_" + "z".repeat(43), impronta: dl.impronta, ora });
    await assert.rejects(copiaVersoDalink({ openbao: openbao(), dalink: sbagliato, cartelle: ["app/da-ipam"], riferimenti, modo: "applica" }), (e: unknown) => e instanceof ErroreCopia && e.backend === "DA-Link" && /gettone/.test(e.message));
    const altroCert = new DaLinkStore({ url: dl.url, gettone: dl.gettone, impronta: "sha256/" + Buffer.alloc(32, 7).toString("base64"), ora });
    await assert.rejects(copiaVersoDalink({ openbao: openbao(), dalink: altroCert, cartelle: ["app/da-ipam"], riferimenti, modo: "applica" }), (e: unknown) => e instanceof ErroreCopia && e.backend === "DA-Link" && /ertificato/.test(e.message));
    assert.deepEqual(scrittureDalink(), []);
    assert.equal(dl.voci.size, 2);
  });

  it("DA-Link che cade a metà della scrittura: si ferma, dice quale voce, le altre non sono scritte", async () => {
    ob.kv.set("clienti/c1/da-ipam/y", { password: "pw-Y-9037" });
    dl.forza = (r) => (r.metodo === "PUT" && r.corpo.includes("da-ipam/y") ? { status: 503, body: JSON.stringify({ detail: MARCA_CORPO }) } : null);
    const e = await copiaVersoDalink({
      openbao: openbao(),
      dalink: dalink(),
      cartelle: [],
      riferimenti: [
        { percorso: "clienti/c1/da-ipam/x", origine: "C1#1" },
        { percorso: "clienti/c1/da-ipam/y", origine: "C1#2" },
      ],
      modo: "applica",
    });
    assert.match(e.errore ?? "", /clienti\/c1\/da-ipam\/y/);
    assert.ok(!(e.errore ?? "").includes(MARCA_CORPO));
    assert.equal(e.ok, false);
    assert.equal(e.scritte, 1);
    assert.equal(e.voci.find((v) => v.percorso === "clienti/c1/da-ipam/x")?.scritta, true);
    assert.equal(e.voci.find((v) => v.percorso === "clienti/c1/da-ipam/y")?.scritta, false);
  });

  it("zero voci in tutto: non è un successo (cartella o mount sbagliati)", async () => {
    ob.kv.clear();
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti: [], modo: "verifica" });
    assert.equal(e.voci.length, 0);
    assert.equal(e.ok, false);
  });

  it("l'esito non contiene mai un valore", async () => {
    const e = await copiaVersoDalink({ openbao: openbao(), dalink: dalink(), cartelle: ["app/da-ipam"], riferimenti, modo: "applica", sostituisci: true });
    const testo = JSON.stringify(e);
    for (const v of VALORI) assert.ok(!testo.includes(v), `valore nell'esito: ${v}`);
  });
});

// ── la riga di comando, sull'hub ─────────────────────────────────────────────

describe("scripts/da-vault-copia-verso-dalink.ts", () => {
  const T = "C70003";
  const GETTONE_OPENBAO_SID = "sid-segretissimo-cli";
  let ob: OpenBaoFinto;
  let urlOb: string;
  let chiudiOb: () => Promise<void>;
  let dl: DaLinkFinto;
  let fileSid: string;

  before(async () => {
    ({ finto: ob, url: urlOb, chiudi: chiudiOb } = await servaOpenBaoFinto({ ora: Date.now }));
    fileSid = join(mkdtempSync(join(tmpdir(), "da-vault-copia-sid-")), "secret-id");
    writeFileSync(fileSid, `${ob.secretId}\n`, { mode: 0o600 });
    createTenant({ codice_cliente: T, ragione_sociale: "Cliente copia", active: 1 } as Parameters<typeof createTenant>[0]);
    withTenant(T, () => {
      const dbh = getTenantDb(T);
      const id = creaCredenzialeDb(dbh, { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("colonna-non-letta") });
      dbh.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?").run("clienti/c70003/da-ipam/firewall-1", typeof id === "number" ? id : (id as { id: number }).id);
    });
    closeTenantDb(T);
    closeHubDb();
  });
  after(async () => {
    await chiudiOb();
  });
  beforeEach(async () => {
    dl = await creaDaLinkFinto();
    ob.kv.clear();
    ob.kv.set("app/da-ipam/a", { username: "utente-segreto-9926", password: PW_A });
    ob.kv.set("clienti/c70003/da-ipam/firewall-1", { password: PW_X });
  });
  afterEach(async () => {
    await dl.chiudi();
  });

  function cli(args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((ok) => {
      const p = spawn(process.execPath, ["--import", "tsx", "--import", SHIM_LIST, join(process.cwd(), "scripts", "da-vault-copia-verso-dalink.ts"), ...args], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DA_INVENT_DATA_DIR: TEST_DATA_DIR,
          DA_VAULT_OPENBAO_URL: urlOb,
          DA_VAULT_OPENBAO_ROLE_ID: ob.roleId,
          DA_VAULT_OPENBAO_SECRET_ID_FILE: fileSid,
          CREDENTIALS_DIRECTORY: "",
          DALINK_VAULT_URL: dl.url,
          DALINK_VAULT_GETTONE: dl.gettone,
          DALINK_VAULT_IMPRONTA: dl.impronta,
          // gli interruttori dell'app non contano: qui sono entrambi accesi, cosa che l'app rifiuterebbe
          DA_VAULT_OPENBAO: "1",
          DA_VAULT_DALINK: "1",
          ...env,
        },
      });
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (d: Buffer) => { stdout += d.toString("utf8"); });
      p.stderr.on("data", (d: Buffer) => { stderr += d.toString("utf8"); });
      p.on("close", (status) => ok({ status, stdout, stderr }));
    });
  }

  function nessunSegreto(r: { stdout: string; stderr: string }): void {
    const tutto = r.stdout + r.stderr;
    for (const v of [...VALORI, "colonna-non-letta", dl.gettone, ob.secretId, GETTONE_OPENBAO_SID, "hvs.", MARCA_CORPO]) {
      assert.ok(!tutto.includes(v), `l'uscita contiene «${v}»`);
    }
  }

  it("senza la configurazione di DA-Link: esce dicendo quale variabile manca, senza il gettone", async () => {
    const r = await cli([], { DALINK_VAULT_IMPRONTA: "" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DALINK_VAULT_IMPRONTA/);
    nessunSegreto(r);
    assert.deepEqual(dl.richieste, []);
  });

  it("senza la configurazione di OpenBao: esce dicendo cosa manca", async () => {
    const r = await cli([], { DA_VAULT_OPENBAO_URL: "" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DA_VAULT_OPENBAO_URL/);
  });

  it("opzioni sbagliate: --sostituisci da solo, o --verifica con --applica", async () => {
    for (const a of [["--sostituisci"], ["--verifica", "--applica"], ["--boh"]]) {
      const r = await cli(a);
      assert.equal(r.status, 1, a.join(" "));
      assert.match(r.stderr, /Uso:/);
    }
  });

  it("di serie è a vuoto: lo dice, elenca i percorsi con la classificazione, non scrive, esce 0", async () => {
    const r = await cli([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /prova a vuoto/i);
    assert.match(r.stdout, /app\/da-ipam\/a: copierei/);
    assert.match(r.stdout, /clienti\/c70003\/da-ipam\/firewall-1: copierei/);
    assert.equal(dl.voci.size, 0);
    assert.deepEqual(dl.richieste.filter((x) => x.metodo !== "GET"), []);
    nessunSegreto(r);
  });

  it("--applica copia, --verifica poi dice uguale per tutte; l'uscita non ha valori", async () => {
    const r = await cli(["--applica"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(dl.voci.get("app/da-ipam/a")?.valori.password, PW_A);
    assert.equal(dl.voci.get("clienti/c70003/da-ipam/firewall-1")?.valori.password, PW_X);
    nessunSegreto(r);
    const v = await cli(["--verifica"]);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /app\/da-ipam\/a: uguale/);
    assert.ok(!/copierei|diversa/.test(v.stdout));
    nessunSegreto(v);
  });

  it("--verifica con una voce che manca in DA-Link: esce 2 e dice quale", async () => {
    dl.scriviDaFuori("app/da-ipam/a", { username: "utente-segreto-9926", password: PW_A });
    const r = await cli(["--verifica"]);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /clienti\/c70003\/da-ipam\/firewall-1: copierei/);
    assert.equal(dl.voci.size, 1, "--verifica non scrive");
    nessunSegreto(r);
  });

  it("voce diversa: a vuoto e --applica la segnalano (exit 2) e non la toccano; --sostituisci la sostituisce", async () => {
    dl.scriviDaFuori("app/da-ipam/a", { password: PW_B_DL });
    const a = await cli([]);
    assert.equal(a.status, 2);
    assert.match(a.stdout, /app\/da-ipam\/a: diversa \(serve --sostituisci\)/);
    nessunSegreto(a);
    const b = await cli(["--applica"]);
    assert.equal(b.status, 2);
    assert.equal(dl.voci.get("app/da-ipam/a")?.valori.password, PW_B_DL);
    assert.equal(dl.voci.get("clienti/c70003/da-ipam/firewall-1")?.valori.password, PW_X, "il copierei è stato scritto comunque");
    nessunSegreto(b);
    const c = await cli(["--applica", "--sostituisci"]);
    assert.equal(c.status, 0, c.stderr);
    assert.equal(dl.voci.get("app/da-ipam/a")?.valori.password, PW_A);
    nessunSegreto(c);
  });

  it("una voce che DA-Link non può tenere: a vuoto exit 2 con «non copiabile», --applica non la scrive", async () => {
    ob.kv.set("app/da-ipam/storta", { OTP: "valore-storto-3318", password: "valore-storto-3318" });
    const a = await cli([]);
    assert.equal(a.status, 2);
    assert.match(a.stdout, /app\/da-ipam\/storta: non copiabile/);
    assert.match(a.stdout, /1 non copiabili/);
    assert.ok(!(a.stdout + a.stderr).includes("valore-storto-3318"));
    const b = await cli(["--applica"]);
    assert.equal(b.status, 2);
    assert.ok(!dl.voci.has("app/da-ipam/storta"));
    assert.ok(dl.voci.has("app/da-ipam/a"), "le altre sono state copiate");
    assert.ok(!(b.stdout + b.stderr).includes("valore-storto-3318"));
  });

  it("OpenBao spento: exit 2 con il motivo, DA-Link non riceve scritture", async () => {
    ob.giu = true;
    try {
      const r = await cli(["--applica"]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /OpenBao/);
      assert.deepEqual(dl.richieste.filter((x) => x.metodo !== "GET"), []);
      nessunSegreto(r);
    } finally {
      ob.giu = false;
    }
  });

  it("un cliente i cui riferimenti non si leggono ferma tutto: l'elenco incompleto non vale una verifica verde", async () => {
    createTenant({ codice_cliente: "C70004", ragione_sociale: "Cliente rotto", active: 1 } as Parameters<typeof createTenant>[0]);
    mkdirSync(cartellaTenant(), { recursive: true });
    writeFileSync(join(cartellaTenant(), "C70004.db"), "questo non è un database sqlite, ma abbastanza lungo da non sembrare vuoto".repeat(20));
    closeHubDb();
    try {
      const r = await cli(["--verifica"]);
      assert.equal(r.status, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /C70004/);
      assert.match(r.stderr, /incompleto/);
      assert.deepEqual(dl.richieste, [], "prima di chiedere qualcosa a DA-Link");
      nessunSegreto(r);
    } finally {
      getHubDb().prepare("UPDATE tenants SET active = 0 WHERE codice_cliente = ?").run("C70004");
      closeHubDb();
    }
  });

  it("gettone di DA-Link rifiutato: errore chiaro di DA-Link, né gettone né corpo a schermo", async () => {
    const r = await cli(["--applica"], { DALINK_VAULT_GETTONE: "dlv_" + "z".repeat(43) });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DA-Link/);
    assert.match(r.stderr, /gettone/i);
    assert.ok(!r.stdout.includes("z".repeat(43)) && !r.stderr.includes("z".repeat(43)));
    nessunSegreto(r);
    assert.equal(dl.voci.size, 0);
  });
});
