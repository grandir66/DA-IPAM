/**
 * Correzioni della revisione del 23/10, rilievo 7: una credenziale eliminata (o cambiata) lasciava il suo valore nel
 * vault remoto per sempre. Scelta (ADR 0034), oggi verso DA-Link (OpenBao tolto il 02/11/2026):
 * - alla cancellazione di una voce con `credential_ref` (e `DA_VAULT_DALINK=1`) si cancella il percorso in DA-Link. Se
 *   DA-Link non risponde, la voce si cancella lo stesso ma l'avviso nel log lo dice: nessun ripiego muto;
 * - `da-vault-migra-verso-dalink --verifica` elenca i percorsi orfani (sotto `clienti/<cliente>/da-ipam/` ma senza voce
 *   che li usi): copre i cancellamenti falliti, i segreti cambiati (il riferimento si toglie) e le cancellazioni in massa.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/orfani.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaCredenzialeDb, eliminaCredenzialeDb } from "@/lib/credentials/archivio";
import { attendiCancellazioniRemote } from "../cancella";
import { percorsoCredenziale, verificaMigrazione } from "../migra-verso-dalink";
import { statoVaultProcesso } from "../stato";
import { VaultRemotoFinto } from "./support/vault-remoto-finto";

const T = "C70007";
let store: VaultRemotoFinto;
let idCon: number;
let idSenza: number;
let pathCon: string;

function avvisi(): { righe: string[]; ripristina: () => void } {
  const righe: string[] = [];
  const orig = { warn: console.warn, error: console.error };
  console.warn = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
  console.error = (...a: unknown[]) => { righe.push(a.map(String).join(" ")); };
  return { righe, ripristina: () => Object.assign(console, orig) };
}

const eliminazioni = () => store.chiamate.filter((r) => r.metodo === "delete");

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    idCon = creaCredenzialeDb(d, { name: "Firewall Sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("pw-orfani-1") }).id;
    idSenza = creaCredenzialeDb(d, { name: "Router vecchio", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("pw-orfani-2") }).id;
  });
});

beforeEach(async () => {
  store = new VaultRemotoFinto();
  statoVaultProcesso().remoto = store;
  process.env.DA_VAULT_DALINK = "1";
  // Ogni prova parte con la voce col riferimento (ricreata se una prova l'ha eliminata).
  withTenant(T, () => {
    const d = getTenantDb(T);
    if (!d.prepare("SELECT 1 FROM credentials WHERE id = ?").get(idCon)) {
      idCon = creaCredenzialeDb(d, { name: "Firewall Sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("pw-orfani-1") }).id;
    }
    pathCon = percorsoCredenziale(T, idCon, "Firewall Sede");
    d.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?").run(pathCon, idCon);
  });
  store.voci.set(pathCon, { username: "admin", password: "pw-orfani-1" });
});

after(() => {
  delete process.env.DA_VAULT_DALINK;
  statoVaultProcesso().remoto = null;
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

describe("cancellazione di una voce con riferimento", () => {
  it("cancella il percorso in DA-Link", async () => {
    withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idCon), true));
    await attendiCancellazioniRemote();
    assert.equal(store.voci.has(pathCon), false, "il segreto è rimasto in DA-Link");
    const e = eliminazioni();
    assert.equal(e.length, 1);
    assert.equal(e[0].percorso, pathCon);
  });

  it("una voce senza riferimento non chiama DA-Link", async () => {
    withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idSenza), true));
    await attendiCancellazioniRemote();
    assert.deepEqual(eliminazioni(), []);
    assert.equal(store.voci.has(pathCon), true);
  });

  it("a interruttore spento non chiama DA-Link", async () => {
    delete process.env.DA_VAULT_DALINK;
    withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idCon), true));
    await attendiCancellazioniRemote();
    assert.deepEqual(eliminazioni(), []);
    assert.equal(store.voci.has(pathCon), true);
  });

  it("DA-Link non risponde: la voce si cancella, l'avviso nomina cliente e voce (nessun ripiego muto)", async () => {
    store.giu = true;
    const a = avvisi();
    try {
      withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idCon), true));
      await attendiCancellazioniRemote();
    } finally {
      a.ripristina();
    }
    const testo = a.righe.join("\n");
    assert.match(testo, new RegExp(`${T}#${idCon}`));
    assert.match(testo, /orfan/i);
    assert.ok(!testo.includes("pw-orfani"));
    withTenant(T, () => assert.equal(getTenantDb(T).prepare("SELECT 1 FROM credentials WHERE id = ?").get(idCon), undefined));
    store.giu = false;
    assert.equal(store.voci.has(pathCon), true, "il segreto è ancora in DA-Link: deve comparire fra gli orfani");
  });
});

describe("--verifica elenca i percorsi orfani", () => {
  const tenants = () => [{ codice: T, dbh: getTenantDb(T) }];

  it("un percorso sotto il cliente senza voce che lo usi è orfano; quello usato no", async () => {
    store.voci.set(`clienti/${T.toLowerCase()}/da-ipam/voce-cancellata-99`, { password: "pw-orfano" });
    const v = await verificaMigrazione({ store, tenants: tenants() });
    const t = v.perTenant.find((x) => x.codice === T);
    assert.deepEqual(t?.orfani, [`clienti/${T.toLowerCase()}/da-ipam/voce-cancellata-99`]);
    assert.ok(!JSON.stringify(v).includes("pw-orfano"), "il rapporto non contiene valori");
  });

  it("senza orfani l'elenco è vuoto", async () => {
    const v = await verificaMigrazione({ store, tenants: tenants() });
    assert.deepEqual(v.perTenant.find((x) => x.codice === T)?.orfani, []);
  });

  it("una voce a cui è stato tolto il riferimento (segreto cambiato) lascia il suo percorso fra gli orfani", async () => {
    withTenant(T, () => getTenantDb(T).prepare("UPDATE credentials SET credential_ref = NULL WHERE id = ?").run(idCon));
    const v = await verificaMigrazione({ store, tenants: tenants() });
    assert.deepEqual(v.perTenant.find((x) => x.codice === T)?.orfani, [pathCon]);
  });
});
