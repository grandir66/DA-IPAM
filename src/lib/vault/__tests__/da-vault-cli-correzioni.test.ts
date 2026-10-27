/**
 * Correzioni della revisione del 23/10 alla riga di comando `scripts/da-vault.ts` e a `scripts/da-vault-recover.ts`:
 *
 * 3.  La cartella dati usata si stampa, e una cartella senza `hub.db` è un errore (exit != 0), per `crea` come per
 *     `ricifra`: una `DA_INVENT_DATA_DIR` mancante non deve produrre «archivio creato / 0 valori ricifrati, tutto bene»
 *     su una cartella sbagliata.
 * 12. `crea --senza-domarc --richiesta-cliente <rif>`: il riferimento va nell'archivio e in `recuperi.jsonl`; il registro
 *     si scrive PRIMA dell'operazione (intento) e poi l'esito (anche per i recuperi, che prima lasciavano la riga solo a
 *     cose fatte: un tentativo fallito non lasciava traccia).
 * 10. (CLI) una passphrase nuova con spazi ai bordi è rifiutata dal recupero come da `crea`.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/da-vault-cli-correzioni.test.ts
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { apriConPassphrase } from "../archivio";

const PASS = "passphrase-cliente-cli-0123";
let destinatario: string;
let identita: string;

function dati(conHub: boolean): string {
  const d = mkdtempSync(join(tmpdir(), "da-vault-cli-corr-"));
  if (conHub) {
    const db = new Database(join(d, "hub.db"));
    db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
    db.close();
  }
  return d;
}

const cli = (script: string, args: string[], stdin: string, cartellaDati: string, env: Record<string, string> = {}) =>
  spawnSync(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", script), ...args], {
    input: stdin,
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, DA_INVENT_DATA_DIR: cartellaDati, ENCRYPTION_KEY: "chiave-installazione-cli", DA_VAULT_LOCALE: "", CREDENTIALS_DIRECTORY: "", DA_VAULT_DIR: "", ...env },
  });

const righeRegistro = (cartellaDati: string) =>
  readFileSync(join(cartellaDati, "vault", "recuperi.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l) as Record<string, unknown>);

before(async () => {
  identita = await generateX25519Identity();
  destinatario = await identityToRecipient(identita);
});

describe("rilievo 3: cartella dati sbagliata", () => {
  it("crea in una cartella senza hub.db: errore, dice la cartella, non crea niente", () => {
    const d = dati(false);
    const r = cli("da-vault.ts", ["crea"], `${PASS}\n`, d, { DA_VAULT_CHIAVE_DOMARC: destinatario });
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.includes(d), r.stderr);
    assert.match(r.stderr, /hub\.db/);
    assert.equal(existsSync(join(d, "vault", "archivio.json")), false);
  });

  it("crea in una cartella giusta stampa la cartella dati usata", () => {
    const d = dati(true);
    const r = cli("da-vault.ts", ["crea"], `${PASS}\n`, d, { DA_VAULT_CHIAVE_DOMARC: destinatario });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`Cartella dati: ${d}`), r.stdout);
  });

  it("ricifra in una cartella senza hub.db: errore con la cartella; a vuoto come con --applica", () => {
    const giusta = dati(true);
    assert.equal(cli("da-vault.ts", ["crea"], `${PASS}\n`, giusta, { DA_VAULT_CHIAVE_DOMARC: destinatario }).status, 0);
    // Stesso archivio ma la variabile punta a una cartella vuota (l'errore tipico): l'archivio sta in DA_VAULT_DIR.
    const vuota = dati(false);
    for (const args of [["ricifra"], ["ricifra", "--applica"]]) {
      const r = cli("da-vault.ts", args, `${PASS}\n`, vuota, { DA_VAULT_LOCALE: "1", DA_VAULT_DIR: join(giusta, "vault") });
      assert.notEqual(r.status, 0, `${args.join(" ")}: ${r.stdout}`);
      assert.ok(r.stderr.includes(vuota), r.stderr);
      assert.match(r.stderr, /hub\.db/);
    }
  });

  it("stato e ricifra stampano la cartella dati", () => {
    const d = dati(true);
    cli("da-vault.ts", ["crea"], `${PASS}\n`, d, { DA_VAULT_CHIAVE_DOMARC: destinatario });
    assert.ok(cli("da-vault.ts", ["stato"], "", d).stdout.includes(`Cartella dati: ${d}`));
    const r = cli("da-vault.ts", ["ricifra"], `${PASS}\n`, d, { DA_VAULT_LOCALE: "1" });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(`Cartella dati: ${d}`));
  });
});

describe("rilievo 12: richiesta del cliente e registro prima/dopo", () => {
  it("crea --senza-domarc senza --richiesta-cliente: rifiutato", () => {
    const d = dati(true);
    const r = cli("da-vault.ts", ["crea", "--senza-domarc"], `${PASS}\n`, d);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /richiesta/i);
    assert.equal(existsSync(join(d, "vault", "archivio.json")), false);
  });

  it("crea --senza-domarc --richiesta-cliente: il riferimento è nell'archivio e in recuperi.jsonl (intento, poi esito)", () => {
    const d = dati(true);
    const r = cli("da-vault.ts", ["crea", "--senza-domarc", "--richiesta-cliente", "RIC-2026-9"], `${PASS}\n`, d);
    assert.equal(r.status, 0, r.stderr);
    const a = JSON.parse(readFileSync(join(d, "vault", "archivio.json"), "utf8")) as { domarcEscluso?: { richiesta: string } };
    assert.equal(a.domarcEscluso?.richiesta, "RIC-2026-9");
    const righe = righeRegistro(d);
    assert.deepEqual(righe.map((x) => [x.ticket, x.comando, x.stato]), [
      ["RIC-2026-9", "crea --senza-domarc", "intento"],
      ["RIC-2026-9", "crea --senza-domarc", "ok"],
    ]);
    assert.ok(!JSON.stringify(righe).includes(PASS));
    assert.match(cli("da-vault.ts", ["stato"], "", d).stdout, /RIC-2026-9/);
  });

  it("un crea che fallisce lascia l'intento e l'esito «fallito» (passphrase troppo corta)", () => {
    const d = dati(true);
    const r = cli("da-vault.ts", ["crea", "--senza-domarc", "--richiesta-cliente", "RIC-2026-10"], "corta\n", d);
    assert.notEqual(r.status, 0);
    const righe = righeRegistro(d);
    assert.deepEqual(righe.map((x) => x.stato), ["intento", "fallito"]);
    assert.equal(existsSync(join(d, "vault", "archivio.json")), false);
  });

  it("un crea con lo slot Domarc non scrive nel registro dei recuperi", () => {
    const d = dati(true);
    assert.equal(cli("da-vault.ts", ["crea"], `${PASS}\n`, d, { DA_VAULT_CHIAVE_DOMARC: destinatario }).status, 0);
    assert.equal(existsSync(join(d, "vault", "recuperi.jsonl")), false);
  });
});

describe("recupero: intento prima, esito dopo (rilievi 12 e 10)", () => {
  async function conArchivio(): Promise<string> {
    const d = dati(true);
    assert.equal(cli("da-vault.ts", ["crea"], `${PASS}\n`, d, { DA_VAULT_CHIAVE_DOMARC: destinatario }).status, 0);
    return d;
  }
  const recover = (d: string, args: string[], stdin: string) => cli("da-vault-recover.ts", [args[0], "--archivio", join(d, "vault"), ...args.slice(1)], stdin, d);

  it("reset-password riuscito: due righe, intento e ok", async () => {
    const d = await conArchivio();
    const r = recover(d, ["reset-password", "--ticket", "TCK-1"], `${identita}\nnuova-passphrase-da-cli\n`);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(righeRegistro(d).map((x) => [x.ticket, x.comando, x.stato]), [
      ["TCK-1", "reset-password", "intento"],
      ["TCK-1", "reset-password", "ok"],
    ]);
  });

  it("con la chiave sbagliata il tentativo lascia comunque la traccia: intento e fallito", async () => {
    const d = await conArchivio();
    const altra = await generateX25519Identity();
    const r = recover(d, ["reset-password", "--ticket", "TCK-2"], `${altra}\nnuova-passphrase-da-cli\n`);
    assert.notEqual(r.status, 0);
    const righe = righeRegistro(d);
    assert.deepEqual(righe.map((x) => x.stato), ["intento", "fallito"]);
    assert.ok(!JSON.stringify(righe).includes(altra), "la chiave nel registro");
  });

  it("una passphrase nuova con spazio finale è rifiutata (come da crea) e lo slot non cambia", async () => {
    const d = await conArchivio();
    const r = recover(d, ["reset-password", "--ticket", "TCK-3"], `${identita}\nnuova-passphrase-da-cli \n`);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /spazi/);
    assert.ok((await apriConPassphrase(join(d, "vault"), PASS)).length === 32, "la passphrase vecchia deve aprire ancora");
    assert.deepEqual(righeRegistro(d).map((x) => x.stato), ["intento", "fallito"]);
  });
});
