/**
 * Correzioni della revisione del 23/10, rilievo 5: la passphrase del cliente si prova da due rotte (sblocco e
 * esportazione KeePass) e ogni prova è una derivazione scrypt costosa. Prima: `sblocca` aveva un contatore GLOBALE
 * (un admin poteva bloccare tutti, o essere l'unico a provare) e `keepass` non ne aveva nessuno. Ora:
 * - un limite di tentativi sbagliati PER UTENTE (5 in 15 minuti), condiviso fra le due rotte;
 * - il tentativo si prenota PRIMA di aspettare la derivazione (cento richieste in parallelo non passano tutte il
 *   controllo prima del primo fallimento), come per il login (revisione del 20/10);
 * - un tetto alle derivazioni scrypt in corso (`MAX_VERIFICHE_CONCORRENTI`): le altre ricevono 429, non si accodano.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/guardia-passphrase.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { clearRateLimit } from "@/lib/rate-limit";
import { sbloccaGuardato } from "../appliance";
import { creaArchivio } from "../archivio";
import { chiaveTentativi, conGuardiaPassphrase, MAX_VERIFICHE_CONCORRENTI } from "../guardia-passphrase";
import { esportaKeePass } from "../keepass";
import type { UtenteSessione } from "../mostra";
import { chiudiVault, impostaChiaveDati } from "../stato";
import { ErroreVault } from "../tipi";

const T = "VAULTGUARDIA";
const PASS = "passphrase-cliente-guardia-42";
const ARGON_PROVA = { memoriaKiB: 1024, iterazioni: 1, parallelismo: 1 };
const utente = (id: string): UtenteSessione => ({ id, nome: `utente-${id}`, ruolo: "admin" });
let chiave: Buffer;

before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "da-vault-guardia-"));
  process.env.DA_VAULT_DIR = dir;
  chiave = (await creaArchivio(dir, { passphrase: PASS, chiaveDomarc: await identityToRecipient(await generateX25519Identity()), scryptLogN: 10 })).chiave;
  withTenant(T, () => {
    creaCredenzialeDb(getTenantDb(T), { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("pw-guardia") });
  });
});

beforeEach(() => {
  process.env.DA_VAULT_LOCALE = "1";
  impostaChiaveDati(chiave, "tpm");
  for (const id of ["7", "8", "9", "100", "101", "102", "103", "104", "105"]) clearRateLimit(chiaveTentativi(id));
});

after(() => {
  delete process.env.DA_VAULT_LOCALE;
  delete process.env.DA_VAULT_DIR;
  chiudiVault(null);
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

const keepass = (u: UtenteSessione, pass: string) => withTenant(T, () => esportaKeePass({ dbh: getTenantDb(T), utente: u, passphrase: pass, argon2: ARGON_PROVA }));

describe("limite per utente, condiviso fra sblocco e KeePass", () => {
  it("KeePass: cinque passphrase sbagliate bloccano la sesta, anche se è giusta (429)", async () => {
    const u = utente("7");
    for (let i = 0; i < 5; i++) {
      const e = await keepass(u, "sbagliata-sbagliata-1");
      assert.ok(!e.ok && e.stato === 403, `tentativo ${i + 1}`);
    }
    const bloccata = await keepass(u, PASS);
    assert.ok(!bloccata.ok && bloccata.stato === 429);
  });

  it("il contatore è uno solo: 3 sbagliate dal KeePass e 2 dallo sblocco bloccano entrambe le rotte", async () => {
    const u = utente("8");
    for (let i = 0; i < 3; i++) await keepass(u, "sbagliata-sbagliata-1");
    for (let i = 0; i < 2; i++) {
      const s = await sbloccaGuardato(u.id, "sbagliata-sbagliata-2").catch((e: unknown) => e);
      assert.ok(s instanceof ErroreVault && s.codice === "slot_errato");
    }
    const k = await keepass(u, PASS);
    assert.ok(!k.ok && k.stato === 429, "il KeePass doveva essere bloccato");
    const s = await sbloccaGuardato(u.id, PASS);
    assert.ok(!s.ok && s.stato === 429, "lo sblocco doveva essere bloccato");
  });

  it("per utente: chi sbaglia non blocca gli altri (il vecchio contatore globale bloccava tutti)", async () => {
    for (let i = 0; i < 5; i++) await keepass(utente("7"), "sbagliata-sbagliata-1");
    const altro = await keepass(utente("9"), PASS);
    assert.ok(altro.ok, "un altro utente con la passphrase giusta deve passare");
  });

  it("una passphrase giusta azzera il contatore", async () => {
    const u = utente("7");
    for (let i = 0; i < 4; i++) await keepass(u, "sbagliata-sbagliata-1");
    assert.ok((await keepass(u, PASS)).ok);
    for (let i = 0; i < 4; i++) {
      const e = await keepass(u, "sbagliata-sbagliata-1");
      assert.ok(!e.ok && e.stato === 403, `dopo l'azzeramento il tentativo ${i + 1} non doveva essere bloccato`);
    }
  });
});

describe("guardia: il tetto alle derivazioni in corso e i tentativi prenotati", () => {
  it("più richieste insieme del tetto: le altre ricevono 429 subito, non si accodano", async () => {
    let inCorso = 0;
    let massimo = 0;
    let apri!: () => void;
    const cancello = new Promise<void>((r) => { apri = r; });
    const richieste = Array.from({ length: MAX_VERIFICHE_CONCORRENTI + 3 }, (_, i) =>
      conGuardiaPassphrase(String(100 + i), async () => {
        inCorso += 1;
        massimo = Math.max(massimo, inCorso);
        await cancello;
        inCorso -= 1;
        return "ok";
      }),
    );
    // Le rifiutate tornano subito, prima che il cancello si apra.
    await new Promise((r) => setImmediate(r));
    apri();
    const esiti = await Promise.all(richieste);
    assert.equal(esiti.filter((e) => e.ok).length, MAX_VERIFICHE_CONCORRENTI);
    assert.equal(esiti.filter((e) => !e.ok && e.stato === 429).length, 3);
    assert.equal(massimo, MAX_VERIFICHE_CONCORRENTI);
    assert.equal(inCorso, 0);
  });

  it("dieci tentativi sbagliati in parallelo dello stesso utente: la derivazione parte al massimo MAX volte", async () => {
    let partiti = 0;
    const esiti = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        conGuardiaPassphrase("100", async () => {
          partiti += 1;
          await new Promise((r) => setTimeout(r, 20));
          throw new ErroreVault("slot_errato", "Passphrase errata");
        }),
      ),
    );
    assert.equal(partiti, MAX_VERIFICHE_CONCORRENTI);
    assert.equal(esiti.filter((e) => e.status === "fulfilled" && !e.value.ok).length, 10 - MAX_VERIFICHE_CONCORRENTI);
  });

  it("dopo il blocco la derivazione non parte nemmeno: la sesta non esegue il codice", async () => {
    let partiti = 0;
    const tenta = () => conGuardiaPassphrase("101", async () => { partiti += 1; throw new ErroreVault("slot_errato", "x"); }).catch(() => null);
    for (let i = 0; i < 5; i++) await tenta();
    assert.equal(partiti, 5);
    const sesta = await conGuardiaPassphrase("101", async () => { partiti += 1; return "ok"; });
    assert.ok(!sesta.ok && sesta.stato === 429);
    assert.equal(partiti, 5);
  });

  it("un errore che non dipende dalla passphrase (archivio assente) non consuma i tentativi", async () => {
    for (let i = 0; i < 8; i++) {
      await conGuardiaPassphrase("102", async () => { throw new ErroreVault("archivio_assente", "manca"); }).catch(() => null);
    }
    const e = await conGuardiaPassphrase("102", async () => "ok");
    assert.ok(e.ok);
  });
});
