/**
 * Vault semplice, condizioni del passo 7 (piano DA-Link `2026-10-29-vault-passo6-app.md`, Task S6, revisione del
 * 29/10): `scripts/da-vault-migra-openbao.ts` col backend acceso. Con DA-Link acceso una credenziale cambiata dalla
 * pagina perde `credential_ref` e torna sulla colonna (`aggiornamenti.ts`, `togliRiferimentoSeCambianoSegreti`): la
 * migrazione deve riportarla in DA-Link come oggi la riporta in OpenBao.
 *
 * Si prova:
 * - la scelta dello store dall'interruttore (`sceltaBackendRemoto`): spenti → OpenBao come prima del passo 6, DA-Link
 *   solo acceso, i due insieme = rifiuto col motivo;
 * - con DA-Link: la voce già in DA-Link col valore vecchio si sostituisce (il `put` manda la versione giusta, niente
 *   409), il riferimento torna, `--verifica` dopo dice 0 diverse; i testi nominano DA-Link, mai valori né gettone.
 *
 * Contro il DA-Link finto col TLS vero (`support/dalink-finto.ts`), la CLI in un processo figlio.
 *
 * Run: node --import tsx --test src/lib/vault/__tests__/migra-openbao-dalink.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { encrypt } from "@/lib/crypto";
import { closeTenantDb, getTenantDb, withTenant } from "@/lib/db-tenant";
import { closeHubDb, createTenant } from "@/lib/db-hub";
import { creaCredenzialeDb } from "@/lib/credentials/archivio";
import { percorsoCredenziale, storeDellaMigrazione } from "../migra-openbao";
import { creaDaLinkFinto, MARCA_CORPO, type DaLinkFinto } from "./support/dalink-finto";

const T = "C70004";
const PW_VECCHIA = "pw-vecchia-in-dalink-3141";
const PW_NUOVA = "pw-nuova-dalla-pagina-2718";

describe("storeDellaMigrazione: lo store è quello del backend acceso", () => {
  const dalink = { DALINK_VAULT_URL: "https://192.168.4.44:8443", DALINK_VAULT_GETTONE: "dlv_" + "g".repeat(43), DALINK_VAULT_IMPRONTA: "sha256//" + "A".repeat(43) + "=" };
  const openbao = { DA_VAULT_OPENBAO_URL: "https://openbao.interno:8200", DA_VAULT_OPENBAO_ROLE_ID: "ruolo", DA_VAULT_OPENBAO_SECRET_ID_FILE: "/non/esiste" };

  it("interruttori spenti: OpenBao come prima del passo 6 (si migra, poi si accende), mai DA-Link", () => {
    const s = storeDellaMigrazione({ ...openbao, ...dalink });
    assert.ok(s.ok && s.store.backend === "openbao", s.ok ? s.nome : s.motivo);
  });

  it("tutti e due accesi: rifiuto (come all'avvio dell'app)", () => {
    const s = storeDellaMigrazione({ ...openbao, ...dalink, DA_VAULT_OPENBAO: "1", DA_VAULT_DALINK: "1" });
    assert.ok(!s.ok && /insieme/.test(s.motivo), !s.ok ? s.motivo : "");
  });

  it("OpenBao acceso: OpenBaoStore; senza configurazione il motivo dice cosa manca", () => {
    const s = storeDellaMigrazione({ ...openbao, DA_VAULT_OPENBAO: "1" });
    assert.ok(s.ok && s.store.backend === "openbao" && s.nome === "OpenBao");
    const m = storeDellaMigrazione({ DA_VAULT_OPENBAO: "1" });
    assert.ok(!m.ok && /DA_VAULT_OPENBAO_URL/.test(m.motivo) && /OpenBao/.test(m.motivo), !m.ok ? m.motivo : "");
  });

  it("DA-Link acceso: store di DA-Link; senza configurazione il motivo nomina la variabile, mai il gettone", () => {
    const s = storeDellaMigrazione({ ...dalink, DA_VAULT_DALINK: "1" });
    assert.ok(s.ok && s.store.backend === "dalink" && s.nome === "DA-Link");
    const m = storeDellaMigrazione({ ...dalink, DALINK_VAULT_IMPRONTA: "", DA_VAULT_DALINK: "1" });
    assert.ok(!m.ok && /DALINK_VAULT_IMPRONTA/.test(m.motivo) && /DA-Link/.test(m.motivo) && !m.motivo.includes("dlv_"), !m.ok ? m.motivo : "");
  });
});

describe("scripts/da-vault-migra-openbao.ts con DA-Link acceso", () => {
  let dl: DaLinkFinto;
  let id = 0;
  let percorso = "";

  before(async () => {
    dl = await creaDaLinkFinto();
    createTenant({ codice_cliente: T, ragione_sociale: "Cliente migra DA-Link", active: 1 } as Parameters<typeof createTenant>[0]);
    withTenant(T, () => {
      // Come dopo un cambio dalla pagina con DA-Link acceso: riferimento tolto, la colonna ha il valore nuovo.
      id = creaCredenzialeDb(getTenantDb(T), { name: "Firewall", credential_type: "ssh", encrypted_username: encrypt("admin"), encrypted_password: encrypt(PW_NUOVA) }).id;
    });
    closeTenantDb(T);
    closeHubDb();
    percorso = percorsoCredenziale(T, id, "Firewall");
    // In DA-Link la voce c'è già, col valore di prima del cambio (versione 1).
    dl.scriviDaFuori(percorso, { username: "admin", password: PW_VECCHIA });
  });

  after(async () => {
    await dl.chiudi();
  });

  /** spawn asincrono: il DA-Link finto gira in questo processo e deve poter rispondere. */
  function cli(args: string[], env: Record<string, string> = {}): Promise<{ status: number | null; stdout: string; stderr: string }> {
    return new Promise((ok) => {
      const p = spawn(process.execPath, ["--import", "tsx", join(process.cwd(), "scripts", "da-vault-migra-openbao.ts"), ...args], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DA_INVENT_DATA_DIR: TEST_DATA_DIR,
          // OpenBao né acceso né configurato: la migrazione verso DA-Link non lo tocca.
          DA_VAULT_OPENBAO: "",
          DA_VAULT_OPENBAO_URL: "",
          DA_VAULT_OPENBAO_ROLE_ID: "",
          DA_VAULT_OPENBAO_SECRET_ID_FILE: "",
          CREDENTIALS_DIRECTORY: "",
          DA_VAULT_DALINK: "1",
          DALINK_VAULT_URL: dl.url,
          DALINK_VAULT_GETTONE: dl.gettone,
          DALINK_VAULT_IMPRONTA: dl.impronta,
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
    const r = getTenantDb(T).prepare("SELECT credential_ref FROM credentials WHERE id = ?").get(id) as { credential_ref: string | null };
    closeTenantDb(T);
    return r.credential_ref;
  }

  function nessunSegreto(r: { stdout: string; stderr: string }): void {
    const tutto = r.stdout + r.stderr;
    for (const v of [PW_VECCHIA, PW_NUOVA, dl.gettone, "dlv_", MARCA_CORPO]) assert.ok(!tutto.includes(v), `l'uscita contiene «${v.slice(0, 6)}…»`);
  }

  it("interruttori spenti: va verso OpenBao come prima (qui non configurato: esce ≠0), niente chiesto a DA-Link", async () => {
    const n = dl.richieste.length;
    const r = await cli([], { DA_VAULT_DALINK: "" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /OpenBao/);
    assert.equal(dl.richieste.length, n);
  });

  it("tutti e due accesi: esce ≠0 col motivo", async () => {
    const r = await cli([], { DA_VAULT_OPENBAO: "1" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /insieme/);
  });

  it("configurazione di DA-Link che manca: esce ≠0 col nome della variabile, senza il gettone", async () => {
    const r = await cli([], { DALINK_VAULT_IMPRONTA: "" });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /DALINK_VAULT_IMPRONTA/);
    nessunSegreto(r);
  });

  it("di serie è a vuoto: lo dice col backend vero, niente scritto in DA-Link né nel database", async () => {
    const r = await cli([]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /prova a vuoto/i);
    assert.match(r.stdout, /DA-Link/);
    assert.match(r.stdout, new RegExp(`${T}: 1 da migrare`));
    assert.equal(dl.richieste.filter((q) => q.metodo !== "GET").length, 0);
    assert.equal(riferimento(), null);
    nessunSegreto(r);
  });

  it("--applica scrive in DA-Link sopra la versione vecchia (niente 409) e rimette il riferimento; --verifica: 0 diverse", async () => {
    const r = await cli(["--applica"]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.deepEqual(dl.voci.get(percorso), { valori: { username: "admin", password: PW_NUOVA }, versione: 2 });
    assert.deepEqual(
      dl.richieste.filter((q) => q.metodo === "PUT").map((q) => (JSON.parse(q.corpo) as { versione_attesa: number }).versione_attesa),
      [1],
      "un solo PUT, con la versione che DA-Link aveva",
    );
    assert.equal(riferimento(), percorso);
    assert.match(r.stdout, /DA-Link/);
    assert.doesNotMatch(r.stdout + r.stderr, /OpenBao/);
    nessunSegreto(r);
    const v = await cli(["--verifica"]);
    assert.equal(v.status, 0, v.stderr + v.stdout);
    assert.match(v.stdout, new RegExp(`${T}: 1 controllate, 0 diverse, 0 orfani in DA-Link`));
    nessunSegreto(v);
  });

  it("--verifica con DA-Link diverso dalla colonna: esce 2 e lo dice nominando DA-Link", async () => {
    dl.scriviDaFuori(percorso, { username: "admin", password: "cambiata-in-dalink-1618" });
    const v = await cli(["--verifica"]);
    assert.equal(v.status, 2, v.stderr + v.stdout);
    assert.match(v.stdout, /valori diversi fra DA-Link e la colonna/);
    assert.match(v.stderr, /DA-Link diverso dalle colonne/);
    assert.doesNotMatch(v.stdout + v.stderr, /OpenBao/);
    assert.ok(!(v.stdout + v.stderr).includes("cambiata-in-dalink-1618"));
    nessunSegreto(v);
  });
});
