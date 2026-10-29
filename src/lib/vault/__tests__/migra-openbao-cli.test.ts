/**
 * da-vault, passo 6: `scripts/da-vault-migra-openbao.ts` sull'hub, contro un OpenBao finto servito in HTTP locale.
 * A vuoto di default (niente in OpenBao, niente nel database), `--applica` scrive e mette i riferimenti, `--verifica`
 * confronta; senza configurazione esce con l'errore che dice cosa manca. Mai valori a schermo.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/migra-openbao-cli.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { servaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const T = "C70002";
const PW = "pw-cli-migra-77";
let finto: OpenBaoFinto;
let url: string;
let chiudi: () => Promise<void>;
let fileSid: string;

before(async () => {
  ({ finto, url, chiudi } = await servaOpenBaoFinto({ ora: Date.now }));
  fileSid = join(mkdtempSync(join(tmpdir(), "da-vault-sid-")), "secret-id");
  writeFileSync(fileSid, `${finto.secretId}\n`, { mode: 0o600 });
  createTenant({ codice_cliente: T, ragione_sociale: "Cliente CLI", active: 1 } as Parameters<typeof createTenant>[0]);
  withTenant(T, () => {
    creaCredenzialeDb(getTenantDb(T), { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(PW) });
  });
  closeTenantDb(T);
  closeHubDb();
});

after(async () => {
  await chiudi();
});

/** spawn asincrono: il server del finto gira in questo processo e deve poter rispondere. */
function cli(args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "da-vault-migra-openbao.ts"), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DA_INVENT_DATA_DIR: TEST_DATA_DIR,
        DA_VAULT_OPENBAO_URL: url,
        DA_VAULT_OPENBAO_ROLE_ID: finto.roleId,
        DA_VAULT_OPENBAO_SECRET_ID_FILE: fileSid,
        CREDENTIALS_DIRECTORY: "",
        // Il backend è quello acceso (condizioni del passo 7, 29/10): a interruttori spenti la migrazione si rifiuta
        // (prova in `migra-openbao-dalink.test.ts`). Qui OpenBao acceso: comportamento e uscita di prima.
        DA_VAULT_OPENBAO: "1",
        DA_VAULT_DALINK: "",
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

function riferimento(): string | null {
  const r = getTenantDb(T).prepare("SELECT credential_ref FROM credentials").get() as { credential_ref: string | null };
  closeTenantDb(T);
  return r.credential_ref;
}

describe("scripts/da-vault-migra-openbao.ts", () => {
  it("senza configurazione: esce con l'errore che dice cosa manca", async () => {
    const r = await cli([], { DA_VAULT_OPENBAO_URL: "" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DA_VAULT_OPENBAO_URL/);
  });

  it("di serie è a vuoto: lo dice, e niente cambia", async () => {
    const r = await cli([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /prova a vuoto/i);
    assert.match(r.stdout, new RegExp(`${T}: 1 da migrare`));
    assert.equal(finto.kv.size, 0);
    assert.equal(riferimento(), null);
    assert.ok(!r.stdout.includes(PW));
  });

  it("--applica scrive in OpenBao e mette il riferimento; --verifica non trova differenze", async () => {
    const r = await cli(["--applica"]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(finto.kv.size, 1);
    assert.match(riferimento() ?? "", /^clienti\/c70002\/da-ipam\/firewall-\d+$/);
    assert.ok(!r.stdout.includes(PW) && !r.stderr.includes(PW));
    const v = await cli(["--verifica"]);
    assert.equal(v.status, 0, v.stderr);
    assert.match(v.stdout, /1 controllate, 0 diverse/);
  });
});
