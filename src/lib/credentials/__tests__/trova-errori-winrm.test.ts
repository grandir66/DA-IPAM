/**
 * La prova della voce Windows legge `WinrmError` come il motore, non il testo del messaggio (revisione finale, 04/11/2026).
 *
 * Il messaggio vero di una porta chiusa («Porte WinRM 5985/5986 chiuse») non contiene le impronte di `classifyWinrmError`: la
 * prova lo prendeva per un rifiuto, escludeva la voce e consumava un posto del conto senza che fosse partito nessun logon.
 * Al contrario un timeout dopo l'avvio del bridge era «host non raggiungibile», e un rifiuto nascosto da un timeout non
 * contava. E con la password verificata giusta un rifiuto toglieva la validazione: mancano i diritti, la voce vale.
 *
 * I messaggi sono quelli veri: passa da `runWinrmCommand` con le uscite di processo finte.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/trova-errori-winrm.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { deleteTenantDatabase, getTenantDb, withTenant } from "@/lib/db-tenant";
import { provaBinding } from "@/lib/devices/prova-binding";
import { runWinrmCommand, WinrmError, type DipendenzeWinrm, type OpzioniWinrm } from "@/lib/devices/winrm-run";
import { RicordoErrate } from "@/lib/scanner/account-windows";
import { CredentialRunBudget } from "@/lib/scanner/credential-run-budget";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { ContoLogonRicerca, MAX_LOGON_RIFIUTATI } from "../conto-logon-ricerca";
import { esitoDellaRicerca, provaCredenzialeSuHost, registraProva, trovaCredenziale, type EsitoProvaSuHost, type OpzioniProvaSuHost } from "../trova";

void TEST_DATA_DIR;
const T = "TESTERRWINRM";
const VOCE = 500;
const UTENTE = "CLIENTE\\errori";
const IP = "10.63.0.1";

/** La risposta del bridge: stdout JSON, o il processo ucciso dal tetto. */
function bridge(risposta: Record<string, unknown> | "ucciso"): Partial<DipendenzeWinrm> {
  return {
    checkWinrmReachability: async () => ({ reachable: true, summary: "open", results: [] }),
    trovaPython: () => "/finto/python3",
    execFile(_file, _args, _opts, cb) {
      setImmediate(() => {
        if (risposta === "ucciso") cb(Object.assign(new Error("Command failed"), { killed: true }), "", "");
        else cb(null, JSON.stringify(risposta), "");
      });
      return { stdin: { write: () => true, end: () => undefined } };
    },
  };
}

const SCENE = {
  portaChiusa: { checkWinrmReachability: async () => ({ reachable: false, summary: "closed", results: [] }) } as Partial<DipendenzeWinrm>,
  portaMuta: { checkWinrmReachability: async () => ({ reachable: false, summary: "timeout", results: [] }) } as Partial<DipendenzeWinrm>,
  senzaPywinrm: bridge({ error: "Modulo Python pywinrm assente: No module named winrm. Sul server DA-IPAM: installa." }),
  wsman: bridge({ stdout: "", stderr: "bad command name hostname (line 1 column 1)" }),
  timeout: bridge("ucciso"),
  rifiuto: bridge({ error: "the specified credentials were rejected by the server", errorCode: "AUTH_REJECTED", rifiutato: true }),
  rifiutoNascosto: bridge({ error: "Read timed out", errorCode: "UNKNOWN", rifiutato: true }),
};

function dipendenze(verifica: EsitoPassword, scena: Partial<DipendenzeWinrm>): OpzioniProvaSuHost {
  return {
    ricerca: true,
    ricordo: new RicordoErrate(),
    verificaPassword: async () => verifica,
    winrm: (h, p, u, pw, c, ps, r, o?: OpzioniWinrm) => runWinrmCommand(h, p, u, pw, c, ps, r, o, scena as DipendenzeWinrm),
  };
}

const prova = (verifica: EsitoPassword, scena: Partial<DipendenzeWinrm>): Promise<EsitoProvaSuHost> =>
  withTenant(T, () => provaCredenzialeSuHost(getTenantDb(T), VOCE, IP, 5985, dipendenze(verifica, scena)));

/** Una ricerca sull'host 1, col conto dato. */
const cerca = (verifica: EsitoPassword, scena: Partial<DipendenzeWinrm>, conto: ContoLogonRicerca) =>
  withTenant(T, async () => {
    const dbh = getTenantDb(T);
    return trovaCredenziale(
      dbh,
      1,
      "winrm",
      5985,
      async (id) => esitoDellaRicerca(await provaCredenzialeSuHost(dbh, id, IP, 5985, dipendenze(verifica, scena))),
      { budget: new CredentialRunBudget(() => undefined), conto },
    );
  });

interface Riga {
  validated: number;
  fail_count: number;
  motivo: string | null;
  last_error: string | null;
  backoff_until: string | null;
}
const riga = (): Riga | undefined =>
  withTenant(T, () => getTenantDb(T).prepare("SELECT validated, fail_count, motivo, last_error, backoff_until FROM host_credentials WHERE host_id = 1 AND credential_id = ?").get(VOCE) as Riga | undefined);
const esiti = () => withTenant(T, () => getTenantDb(T).prepare("SELECT strada, motivo FROM accesso_windows_esiti ORDER BY strada").all());
const validata = (): void => {
  withTenant(T, () => getTenantDb(T).prepare("INSERT INTO host_credentials (host_id, credential_id, protocol_type, port, validated) VALUES (1, ?, 'winrm', 5985, 1)").run(VOCE));
};
/** Quanti posti restano nel conto dopo la ricerca. */
function postiLiberi(conto: ContoLogonRicerca): number {
  let liberi = 0;
  for (let i = 0; i < MAX_LOGON_RIFIUTATI + 1; i++) if (conto.prenota("errori@cliente", "x").ok) liberi += 1;
  return liberi;
}

describe("gli errori di WinRM, letti come il motore", () => {
  before(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare("INSERT INTO networks (id, cidr, name) VALUES (1, '10.63.0.0/24', 'prova')").run();
      d.prepare("INSERT INTO hosts (id, network_id, ip) VALUES (1, 1, ?)").run(IP);
      d.prepare("INSERT INTO credentials (id, name, credential_type, encrypted_username, encrypted_password) VALUES (?, 'voce', 'windows', ?, ?)").run(VOCE, encrypt(UTENTE), encrypt("S3greta!"));
    });
  });
  beforeEach(() => {
    withTenant(T, () => {
      const d = getTenantDb(T);
      d.prepare("DELETE FROM host_credentials").run();
      d.prepare("DELETE FROM accesso_windows_esiti").run();
    });
  });
  after(() => {
    deleteTenantDatabase(T);
    closeHubDb();
  });

  describe("nessun logon è partito o non è un rifiuto: niente conto, niente fallimenti, niente esclusioni", () => {
    for (const [nome, scena] of [["porta chiusa", SCENE.portaChiusa], ["porta muta prima del bridge", SCENE.portaMuta], ["pywinrm assente", SCENE.senzaPywinrm], ["WSMAN_FAULT", SCENE.wsman]] as const) {
      it(nome, async () => {
        const conto = new ContoLogonRicerca();
        for (let i = 0; i < 2; i++) {
          const r = await cerca("non_so", scena, conto);
          assert.equal(r.tentativi[0].esito, "fermata", "una voce mai esclusa si riprova");
        }
        assert.equal(riga(), undefined);
        assert.deepEqual(esiti(), []);
        assert.equal(postiLiberi(conto), MAX_LOGON_RIFIUTATI);
      });
    }

    it("la prova dice porta chiusa come trasporto, non come rifiuto", async () => {
      const e = await prova("non_so", SCENE.portaChiusa);
      assert.equal(e.trasporto, true);
      assert.match(e.errore ?? "", /Porte WinRM 5985\/5986 chiuse/, "il messaggio è quello vero");
    });

    it("pywinrm assente: la prova non lascia traccia da registrare", async () => {
      const e = await prova("non_so", SCENE.senzaPywinrm);
      assert.equal(e.registra, false);
      assert.equal(e.trasporto, false);
    });
  });

  describe("timeout dopo l'avvio del bridge: un rifiuto possibile, come nel motore", () => {
    it("password non verificata: consuma il posto e il fermo, ma non toglie la validazione", async () => {
      validata();
      const conto = new ContoLogonRicerca();
      await cerca("non_so", SCENE.timeout, conto);
      const r = riga();
      assert.deepEqual([r?.validated, r?.fail_count, r?.motivo], [1, 1, "errore"]);
      assert.ok(r?.backoff_until, "il fermo c'è");
      assert.equal(postiLiberi(conto), MAX_LOGON_RIFIUTATI - 1);
    });

    it("il tetto della prova sul logon è lo stesso caso", async () => {
      const e = await withTenant(T, () =>
        provaCredenzialeSuHost(getTenantDb(T), VOCE, IP, 5985, { ...dipendenze("non_so", SCENE.timeout), tettoMs: 5, winrm: () => new Promise(() => undefined) }),
      );
      assert.equal(e.trasporto, false);
      assert.equal(e.rifiutoPossibile, true);
    });

    it("password verificata giusta: host muto, non conta e non scrive", async () => {
      const conto = new ContoLogonRicerca();
      const r = await cerca("valida", SCENE.timeout, conto);
      assert.equal(r.tentativi[0].esito, "fermata");
      assert.equal(riga(), undefined);
      assert.equal(postiLiberi(conto), MAX_LOGON_RIFIUTATI);
    });
  });

  describe("il rifiuto vero", () => {
    it("password non verificata: fallimento pieno e posto consumato, anche se l'ultimo errore era un timeout", async () => {
      for (const scena of [SCENE.rifiuto, SCENE.rifiutoNascosto]) {
        withTenant(T, () => getTenantDb(T).prepare("DELETE FROM host_credentials").run());
        validata();
        const conto = new ContoLogonRicerca();
        const r = await cerca("non_so", scena, conto);
        assert.equal(r.tentativi[0].esito, "rifiutata");
        assert.equal(riga()?.validated, 0);
        assert.equal(postiLiberi(conto), MAX_LOGON_RIFIUTATI - 1);
      }
    });

    it("password verificata giusta: diritti mancanti, validazione e fermo non si toccano", async () => {
      validata();
      const conto = new ContoLogonRicerca();
      const r = await cerca("valida", SCENE.rifiuto, conto);
      assert.equal(r.tentativi[0].esito, "diritti_mancanti");
      const scritta = riga();
      assert.deepEqual([scritta?.validated, scritta?.fail_count, scritta?.motivo, scritta?.backoff_until], [1, 0, "diritti_mancanti", null]);
      assert.deepEqual(esiti(), [{ strada: "winrm", motivo: "diritti_mancanti" }]);
      assert.equal(postiLiberi(conto), MAX_LOGON_RIFIUTATI);
    });

    it("il pulsante Test scrive lo stesso: `registraProva` con la risposta della prova", async () => {
      validata();
      const e = await prova("valida", SCENE.rifiuto);
      assert.equal(e.motivo, "diritti_mancanti");
      assert.equal(e.risposta.motivo, "diritti_mancanti");
      withTenant(T, () => registraProva(1, VOCE, "winrm", 5985, e));
      assert.deepEqual([riga()?.validated, riga()?.motivo], [1, "diritti_mancanti"]);
    });
  });

  describe("provaBinding", () => {
    const legame = (protocollo: "winrm" | "wmi") => ({
      credential_id: null,
      inline_username: `CLIENTE\\legame-${protocollo}`,
      inline_encrypted_password: encrypt("S3greta!"),
      protocol_type: protocollo,
      port: protocollo === "wmi" ? 135 : 5985,
    });

    it("WinRM con la password verificata giusta: esito diritti mancanti", async () => {
      const r = await provaBinding(IP, legame("winrm"), "1", {
        ricordo: new RicordoErrate(),
        verificaPassword: async () => "valida",
        winrm: async () => {
          throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
        },
      });
      assert.equal(r.success, false);
      assert.equal(r.motivo, "diritti_mancanti");
    });

    it("WMI con la password verificata giusta: esito diritti mancanti", async () => {
      const { WmiError } = await import("@/lib/devices/wmi-run");
      const r = await provaBinding(IP, legame("wmi"), "1", {
        ricordo: new RicordoErrate(),
        verificaPassword: async () => "valida",
        wmiIdentita: async () => {
          throw new WmiError({ code: "AUTH_REJECTED", message: "rpc_s_access_denied" });
        },
      });
      assert.equal(r.motivo, "diritti_mancanti");
    });

    it("password non verificata: nessun motivo, il rifiuto resta un rifiuto", async () => {
      const r = await provaBinding(IP, { ...legame("winrm"), inline_username: "CLIENTE\\legame-nonso" }, "1", {
        ricordo: new RicordoErrate(),
        verificaPassword: async () => "non_so",
        winrm: async () => {
          throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
        },
      });
      assert.equal(r.motivo, undefined);
    });
  });
});
