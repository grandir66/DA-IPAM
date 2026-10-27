/**
 * Correzioni della revisione del 23/10, rilievo 7: una credenziale eliminata (o cambiata) lasciava il suo valore in
 * OpenBao per sempre. Scelta (ADR 0034):
 * - alla cancellazione di una voce con `credential_ref` (e `DA_VAULT_OPENBAO=1`) si cancellano i METADATA del percorso
 *   in OpenBao (`DELETE kv-domarc/metadata/<percorso>`: tutte le versioni, non solo l'ultima). Se OpenBao non risponde
 *   o la policy non lo consente, la voce si cancella lo stesso ma l'avviso nel log lo dice: nessun ripiego muto;
 * - `da-vault-migra-openbao --verifica` elenca i percorsi orfani (sotto `clienti/<cliente>/da-ipam/` ma senza voce che
 *   li usi): copre i cancellamenti falliti, i segreti cambiati (il riferimento si toglie) e le cancellazioni in massa.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/orfani-openbao.test.ts
 */
import "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { closeTenantDb, deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { creaCredenzialeDb, eliminaCredenzialeDb } from "@/lib/credentials/archivio";
import { attendiCancellazioniOpenBao } from "../cancella";
import { riferimentiDelleCredenziali } from "../avvio";
import { percorsoCredenziale, verificaMigrazione } from "../migra-openbao";
import { OpenBaoStore } from "../openbao";
import { statoVaultProcesso } from "../stato";
import { creaOpenBaoFinto, type OpenBaoFinto } from "./support/openbao-finto";

const T = "C70007";
let finto: OpenBaoFinto;
let store: OpenBaoStore;
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

const eliminazioni = () => finto.richieste.filter((r) => r.metodo === "DELETE");

before(() => {
  withTenant(T, () => {
    const d = getTenantDb(T);
    idCon = creaCredenzialeDb(d, { name: "Firewall Sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("pw-orfani-1") }).id;
    idSenza = creaCredenzialeDb(d, { name: "Router vecchio", credential_type: "ssh", encrypted_username: encrypt("root"), encrypted_password: encrypt("pw-orfani-2") }).id;
  });
});

beforeEach(async () => {
  const adesso = Date.parse("2026-10-23T12:00:00Z");
  finto = creaOpenBaoFinto({ ora: () => adesso });
  store = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], fetch: finto.fetch, ora: () => adesso });
  statoVaultProcesso().openbao = store;
  process.env.DA_VAULT_OPENBAO = "1";
  // Ogni prova parte con la voce col riferimento (ricreata se una prova l'ha eliminata).
  withTenant(T, () => {
    const d = getTenantDb(T);
    if (!d.prepare("SELECT 1 FROM credentials WHERE id = ?").get(idCon)) {
      idCon = creaCredenzialeDb(d, { name: "Firewall Sede", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt("pw-orfani-1") }).id;
    }
    pathCon = percorsoCredenziale(T, idCon, "Firewall Sede");
    d.prepare("UPDATE credentials SET credential_ref = ? WHERE id = ?").run(pathCon, idCon);
  });
  finto.kv.set(pathCon, { username: "admin", password: "pw-orfani-1" });
});

after(() => {
  delete process.env.DA_VAULT_OPENBAO;
  statoVaultProcesso().openbao = null;
  try { closeTenantDb(T); deleteTenantDatabase(T); } catch { /* già tolto */ }
  closeHubDb();
});

describe("cancellazione di una voce con riferimento", () => {
  it("cancella i metadata del percorso in OpenBao (tutte le versioni)", async () => {
    withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idCon), true));
    await attendiCancellazioniOpenBao();
    assert.equal(finto.kv.has(pathCon), false, "il segreto è rimasto in OpenBao");
    const e = eliminazioni();
    assert.equal(e.length, 1);
    assert.match(e[0].percorso, new RegExp(`^/v1/kv-domarc/metadata/${pathCon}$`));
  });

  it("una voce senza riferimento non chiama OpenBao", async () => {
    withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idSenza), true));
    await attendiCancellazioniOpenBao();
    assert.deepEqual(eliminazioni(), []);
    assert.equal(finto.kv.has(pathCon), true);
  });

  it("a interruttore spento non chiama OpenBao", async () => {
    delete process.env.DA_VAULT_OPENBAO;
    withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idCon), true));
    await attendiCancellazioniOpenBao();
    assert.deepEqual(eliminazioni(), []);
    assert.equal(finto.kv.has(pathCon), true);
  });

  it("OpenBao non risponde: la voce si cancella, l'avviso nomina cliente e voce (nessun ripiego muto)", async () => {
    finto.giu = true;
    const a = avvisi();
    try {
      withTenant(T, () => assert.equal(eliminaCredenzialeDb(getTenantDb(T), idCon), true));
      await attendiCancellazioniOpenBao();
    } finally {
      a.ripristina();
    }
    const testo = a.righe.join("\n");
    assert.match(testo, new RegExp(`${T}#${idCon}`));
    assert.match(testo, /orfan/i);
    assert.ok(!testo.includes("pw-orfani"));
    withTenant(T, () => assert.equal(getTenantDb(T).prepare("SELECT 1 FROM credentials WHERE id = ?").get(idCon), undefined));
    finto.giu = false;
    assert.equal(finto.kv.has(pathCon), true, "il segreto è ancora in OpenBao: deve comparire fra gli orfani");
  });
});

describe("--verifica elenca i percorsi orfani", () => {
  const tenants = () => [{ codice: T, dbh: getTenantDb(T) }];

  it("un percorso sotto il cliente senza voce che lo usi è orfano; quello usato no", async () => {
    finto.kv.set(`clienti/${T.toLowerCase()}/da-ipam/voce-cancellata-99`, { password: "pw-orfano" });
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

describe("riferimento malformato nel database (rilievo 4, dal database vero)", () => {
  it("riferimentiDelleCredenziali porta cliente e voce, e il giro della cache sopravvive", async () => {
    createTenant({ codice_cliente: T, ragione_sociale: "Cliente di prova", active: 1 } as Parameters<typeof createTenant>[0]);
    let idStorta = 0;
    withTenant(T, () => {
      const d = getTenantDb(T);
      idStorta = creaCredenzialeDb(d, { name: "Voce storta", credential_type: "ssh", encrypted_username: encrypt("u"), encrypted_password: encrypt("p") }).id;
      d.prepare("UPDATE credentials SET credential_ref = 'CLIENTI/Storto//x' WHERE id = ?").run(idStorta);
    });
    const riferimenti = riferimentiDelleCredenziali();
    assert.ok(riferimenti.some((r) => r.percorso === "CLIENTI/Storto//x" && r.origine === `${T}#${idStorta}`));
    const adesso = Date.parse("2026-10-23T12:00:00Z");
    const s = new OpenBaoStore({ url: finto.url, roleId: finto.roleId, secretId: () => finto.secretId, cartelle: [], percorsiExtra: riferimentiDelleCredenziali, fetch: finto.fetch, ora: () => adesso });
    const a = avvisi();
    try {
      await s.aggiorna();
    } finally {
      a.ripristina();
    }
    assert.equal(s.leggiSync(pathCon).username, "admin", "la voce valida deve restare leggibile");
    assert.match(a.righe.join("\n"), new RegExp(`${T}#${idStorta}`));
  });
});
