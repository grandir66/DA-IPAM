/**
 * da-vault, svuotamento delle colonne cifrate delle credenziali dell'hub (ADR 0035).
 *
 * - a vuoto di serie: confronta e riferisce, non scrive niente (né database né backup);
 * - `applica`: solo le righe con riferimento il cui segreto in OpenBao è UGUALE alla colonna decifrata; una sola
 *   differenza, un segreto mancante, una riga senza riferimento con le colonne piene, una colonna illeggibile o OpenBao
 *   giù = niente toccato, in nessun cliente (tutto o niente);
 * - prima di scrivere: copia del database in `<dati>/backups` controllata con `quick_check`; poi una transazione col
 *   ricontrollo, poi `VACUUM`: i valori cifrati non restano nemmeno nelle pagine libere del file;
 * - ripetibile; dopo, `verificaSvuotamento` dice 0 segreti rimasti e il lettore unico dà le stesse letture di prima;
 * - il rapporto non contiene mai un valore.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/svuota-colonne.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { campiVoceDb, COLONNE_SEGRETE, coppiaSshDb, communityDb } from "@/lib/credentials/segreti";
import { migraVersoOpenBao } from "../migra-openbao";
import { OpenBaoStore } from "../openbao";
import { statoVaultProcesso } from "../stato";
import { svuotaColonne, verificaSvuotamento } from "../svuota-colonne";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const A = "C70041";
const B = "C70042";
const SEGRETI = ["pw-svuota-ssh-11", "comm-svuota-22", "auth-svuota-33", "priv-svuota-44", "pw-altro-55"];
let finto: OpenBaoFinto;
let store: OpenBaoStore;
let backups: string;
const ids: Record<string, number> = {};
let cifrati: string[] = [];

const tenants = () => [
  { codice: A, dbh: getTenantDb(A) },
  { codice: B, dbh: getTenantDb(B) },
];
const colonnePiene = (dbh: Database.Database): number =>
  (dbh.prepare(`SELECT COUNT(*) AS n FROM credentials WHERE ${COLONNE_SEGRETE.map((c) => `COALESCE(${c}, '') != ''`).join(" OR ")}`).get() as { n: number }).n;
const rapporto = (x: unknown) => JSON.stringify(x);

async function ricrea(): Promise<void> {
  // Ogni prova parte da due clienti con le colonne piene e la migrazione fatta (riferimenti e segreti in OpenBao).
  for (const t of [A, B]) {
    withTenant(t, () => getTenantDb(t).prepare("DELETE FROM credentials").run());
  }
  finto = creaOpenBaoFinto({ ora: Date.now });
  store = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], fetch: finto.fetch, fetchSync: finto.fetchSync });
  withTenant(A, () => {
    const d = getTenantDb(A);
    ids.ssh = creaCredenzialeDb(d, { name: "Firewall Sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(SEGRETI[0]), port: 22 }).id;
    ids.snmp = creaCredenzialeDb(d, { name: "Switch v2c", credential_type: "snmp", encrypted_password: encrypt(SEGRETI[1]) }).id;
    ids.v3 = creaCredenzialeDb(d, {
      name: "Switch v3", credential_type: "snmp_v3", encrypted_username: encrypt("mon"), security_level: "authPriv",
      auth_protocol: "SHA", encrypted_auth_key: encrypt(SEGRETI[2]), priv_protocol: "AES", encrypted_priv_key: encrypt(SEGRETI[3]),
    }).id;
  });
  withTenant(B, () => {
    ids.altro = creaCredenzialeDb(getTenantDb(B), { name: "Router B", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt(SEGRETI[4]) }).id;
  });
  const m = await migraVersoOpenBao({ store, tenants: tenants(), applica: true });
  assert.ok(m.perTenant.every((e) => e.errore === null));
  cifrati = [];
  for (const t of tenants()) {
    for (const r of t.dbh.prepare("SELECT * FROM credentials").all() as Array<Record<string, unknown>>) {
      for (const c of COLONNE_SEGRETE) if (typeof r[c] === "string" && r[c]) cifrati.push(r[c] as string);
    }
  }
  assert.equal(cifrati.length, 8);
}

beforeEach(async () => {
  backups = join(mkdtempSync(join(tmpdir(), "da-svuota-")), "backups");
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
  await ricrea();
});

after(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
  for (const t of [A, B]) {
    try { closeTenantDb(t); deleteTenantDatabase(t); } catch { /* già tolto */ }
  }
  closeHubDb();
});

describe("a vuoto (di serie)", () => {
  it("riferisce cosa farebbe e non scrive niente: né database, né backup, né OpenBao", async () => {
    const richiestePrima = finto.richieste.length;
    const scrittePrima = finto.richieste.filter((r) => r.metodo === "POST" && r.percorso.includes("/data/")).length;
    const e = await svuotaColonne({ store, tenants: tenants(), cartellaBackup: backups });
    assert.equal(e.applicata, false);
    assert.equal(e.ok, true);
    assert.deepEqual(e.perTenant.map((t) => [t.codice, t.righe, t.conColonnePiene, t.daSvuotare, t.svuotate]), [[A, 3, 3, 3, 0], [B, 1, 1, 1, 0]]);
    assert.equal(colonnePiene(getTenantDb(A)), 3);
    assert.equal(colonnePiene(getTenantDb(B)), 1);
    assert.equal(existsSync(backups), false, "nessun backup a vuoto");
    assert.equal(finto.richieste.filter((r) => r.metodo === "POST" && r.percorso.includes("/data/")).length, scrittePrima, "nessuna scrittura in OpenBao");
    assert.ok(finto.richieste.length > richiestePrima, "ha letto OpenBao");
    const testo = rapporto(e);
    for (const s of [...SEGRETI, ...cifrati]) assert.ok(!testo.includes(s), "il rapporto non contiene valori");
  });
});

describe("applica", () => {
  it("backup controllato, colonne a NULL, VACUUM: i valori cifrati non restano nemmeno nel file; il lettore dà le stesse letture", async () => {
    const prima = {
      ssh: withTenant(A, () => campiVoceDb(getTenantDb(A), ids.ssh, { ignoraRiferimento: true })),
      v3: withTenant(A, () => campiVoceDb(getTenantDb(A), ids.v3, { ignoraRiferimento: true })),
    };
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.applicata, true);
    assert.equal(e.ok, true, rapporto(e.perTenant.map((t) => t.errore)));
    assert.deepEqual(e.perTenant.map((t) => [t.svuotate, t.vacuum]), [[3, true], [1, true]]);

    // le colonne sono vuote, i riferimenti no
    assert.equal(colonnePiene(getTenantDb(A)), 0);
    assert.equal(colonnePiene(getTenantDb(B)), 0);
    const refs = getTenantDb(A).prepare("SELECT credential_ref FROM credentials").all() as Array<{ credential_ref: string | null }>;
    assert.ok(refs.every((r) => r.credential_ref?.startsWith("clienti/c70041/da-ipam/")));

    // il backup c'è, si apre, ha le colonne piene (è il punto di ritorno) e il controllo dice ok
    const copie = readdirSync(backups).filter((f) => !/-(wal|shm)$/.test(f));
    assert.equal(copie.length, 2);
    const copiaA = new Database(join(backups, copie.find((f) => f.startsWith(`${A}.db.bak-`)) as string), { readonly: true });
    assert.equal(copiaA.pragma("quick_check", { simple: true }), "ok");
    assert.equal(colonnePiene(copiaA), 3);
    copiaA.close();

    // Il VACUUM: nessun valore cifrato nel file del database (né nel WAL). Guasto provato: senza VACUUM i valori
    // restano nelle pagine libere e questa ricerca li trova.
    for (const t of [A, B]) {
      const file = getTenantDb(t).name;
      for (const f of [file, `${file}-wal`]) {
        if (!existsSync(f)) continue;
        const bytes = readFileSync(f).toString("latin1");
        for (const c of cifrati) assert.ok(!bytes.includes(c), `un valore cifrato è rimasto in ${f}`);
      }
    }
    assert.equal(getTenantDb(A).pragma("quick_check", { simple: true }), "ok");

    // il lettore unico, con OpenBao acceso, dà le letture di prima
    store = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], percorsiExtra: () => [...finto.kv.keys()], fetch: finto.fetch });
    await store.aggiorna();
    statoVaultProcesso().openbao = store;
    process.env.DA_VAULT_OPENBAO = "1";
    assert.deepEqual(withTenant(A, () => campiVoceDb(getTenantDb(A), ids.ssh)), { ...prima.ssh });
    assert.deepEqual(withTenant(A, () => campiVoceDb(getTenantDb(A), ids.v3)), { ...prima.v3 });
    assert.deepEqual(withTenant(A, () => coppiaSshDb(getTenantDb(A), ids.ssh)), { username: "admin", password: SEGRETI[0], port: 22 });
    assert.equal(withTenant(A, () => communityDb(getTenantDb(A), ids.snmp)), SEGRETI[1]);

    const testo = rapporto(e);
    for (const s of [...SEGRETI, ...cifrati]) assert.ok(!testo.includes(s));

    // la verifica dice 0 rimasti
    const v = await verificaSvuotamento({ store, tenants: tenants() });
    assert.equal(v.ok, true);
    assert.deepEqual(v.perTenant.map((t) => [t.rimaste.length, t.inOpenBao]), [[0, 3], [0, 1]]);
  });

  it("si può ripetere: la seconda volta non c'è più niente da svuotare e va bene", async () => {
    await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    const e2 = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e2.ok, true);
    assert.deepEqual(e2.perTenant.map((t) => [t.daSvuotare, t.svuotate, t.giaVuote]), [[0, 0, 3], [0, 0, 1]]);
  });

  it("UNA differenza fra OpenBao e la colonna: esce non-ok e non tocca niente, nemmeno nell'altro cliente", async () => {
    // Guasto provato: senza il confronto uguale-per-uguale si svuoterebbe anche la colonna che l'app, dopo, leggerebbe
    // diversa da OpenBao; qui l'altro cliente (B) deve restare intatto per il solo errore di A.
    const ref = (getTenantDb(A).prepare("SELECT credential_ref AS r FROM credentials WHERE id = ?").get(ids.ssh) as { r: string }).r;
    finto.kv.set(ref, { username: "admin", password: "cambiata-solo-in-openbao" });
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.equal(e.applicata, false);
    assert.deepEqual(e.perTenant[0].diverse.map((d) => [d.id, d.motivo]), [[ids.ssh, "valori diversi fra OpenBao e la colonna"]]);
    assert.equal(colonnePiene(getTenantDb(A)), 3);
    assert.equal(colonnePiene(getTenantDb(B)), 1);
    assert.equal(existsSync(backups), false, "nemmeno il backup: non si è scritto niente");
    const testo = rapporto(e);
    for (const s of [...SEGRETI, "cambiata-solo-in-openbao"]) assert.ok(!testo.includes(s));
  });

  it("un campo in più o in meno in OpenBao è una differenza", async () => {
    const ref = (getTenantDb(A).prepare("SELECT credential_ref AS r FROM credentials WHERE id = ?").get(ids.ssh) as { r: string }).r;
    finto.kv.set(ref, { username: "admin", password: SEGRETI[0], extra: "x" });
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.equal(colonnePiene(getTenantDb(A)), 3);
  });

  it("un segreto mancante in OpenBao: non-ok col motivo, niente toccato", async () => {
    const ref = (getTenantDb(B).prepare("SELECT credential_ref AS r FROM credentials").get() as { r: string }).r;
    finto.kv.delete(ref);
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.match(e.perTenant[1].diverse[0].motivo, /non è in OpenBao/);
    assert.equal(colonnePiene(getTenantDb(A)), 3);
    assert.equal(colonnePiene(getTenantDb(B)), 1);
  });

  it("una riga con le colonne piene e senza riferimento: non-ok, dice quale; niente toccato", async () => {
    withTenant(B, () => creaCredenzialeDb(getTenantDb(B), { name: "Non migrata", credential_type: "ssh", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") }));
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.deepEqual(e.perTenant[1].senzaRiferimento.map((r) => r.nome), ["Non migrata"]);
    assert.equal(colonnePiene(getTenantDb(A)), 3);
  });

  it("OpenBao irraggiungibile: non-ok, niente toccato", async () => {
    finto.giu = true;
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.match(e.perTenant[0].diverse[0].motivo, /OpenBao non risponde/);
    assert.equal(colonnePiene(getTenantDb(A)), 3);
  });

  it("una colonna che non si decifra: non-ok, niente toccato (non si butta un segreto che non si è letto)", async () => {
    getTenantDb(A).prepare("UPDATE credentials SET encrypted_password = ? WHERE id = ?").run(`${"a".repeat(32)}:${"b".repeat(32)}:abcd`, ids.ssh);
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.equal(e.perTenant[0].diverse[0].motivo, "la colonna non si legge");
    assert.equal(colonnePiene(getTenantDb(A)), 3);
  });

  it("lo schema senza credential_ref: non-ok, niente toccato", async () => {
    const mem = new Database(":memory:");
    mem.exec("CREATE TABLE credentials (id INTEGER PRIMARY KEY, name TEXT, credential_type TEXT, encrypted_password TEXT)");
    mem.prepare("INSERT INTO credentials (name, credential_type, encrypted_password) VALUES ('x', 'ssh', ?)").run(encrypt("p"));
    const e = await svuotaColonne({ store, tenants: [{ codice: "MEM", dbh: mem }], applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.match(e.perTenant[0].errore ?? "", /credential_ref manca/);
    assert.equal((mem.prepare("SELECT COUNT(*) AS n FROM credentials WHERE encrypted_password IS NOT NULL").get() as { n: number }).n, 1);
    mem.close();
  });

  it("una riga cambiata dopo il confronto e prima della transazione: ROLLBACK per quel cliente, nessuna riga svuotata", async () => {
    // Guasto provato: senza il ricontrollo dentro la transazione si azzererebbe una colonna che nel frattempo ha un valore
    // nuovo, perdendolo (OpenBao ha ancora il vecchio).
    const cambia = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], fetch: finto.fetch });
    const get = cambia.get.bind(cambia);
    let ultima = 0;
    cambia.get = async (p, o) => {
      const v = await get(p, o);
      if (++ultima === 3) getTenantDb(A).prepare("UPDATE credentials SET encrypted_password = ? WHERE id = ?").run(encrypt("valore-nuovo-nel-frattempo"), ids.snmp);
      return v;
    };
    const e = await svuotaColonne({ store: cambia, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, false);
    assert.match(e.perTenant[0].errore ?? "", /è cambiata durante lo svuotamento/);
    assert.equal(colonnePiene(getTenantDb(A)), 3, "il cliente A è com'era");
    assert.equal(colonnePiene(getTenantDb(B)), 1, "e B non è stato toccato");
  });

  it("un crash dopo il primo cliente: A svuotato, B intatto; rilanciando B si svuota", async () => {
    const e1 = await svuotaColonne({
      store, tenants: tenants(), applica: true, cartellaBackup: backups,
      dopoCliente: (c) => { if (c === A) throw new Error("crash simulato"); },
    });
    assert.equal(e1.ok, false);
    assert.match(e1.perTenant[0].errore ?? "", /crash simulato/);
    assert.equal(colonnePiene(getTenantDb(A)), 0);
    assert.equal(colonnePiene(getTenantDb(B)), 1);
    const e = await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    assert.equal(e.ok, true);
    assert.equal(colonnePiene(getTenantDb(B)), 0);
  });
});

describe("verificaSvuotamento", () => {
  it("segreti rimasti nelle colonne o un segreto che manca in OpenBao: non-ok, con id e nome, senza valori", async () => {
    await svuotaColonne({ store, tenants: tenants(), applica: true, cartellaBackup: backups });
    getTenantDb(A).prepare("UPDATE credentials SET encrypted_password = ? WHERE id = ?").run(encrypt("rientrata"), ids.snmp);
    const refB = (getTenantDb(B).prepare("SELECT credential_ref AS r FROM credentials").get() as { r: string }).r;
    finto.kv.delete(refB);
    const v = await verificaSvuotamento({ store, tenants: tenants() });
    assert.equal(v.ok, false);
    assert.deepEqual(v.perTenant[0].rimaste, [{ id: ids.snmp, nome: "Switch v2c" }]);
    assert.equal(v.perTenant[1].senzaSegreto.length, 1);
    const testo = rapporto(v);
    for (const s of [...SEGRETI, "rientrata"]) assert.ok(!testo.includes(s));
  });
});
