/**
 * Correzioni della revisione del 23/10, rilievo 9: dopo una ricifra applicata, i backup fatti PRIMA hanno ancora i
 * valori sulla chiave d'installazione. Si elencano (`.bak-` accanto ai database e backup notturni `.gz`), si propone
 * la purga e si cancella solo su richiesta esplicita. I backup fatti DOPO (che hanno solo i segreti TOTP sulla chiave
 * vecchia, per scelta) non sono «con la chiave vecchia».
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/ricifra-backup.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import Database from "better-sqlite3";
import { chiaveInstallazione } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb } from "@/lib/db-tenant";
import { elencaBackupConChiave, purgaBackup } from "../backup-vecchi";
import { ricifra } from "../ricifra";
import { chiudiVault, impostaChiaveDati } from "../stato";
import { popola, SEGRETI_PROVA, type DatiProva } from "./support/dati-ricifra";

const T = "RICIFRABAK";
const RADICE = mkdtempSync(join(tmpdir(), "da-vault-radice-backup-"));
let K: Buffer;
let dati: DatiProva;

const hubDb = () => join(TEST_DATA_DIR, "hub.db");
const tenantDb = () => join(TEST_DATA_DIR, "tenants", `${T}.db`);

function copia(da: string, a: string): void {
  const db = new Database(da, { readonly: true });
  try {
    db.exec(`VACUUM INTO '${a.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
}

async function copiaGz(da: string, a: string): Promise<void> {
  mkdirSync(join(a, ".."), { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "da-vault-gz-"));
  const plain = join(tmp, "x.db");
  copia(da, plain);
  await pipeline(createReadStream(plain), createGzip(), createWriteStream(a));
}

const bak = (file: string, stamp: string) => `${file}.bak-${stamp}`;
const PRIMA_BAK_TENANT = () => bak(tenantDb(), "20261020-101010");
const PRIMA_BAK_HUB = () => bak(hubDb(), "20261020-101010");
const PRIMA_GZ_HUB = () => join(RADICE, "2026-10-22", "hub.db.gz");
const PRIMA_GZ_TENANT = () => join(RADICE, "2026-10-22", "tenants", `${T}.db.gz`);
const DOPO_GZ_HUB = () => join(RADICE, "2026-10-25", "hub.db.gz");
const DOPO_BAK_TENANT = () => bak(tenantDb(), "20261025-020202");

before(async () => {
  delete process.env.DA_VAULT_LOCALE;
  dati = popola(T);
  K = randomBytes(32);
  // Backup fatti PRIMA della ricifra: hanno i valori con la chiave d'installazione.
  copia(tenantDb(), PRIMA_BAK_TENANT());
  copia(hubDb(), PRIMA_BAK_HUB());
  await copiaGz(hubDb(), PRIMA_GZ_HUB());
  await copiaGz(tenantDb(), PRIMA_GZ_TENANT());
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(K, "passphrase");
  closeTenantDb(T);
  closeHubDb();
  ricifra({ dataDir: TEST_DATA_DIR, chiaveNuova: K, applica: true });
  closeTenantDb(T);
  closeHubDb();
  // Backup fatti DOPO: i valori sono della chiave degli slot; resta sulla vecchia solo il TOTP.
  copia(tenantDb(), DOPO_BAK_TENANT());
  await copiaGz(hubDb(), DOPO_GZ_HUB());
  // Un file che non è un database: non si può controllare, e si dice.
  writeFileSync(bak(join(TEST_DATA_DIR, "tenants", "ROTTO.db"), "20261001-000000"), "non sono un database");
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  chiudiVault(null);
  closeTenantDb(T);
  closeHubDb();
});

describe("backup con la chiave vecchia dopo la ricifra", () => {
  it("elenca i backup di prima (.bak e notturni), non quelli di dopo, e dice quelli che non si possono controllare", async () => {
    const r = await elencaBackupConChiave({ dataDir: TEST_DATA_DIR, radiceBackup: RADICE, chiave: chiaveInstallazione() });
    assert.deepEqual(
      r.conChiaveVecchia.map((b) => b.percorso).sort(),
      [PRIMA_BAK_HUB(), PRIMA_BAK_TENANT(), PRIMA_GZ_HUB(), PRIMA_GZ_TENANT()].sort(),
    );
    assert.ok(r.conChiaveVecchia.every((b) => b.valori > 0 && b.byte > 0));
    assert.deepEqual(r.conChiaveVecchia.map((b) => b.tipo).sort(), ["bak", "bak", "notturno", "notturno"]);
    assert.equal(r.controllati, 6, "4 di prima + 2 di dopo");
    assert.equal(r.nonVerificabili.length, 1);
    assert.match(r.nonVerificabili[0].percorso, /ROTTO\.db\.bak-/);
  });

  it("il rapporto non contiene valori, né in chiaro né cifrati", async () => {
    const r = await elencaBackupConChiave({ dataDir: TEST_DATA_DIR, radiceBackup: RADICE, chiave: chiaveInstallazione() });
    const testo = JSON.stringify(r);
    for (const s of [SEGRETI_PROVA.ssh, SEGRETI_PROVA.community, SEGRETI_PROVA.sistema, dati.cancellato]) assert.ok(!testo.includes(s));
    assert.doesNotMatch(testo, /[0-9a-f]{32}:[0-9a-f]{32}:/);
  });

  it("la purga cancella solo quelli dell'elenco: i backup di dopo e i database vivi restano", async () => {
    const r = await elencaBackupConChiave({ dataDir: TEST_DATA_DIR, radiceBackup: RADICE, chiave: chiaveInstallazione() });
    const e = purgaBackup(r.conChiaveVecchia);
    assert.equal(e.cancellati.length, 4);
    assert.deepEqual(e.errori, []);
    for (const p of [PRIMA_BAK_HUB(), PRIMA_BAK_TENANT(), PRIMA_GZ_HUB(), PRIMA_GZ_TENANT()]) assert.equal(existsSync(p), false, p);
    for (const p of [DOPO_BAK_TENANT(), DOPO_GZ_HUB(), hubDb(), tenantDb()]) assert.equal(existsSync(p), true, p);
    const dopo = await elencaBackupConChiave({ dataDir: TEST_DATA_DIR, radiceBackup: RADICE, chiave: chiaveInstallazione() });
    assert.deepEqual(dopo.conChiaveVecchia, []);
  });
});
