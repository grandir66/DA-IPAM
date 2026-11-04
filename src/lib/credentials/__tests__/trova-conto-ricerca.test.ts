/**
 * Il conto dei logon rifiutati dalla ricerca della credenziale vale fra una richiesta e l'altra.
 *
 * Il client chiama la ricerca una volta per host (`host_ids: [uno]`): il `CredentialRunBudget` nasce a ogni richiesta e
 * non vede quelle prima. Con la password di dominio non verificabile ogni host poteva fare 3 logon errati, e 20 host
 * erano 60 logon sullo stesso account. Il conto in memoria di processo (per tenant e utente) tiene il limite di 3 in
 * 15 minuti anche fra richieste separate.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/trova-conto-ricerca.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import { RicordoErrate } from "@/lib/scanner/account-windows";
import { CredentialRunBudget } from "@/lib/scanner/credential-run-budget";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { WinrmError } from "@/lib/devices/winrm-run";
import { ContoLogonRicerca, MAX_LOGON_RIFIUTATI, FINESTRA_LOGON_MS } from "../conto-logon-ricerca";
import { provaCredenzialeSuHost, trovaCredenziale, type EsitoRicerca, type OpzioniRicerca } from "../trova";

void TEST_DATA_DIR;
const T = "TESTCONTORIC";
const PASSWORD = "S3greta!";
const HOST_COUNT = 20;

interface Banco {
  logon: () => number;
  /** Una richiesta separata per host, come il client: budget nuovo a ogni richiesta. */
  ricercaPerHost: (hostId: number, opzioni?: OpzioniRicerca) => Promise<EsitoRicerca>;
  /** Da quel momento il logon riesce. */
  riesce: () => void;
}

function banco(o: { verifica?: EsitoPassword } = {}): Banco {
  let logon = 0;
  let giusta = false;
  const deps = {
    ricerca: true,
    ricordo: new RicordoErrate(),
    verificaPassword: async () => o.verifica ?? ("non_so" as EsitoPassword),
    winrm: async () => {
      logon += 1;
      if (giusta) return "test";
      throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
    },
  };
  return {
    logon: () => logon,
    riesce: () => {
      giusta = true;
    },
    ricercaPerHost: (hostId, opzioni = {}) =>
      withTenant(T, async () => {
        const dbh = getTenantDb(T);
        return trovaCredenziale(
          dbh,
          hostId,
          "winrm",
          5985,
          async (credentialId) => {
            const e = await provaCredenzialeSuHost(dbh, credentialId, `10.61.0.${hostId}`, 5985, deps);
            return { ok: e.ok, errore: e.ok ? undefined : e.errore, nonProvata: !e.registra, trasporto: e.trasporto, passwordErrata: e.passwordErrata, passwordValida: e.passwordValida };
          },
          { budget: new CredentialRunBudget(() => undefined), ...opzioni },
        );
      }),
  };
}

describe("conto dei logon rifiutati della ricerca, fra richieste separate", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`INSERT INTO networks (id, cidr, name) VALUES (1, '10.61.0.0/24', 'prova')`).run();
      for (let i = 1; i <= HOST_COUNT; i++) d.prepare(`INSERT INTO hosts (id, network_id, ip) VALUES (?, 1, ?)`).run(i, `10.61.0.${i}`);
    });
  });
  after(() => deleteTenantDatabase(T));

  /** Una sola voce Windows alla volta: la ricerca prova tutte quelle che trova. */
  let progressivo = 0;
  function soloVoce(utente: string): number {
    progressivo += 1;
    const id = 200 + progressivo;
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare(`DELETE FROM credentials WHERE credential_type = 'windows'`).run();
      d.prepare(`INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, 'windows', ?, ?)`).run(
        id,
        `voce ${id}`,
        encrypt(utente),
        encrypt(PASSWORD),
      );
    });
    return id;
  }

  it("20 richieste separate, una per host, password non verificabile: al massimo 3 logon errati in tutto", async () => {
    soloVoce("CLIENTE\\solo-tre");
    const b = banco();
    const esiti: EsitoRicerca[] = [];
    for (let hostId = 1; hostId <= HOST_COUNT; hostId++) esiti.push(await b.ricercaPerHost(hostId));
    assert.equal(b.logon(), MAX_LOGON_RIFIUTATI);
    const ferme = esiti.slice(MAX_LOGON_RIFIUTATI).flatMap((e) => e.tentativi);
    assert.equal(ferme.length, HOST_COUNT - MAX_LOGON_RIFIUTATI);
    for (const t of ferme) {
      assert.equal(t.esito, "fermata");
      assert.match(t.motivo ?? "", /Troppi logon rifiutati.*3 in 15 minuti.*Riprova tra (circa \d+ minut|meno di un minuto)/);
    }
  });

  it("richieste in parallelo: il posto si prenota prima del logon, non se ne fanno più di 3", async () => {
    soloVoce("CLIENTE\\parallelo");
    const b = banco();
    await Promise.all(Array.from({ length: HOST_COUNT }, (_, i) => b.ricercaPerHost(i + 1)));
    assert.equal(b.logon(), MAX_LOGON_RIFIUTATI);
  });

  it("un logon riuscito azzera il conto: poi si può ricominciare", async () => {
    soloVoce("CLIENTE\\azzera");
    const b = banco();
    for (let hostId = 1; hostId <= 2; hostId++) await b.ricercaPerHost(hostId);
    assert.equal(b.logon(), 2);
    b.riesce();
    const riuscita = await b.ricercaPerHost(3);
    assert.equal(riuscita.trovata !== null, true);
    // il conto è a zero: la password torna sbagliata e i 3 logon sono di nuovo disponibili
    const c = banco();
    for (let hostId = 4; hostId <= 10; hostId++) await c.ricercaPerHost(hostId);
    assert.equal(c.logon(), MAX_LOGON_RIFIUTATI);
  });

  it("il conto è per utente normalizzato: due forme dello stesso account contano insieme", async () => {
    const b = banco();
    soloVoce("CLIENTE\\forme");
    for (let hostId = 1; hostId <= 2; hostId++) await b.ricercaPerHost(hostId);
    soloVoce("forme@cliente.local");
    for (let hostId = 3; hostId <= 8; hostId++) await b.ricercaPerHost(hostId);
    assert.equal(b.logon(), MAX_LOGON_RIFIUTATI);
  });

  it("account locale: nessun conto, come prima", async () => {
    soloVoce("amministratore");
    const b = banco();
    for (let hostId = 1; hostId <= 10; hostId++) await b.ricercaPerHost(hostId);
    assert.equal(b.logon() > MAX_LOGON_RIFIUTATI, true);
  });

  it("il DC dice che la password è giusta e l'host rifiuta (diritti mancanti): non è un logon errato, non consuma il conto", async () => {
    soloVoce("CLIENTE\\diritti");
    const b = banco({ verifica: "valida" });
    for (let hostId = 1; hostId <= 10; hostId++) await b.ricercaPerHost(hostId);
    assert.equal(b.logon(), 10);
  });
});

describe("ContoLogonRicerca", () => {
  it("la finestra scade: passati 15 minuti i posti tornano, e il messaggio dice quanto manca", () => {
    let ora = 1_000_000;
    const conto = new ContoLogonRicerca(() => ora);
    for (let i = 0; i < MAX_LOGON_RIFIUTATI; i++) {
      const p = conto.prenota("cliente@dom");
      assert.equal(p.ok, true);
      if (p.ok) p.rifiutato();
      ora += 60_000;
    }
    const fermata = conto.prenota("cliente@dom");
    assert.equal(fermata.ok, false);
    if (!fermata.ok) assert.equal(fermata.attesaMs, FINESTRA_LOGON_MS - 3 * 60_000);
    ora += FINESTRA_LOGON_MS;
    assert.equal(conto.prenota("cliente@dom").ok, true);
  });

  it("senza esito il posto prenotato si libera: un logon mai partito non conta", () => {
    const conto = new ContoLogonRicerca(() => 1);
    for (let i = 0; i < 10; i++) {
      const p = conto.prenota("cliente@dom");
      assert.equal(p.ok, true);
      if (p.ok) p.nessunLogon();
    }
  });

  it("utenti diversi hanno conti diversi", () => {
    const conto = new ContoLogonRicerca(() => 1);
    for (let i = 0; i < MAX_LOGON_RIFIUTATI; i++) {
      const p = conto.prenota("a@dom");
      if (p.ok) p.rifiutato();
    }
    assert.equal(conto.prenota("a@dom").ok, false);
    assert.equal(conto.prenota("b@dom").ok, true);
  });
});
