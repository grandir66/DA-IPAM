/**
 * da-vault, ADR 0035: `scripts/da-vault-svuota-colonne.ts` sull'hub, contro un OpenBao finto servito in HTTP locale.
 * A vuoto di default; `--applica` fa il backup e svuota; `--verifica` dice se restano segreti nelle colonne; con un
 * ostacolo esce 2 e non tocca niente; senza configurazione dice cosa manca. Mai valori a schermo.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/svuota-colonne-cli.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { servaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const T = "C70043";
const PW = "pw-cli-svuota-88";
let finto: OpenBaoFinto;
let url: string;
let chiudi: () => Promise<void>;
let fileSid: string;

before(async () => {
  ({ finto, url, chiudi } = await servaOpenBaoFinto({ ora: Date.now }));
  fileSid = join(mkdtempSync(join(tmpdir(), "da-vault-sid-")), "secret-id");
  writeFileSync(fileSid, `${finto.secretId}\n`, { mode: 0o600 });
  createTenant({ codice_cliente: T, ragione_sociale: "Cliente CLI svuota", active: 1 } as Parameters<typeof createTenant>[0]);
  withTenant(T, () => {
    creaCredenzialeDb(getTenantDb(T), { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(PW) });
  });
  closeTenantDb(T);
  closeHubDb();
});

after(async () => {
  await chiudi();
});

function cli(script: string, args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", script), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DA_INVENT_DATA_DIR: TEST_DATA_DIR,
        DA_VAULT_OPENBAO_URL: url,
        DA_VAULT_OPENBAO_ROLE_ID: finto.roleId,
        DA_VAULT_OPENBAO_SECRET_ID_FILE: fileSid,
        CREDENTIALS_DIRECTORY: "",
        DA_VAULT_OPENBAO: "",
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
const svuota = (args: string[], env?: Record<string, string>) => cli("da-vault-svuota-colonne.ts", args, env);
const migra = (args: string[]) => cli("da-vault-migra-openbao.ts", args);

/** Quante righe hanno ancora colonne piene (apre e richiude il database: il CLI gira in un altro processo). */
function colonnePiene(): number {
  const n = (getTenantDb(T).prepare("SELECT COUNT(*) AS n FROM credentials WHERE COALESCE(encrypted_username, '') != '' OR COALESCE(encrypted_password, '') != ''").get() as { n: number }).n;
  closeTenantDb(T);
  return n;
}

describe("scripts/da-vault-svuota-colonne.ts", () => {
  it("senza configurazione: esce con l'errore che dice cosa manca", async () => {
    const r = await svuota([], { DA_VAULT_OPENBAO_URL: "" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DA_VAULT_OPENBAO_URL/);
  });

  it("un argomento sconosciuto, o --applica insieme a --verifica: uso", async () => {
    assert.match((await svuota(["--forse"])).stderr, /Uso:/);
    assert.match((await svuota(["--applica", "--verifica"])).stderr, /Uso:/);
  });

  it("con una riga non ancora migrata: esce 2, dice quale e non tocca niente (a vuoto e con --applica)", async () => {
    for (const args of [[], ["--applica"]]) {
      const r = await svuota(args);
      assert.equal(r.status, 2, r.stderr);
      assert.match(r.stdout, /SENZA RIFERIMENTO #\d+ «Firewall»/);
      assert.ok(!r.stdout.includes(PW) && !r.stderr.includes(PW));
      assert.equal(colonnePiene(), 1);
    }
  });

  it("dopo la migrazione: di serie è a vuoto e non cambia niente", async () => {
    assert.equal((await migra(["--applica"])).status, 0);
    const r = await svuota([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /A vuoto: niente è stato scritto/);
    assert.match(r.stdout, new RegExp(`${T}: 1 credenziali, 0 già vuote, 1 con colonne piene, 1 da svuotare`));
    assert.equal(colonnePiene(), 1);
    assert.equal(existsSync(join(TEST_DATA_DIR, "backups")), false);
  });

  it("--verifica prima dello svuotamento: esce 2 e dice che i segreti sono ancora nelle colonne", async () => {
    const r = await svuota(["--verifica"]);
    assert.equal(r.status, 2);
    assert.match(r.stdout, /RIMASTA #\d+ «Firewall»/);
    assert.match(r.stderr, /Verifica NON superata/);
  });

  it("una differenza con OpenBao: esce 2 e non tocca niente", async () => {
    const [percorso, valore] = [...finto.kv.entries()][0];
    finto.kv.set(percorso, { ...valore, password: "cambiata-in-openbao" });
    const r = await svuota(["--applica"]);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stdout, /DIVERSA #\d+ «Firewall».*valori diversi/);
    assert.ok(!r.stdout.includes("cambiata-in-openbao") && !r.stdout.includes(PW));
    assert.equal(colonnePiene(), 1);
    finto.kv.set(percorso, valore);
  });

  it("--applica: backup, colonne vuote, nessun valore a schermo; poi --verifica va bene", async () => {
    const r = await svuota(["--applica"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Svuotamento APPLICATO/);
    assert.match(r.stdout, /1 svuotate, VACUUM fatto/);
    assert.match(r.stdout, /backup: .*backups\/C70043\.db\.bak-/);
    assert.ok(readdirSync(join(TEST_DATA_DIR, "backups")).some((f) => f.startsWith(`${T}.db.bak-`)));
    assert.ok(!r.stdout.includes(PW) && !r.stderr.includes(PW));
    assert.equal(colonnePiene(), 0);
    const v = await svuota(["--verifica"]);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /1 credenziali, 0 con segreti ancora nelle colonne, 1 con il segreto in OpenBao/);
    assert.match(v.stdout, /Verifica superata: 0 segreti rimasti/);
  });

  it("ripetuto dopo lo svuotamento: va bene e non fa niente", async () => {
    const r = await svuota(["--applica"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 già vuote, 0 con colonne piene, 0 provate uguali/);
  });
});
