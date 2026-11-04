/**
 * Freni del pulsante «Test» e della ricerca della credenziale su una voce Windows di dominio.
 *
 * Il legame aveva già i freni (ricordo delle password errate, 3 prove in 15 minuti per utente, verifica sul DC);
 * `POST /api/credentials/[id]/test` e `trovaCredenziale` no: un clic ripetuto era un logon per clic, e la ricerca
 * arrivava a 3 tentativi per host su fino a 50 host. Su un account di dominio con la password sbagliata è il blocco.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/trova-freni-windows.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { chiaveAccount, RicordoErrate } from "@/lib/scanner/account-windows";
import { CredentialRunBudget } from "@/lib/scanner/credential-run-budget";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { WinrmError, type OpzioniWinrm } from "@/lib/devices/winrm-run";
import { provaCredenzialeSuHost, trovaCredenziale, type OpzioniProvaSuHost } from "../trova";

void TEST_DATA_DIR;
const T = "TESTFRENIWIN";
const PASSWORD = "S3greta!";
const HOST_COUNT = 20;

interface Banco {
  deps: OpzioniProvaSuHost;
  logon: () => number;
  verifiche: () => number;
  opzioni: Array<OpzioniWinrm | undefined>;
}

function banco(o: { verifica?: EsitoPassword; ricordo?: RicordoErrate; ricerca?: boolean } = {}): Banco {
  let logon = 0;
  let verifiche = 0;
  const opzioni: Array<OpzioniWinrm | undefined> = [];
  return {
    logon: () => logon,
    verifiche: () => verifiche,
    opzioni,
    deps: {
      ricerca: o.ricerca,
      ricordo: o.ricordo ?? new RicordoErrate(),
      verificaPassword: async () => {
        verifiche += 1;
        return o.verifica ?? "non_so";
      },
      winrm: async (...a) => {
        logon += 1;
        opzioni.push(a[7]);
        throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
      },
    },
  };
}

describe("freni su una voce Windows di dominio", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.60.0.0/24', 'prova')`).run();
      for (let i = 1; i <= HOST_COUNT; i++) d.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (?, 1, ?)`).run(i, `10.60.0.${i}`);
    });
  });
  after(() => deleteTenantDatabase(T));

  /** Una voce per prova: il limite per utente resta quello vero e non si porta dietro le altre prove. */
  let progressivo = 0;
  function voce(utente: string): number {
    progressivo += 1;
    const id = 100 + progressivo;
    withTenant(T, () => {
      getTenantDb(T)
        .prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, 'windows', ?, ?)`)
        .run(id, `voce ${id}`, encrypt(utente), encrypt(PASSWORD));
    });
    return id;
  }
  const soloQuesta = (id: number) =>
    withTenant(T, () => {
      getTenantDb(T).prepare(`DELETE FROM credentials WHERE credential_type = 'windows' AND id <> ?`).run(id);
    });

  describe("il pulsante Test", () => {
    it("5 clic con la password rifiutata: al massimo 3 logon, dal quarto un messaggio con l'attesa", async () => {
      const id = voce("CLIENTE\\test-clic");
      const b = banco();
      const esiti = [];
      for (let i = 0; i < 5; i++) esiti.push(await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), id, "10.60.0.1", null, b.deps)));
      assert.equal(b.logon(), 3);
      for (const e of esiti.slice(3)) {
        assert.equal(e.ok, false);
        assert.equal(e.registra, false, "una prova non partita non lascia traccia sull'host");
        assert.match(e.errore ?? "", /Troppe prove.*3 in 15 minuti.*tra (circa \d+ minut|meno di un minuto)/);
      }
    });

    it("il limite è per utente: due voci con lo stesso account contano insieme", async () => {
      const a = voce("CLIENTE\\test-stesso");
      const c = voce("test-stesso@cliente.local");
      const b = banco();
      for (let i = 0; i < 2; i++) await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), a, "10.60.0.1", null, b.deps));
      for (let i = 0; i < 2; i++) await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), c, "10.60.0.1", null, b.deps));
      assert.equal(b.logon(), 3);
    });

    it("il DC dice errata: nessun logon sull'host, ricordo aggiornato, dal secondo clic nemmeno il bind", async () => {
      const id = voce("CLIENTE\\test-errata");
      const ricordo = new RicordoErrate();
      const b = banco({ verifica: "errata", ricordo });
      for (let i = 0; i < 3; i++) await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), id, "10.60.0.1", null, b.deps));
      assert.equal(b.logon(), 0);
      assert.equal(b.verifiche(), 1);
      assert.equal(ricordo.ricorda(chiaveAccount("CLIENTE\\test-errata", PASSWORD)), true);
    });

    it("password non verificata: un solo trasporto per logon; verificata dal DC: la catena intera", async () => {
      const non = banco();
      await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), voce("CLIENTE\\test-nonso"), "10.60.0.1", null, non.deps));
      assert.deepEqual(non.opzioni, [{ unSoloLogon: true }]);
      const si = banco({ verifica: "valida" });
      await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), voce("CLIENTE\\test-valida"), "10.60.0.1", null, si.deps));
      assert.deepEqual(si.opzioni, [undefined]);
    });

    it("account locale: nessun limite e nessuna verifica, come prima", async () => {
      const id = voce("amministratore");
      const b = banco();
      for (let i = 0; i < 5; i++) await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), id, "10.60.0.1", null, b.deps));
      assert.equal(b.logon(), 5);
      assert.equal(b.verifiche(), 0);
    });
  });

  describe("la ricerca della credenziale", () => {
    async function ricerca(id: number, b: Banco, budget: CredentialRunBudget): Promise<void> {
      soloQuesta(id);
      for (let hostId = 1; hostId <= HOST_COUNT; hostId++) {
        await withTenant(T, async () => {
          const dbh = getTenantDb(T);
          await trovaCredenziale(
            dbh,
            hostId,
            "winrm",
            5985,
            async (credentialId) => {
              const e = await provaCredenzialeSuHost(dbh, credentialId, `10.60.0.${hostId}`, 5985, { ...b.deps, ricerca: true });
              return { ok: e.ok, errore: e.ok ? undefined : e.errore, nonProvata: !e.registra, trasporto: e.trasporto, passwordErrata: e.passwordErrata, passwordValida: e.passwordValida };
            },
            { budget },
          );
        });
      }
    }

    it("20 host con la password rifiutata e non verificabile: al massimo 3 logon in tutta la ricerca", async () => {
      const id = voce("CLIENTE\\ricerca-nonso");
      const b = banco();
      await ricerca(id, b, new CredentialRunBudget(() => undefined));
      assert.equal(b.logon(), 3);
    });

    it("20 host con la password errata per il DC: nessun logon sugli host, una verifica sola", async () => {
      const id = voce("CLIENTE\\ricerca-errata");
      const b = banco({ verifica: "errata" });
      await ricerca(id, b, new CredentialRunBudget(() => undefined));
      assert.equal(b.logon(), 0);
      assert.equal(b.verifiche(), 1);
    });

    it("la ricerca non consuma il limite dei clic: dopo una ricerca fermata, il pulsante Test parte", async () => {
      const id = voce("CLIENTE\\ricerca-poi-clic");
      const b = banco();
      await ricerca(id, b, new CredentialRunBudget(() => undefined));
      const prima = b.logon();
      await withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), id, "10.60.0.1", null, { ...b.deps, ricerca: false }));
      assert.equal(b.logon(), prima + 1);
    });
  });
});
