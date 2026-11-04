/**
 * Prove del motore di accesso Windows (piano accesso Windows, Task 4): una per ogni riga della tabella del piano,
 * più i casi che hanno motivato il lavoro. Niente rete né DB: le prove WinRM/WMI sono doppi, ma lanciano le classi
 * d'errore vere; budget e verifica sono quelli veri.
 *
 * Incidente: 72729, 04/11/2026. 12 PC rifiutano un account di dominio con password giusta. La scansione deve provarli
 * tutti e dire «diritti mancanti», non fermarsi dopo 3.
 *
 * Run: node --import tsx --test src/lib/scanner/__tests__/accesso-windows.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORDINE_MOTIVI,
  motivoPiuUtile,
  portaDellaStrada,
  provaAccessoWindows,
  stradeDaProvare,
  type EsitoAccesso,
  type MotivoAccesso,
  type ProvaWinrm,
  type ProvaWmi,
} from "../accesso-windows";
import { CredentialRunBudget } from "../credential-run-budget";
import { MAX_CONSECUTIVE_FAILURES_PER_RUN } from "../credential-anti-lockout";
import { VerificaPasswordRun, type EsitoPassword } from "../verifica-password-run";
import { runWinrmCommand, WinrmError } from "@/lib/devices/winrm-run";
import { runWmiIdentita, WmiError } from "@/lib/devices/wmi-run";
import type { WinrmErrorCode } from "@/lib/devices/winrm-errors";

const CRED = 7;
const UTENTE = "DOMINIO\\mario.rossi";
const PASSWORD = "Sup3r-Segreta!";
const NOW = "2026-11-04T10:00:00.000Z";
const FUTURO = "2026-11-04T11:00:00.000Z";
const SOLO_WINRM = [445, 5985];
const SOLO_WMI = [135, 445];
const ENTRAMBE = [135, 5985];

// Le funzioni vere devono entrare nei tipi delle prove: se la firma si sposta, qui non compila.
const proveVere: { winrm: ProvaWinrm; wmi: ProvaWmi } = { winrm: runWinrmCommand, wmi: runWmiIdentita };

const errWinrm = (code: WinrmErrorCode, message = "messaggio del bridge") => new WinrmError({ code, message });
const errWmi = (code: WinrmErrorCode, message = "messaggio del bridge") => new WmiError({ code, message });

interface Scena {
  ip?: string;
  porte?: readonly number[];
  password?: EsitoPassword;
  winrm?: ProvaWinrm;
  wmi?: ProvaWmi;
  backoff?: Partial<Record<"winrm" | "wmi", string>>;
  budget?: CredentialRunBudget;
  verifica?: VerificaPasswordRun;
}

/** Una prova col suo conto delle chiamate. */
function contatore() {
  const conto = { winrm: 0, wmi: 0, verifiche: 0 };
  const winrmOk: ProvaWinrm = async () => {
    conto.winrm++;
    return "PC-01";
  };
  const wmiOk: ProvaWmi = async () => {
    conto.wmi++;
    return { hostname: "PC-01" };
  };
  const winrmKo = (e: unknown): ProvaWinrm => async () => {
    conto.winrm++;
    throw e;
  };
  const wmiKo = (e: unknown): ProvaWmi => async () => {
    conto.wmi++;
    throw e;
  };
  const verifica = (esito: EsitoPassword) =>
    new VerificaPasswordRun({
      ldap: async () => {
        conto.verifiche++;
        return esito;
      },
      smb: async () => "non_so",
    });
  return { conto, winrmOk, wmiOk, winrmKo, wmiKo, verifica };
}

async function prova(s: Scena): Promise<EsitoAccesso> {
  const c = contatore();
  return provaAccessoWindows({
    ip: s.ip ?? "10.0.0.1",
    hostId: 1,
    credId: CRED,
    porteAperte: s.porte ?? ENTRAMBE,
    username: UTENTE,
    password: PASSWORD,
    dominioAd: "dominio.local",
    verifica: s.verifica ?? c.verifica(s.password ?? "valida"),
    budget: s.budget ?? new CredentialRunBudget(() => {}),
    backoffDi: (strada) => s.backoff?.[strada] ?? null,
    nowIso: NOW,
    prova: { winrm: s.winrm ?? c.winrmOk, wmi: s.wmi ?? c.wmiOk },
  });
}

describe("proveVere", () => {
  it("runWinrmCommand e runWmiIdentita entrano nei tipi delle prove", () => {
    assert.equal(typeof proveVere.winrm, "function");
    assert.equal(typeof proveVere.wmi, "function");
  });
});

describe("stradeDaProvare", () => {
  const casi: Array<[readonly number[], string[]]> = [
    [[5985, 135], ["winrm", "wmi"]],
    [[5986, 135], ["winrm", "wmi"]],
    [[5985, 5986, 135], ["winrm", "wmi"]],
    [[135, 5985], ["winrm", "wmi"]],
    [[5985], ["winrm"]],
    [[5986], ["winrm"]],
    [[135], ["wmi"]],
    [[445, 139, 3389], []],
    [[], []],
  ];
  for (const [porte, attese] of casi) {
    it(`${JSON.stringify(porte)} → ${JSON.stringify(attese)}`, () => {
      assert.deepEqual(stradeDaProvare(porte), attese);
    });
  }
});

describe("portaDellaStrada", () => {
  it("come pickWinrmPort: 5986 solo se la 5985 non c'è", () => {
    assert.equal(portaDellaStrada("winrm", [5985, 5986]), 5985);
    assert.equal(portaDellaStrada("winrm", [5986, 5985]), 5985);
    assert.equal(portaDellaStrada("winrm", [5986]), 5986);
    assert.equal(portaDellaStrada("wmi", [135, 5985]), 135);
  });

  it("la prova WinRM riceve porta, hostname, powershell spento e realm", async () => {
    const chiamate: unknown[][] = [];
    await prova({
      porte: [5986],
      winrm: async (...args) => {
        chiamate.push(args);
        return "PC-01";
      },
    });
    assert.deepEqual(chiamate, [["10.0.0.1", 5986, UTENTE, PASSWORD, "hostname", false, "dominio.local"]]);
  });

  it("la prova WMI riceve ip, utente e password", async () => {
    const chiamate: unknown[][] = [];
    await prova({
      porte: [135],
      wmi: async (...args) => {
        chiamate.push(args);
        return { hostname: "PC-01" };
      },
    });
    assert.deepEqual(chiamate, [["10.0.0.1", UTENTE, PASSWORD]]);
  });
});

describe("tabella del piano", () => {
  it("riga 1: valida + riuscita → ok, recordSuccess, nessuna strada dopo", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    budget.recordFailure(CRED);
    const e = await prova({ budget, winrm: c.winrmOk, wmi: c.wmiOk });
    assert.equal(e.motivo, "ok");
    assert.equal(e.strada, "winrm");
    assert.equal(e.nomeHost, "PC-01");
    assert.equal(budget.consecutiveFailures(CRED), 0);
    assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 0]);
  });

  it("riga 2: valida + AUTH_REJECTED → diritti_mancanti, recordDenied, si passa alla strada dopo", async () => {
    const c = contatore();
    const righe: string[] = [];
    const budget = new CredentialRunBudget((m) => righe.push(m));
    budget.recordFailure(CRED);
    const e = await prova({ budget, winrm: c.winrmKo(errWinrm("AUTH_REJECTED")), wmi: c.wmiKo(errWmi("AUTH_REJECTED")) });
    assert.equal(e.motivo, "diritti_mancanti");
    assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 1]);
    assert.equal(budget.consecutiveFailures(CRED), 1, "lo streak non si tocca");
    budget.logSummary();
    assert.ok(righe.some((r) => r.includes("#7")), "i rifiuti arrivano al riepilogo");
  });

  it("riga 2 bis: WinRM rifiutato e WMI riuscito → ok su wmi", async () => {
    const c = contatore();
    const e = await prova({ winrm: c.winrmKo(errWinrm("AUTH_REJECTED")), wmi: c.wmiOk });
    assert.equal(e.motivo, "ok");
    assert.equal(e.strada, "wmi");
  });

  it("riga 3: non_so + AUTH_REJECTED → errore, recordFailure, ci si ferma", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    const e = await prova({ password: "non_so", budget, winrm: c.winrmKo(errWinrm("AUTH_REJECTED")), wmi: c.wmiOk });
    assert.equal(e.motivo, "errore");
    assert.equal(e.strada, "winrm");
    assert.equal(budget.consecutiveFailures(CRED), 1);
    assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 0]);
  });

  for (const password of ["valida", "non_so"] as const) {
    for (const codice of ["TCP_TIMEOUT", "BRIDGE_TIMEOUT"] as const) {
      it(`riga 4: ${password} + ${codice} con la 135 aperta → firewall, nessun budget, strada dopo`, async () => {
        const c = contatore();
        const budget = new CredentialRunBudget(() => {});
        const e = await prova({ password, budget, winrm: c.winrmKo(errWinrm(codice)), wmi: c.wmiKo(errWmi(codice)) });
        assert.equal(e.motivo, "firewall");
        assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 1]);
        assert.equal(budget.consecutiveFailures(CRED), 0);
      });
    }

    it(`riga 4: ${password} + TCP_TIMEOUT senza la 135 → errore, non firewall`, async () => {
      const c = contatore();
      const e = await prova({ password, porte: SOLO_WINRM, winrm: c.winrmKo(errWinrm("TCP_TIMEOUT")) });
      assert.equal(e.motivo, "errore");
    });

    for (const codice of ["PYWINRM_MISSING", "WSMAN_FAULT"] as const) {
      it(`riga 5: ${password} + ${codice} → errore, nessun budget, strada dopo`, async () => {
        const c = contatore();
        const budget = new CredentialRunBudget(() => {});
        const e = await prova({ password, budget, winrm: c.winrmKo(errWinrm(codice)), wmi: c.wmiKo(errWmi(codice)) });
        assert.equal(e.motivo, "errore");
        assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 1]);
        assert.equal(budget.consecutiveFailures(CRED), 0);
      });
    }

    it(`riga 5: ${password} + TCP_CLOSED → porte_chiuse, nessun budget, strada dopo`, async () => {
      const c = contatore();
      const budget = new CredentialRunBudget(() => {});
      const e = await prova({ password, budget, winrm: c.winrmKo(errWinrm("TCP_CLOSED")), wmi: c.wmiKo(errWmi("TCP_CLOSED")) });
      assert.equal(e.motivo, "porte_chiuse");
      assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 1]);
      assert.equal(budget.consecutiveFailures(CRED), 0);
    });
  }
});

describe("password non verificabile: ogni errore che può nascondere un logon rifiutato conta", () => {
  const dubbi: Array<[string, unknown]> = [
    ["KERBEROS_FAILED", errWinrm("KERBEROS_FAILED")],
    ["KERBEROS_ONLY", errWinrm("KERBEROS_ONLY")],
    ["BASIC_DISABLED", errWinrm("BASIC_DISABLED")],
    ["UNKNOWN", errWinrm("UNKNOWN")],
    ["errore qualsiasi", new Error("guasto imprevisto")],
    ["codice sconosciuto dal bridge", errWinrm("CODICE_NUOVO" as string as WinrmErrorCode)],
  ];
  for (const [nome, errore] of dubbi) {
    it(`non_so + ${nome} → errore, recordFailure, ci si ferma`, async () => {
      const c = contatore();
      const budget = new CredentialRunBudget(() => {});
      const e = await prova({ password: "non_so", budget, winrm: c.winrmKo(errore), wmi: c.wmiOk });
      assert.equal(e.motivo, "errore");
      assert.equal(budget.consecutiveFailures(CRED), 1);
      assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 0]);
    });

    it(`valida + ${nome} → errore, nessun budget, strada dopo`, async () => {
      const c = contatore();
      const budget = new CredentialRunBudget(() => {});
      const e = await prova({ password: "valida", budget, winrm: c.winrmKo(errore), wmi: c.wmiOk });
      assert.equal(e.motivo, "ok");
      assert.equal(budget.consecutiveFailures(CRED), 0);
      assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 1]);
    });
  }

  it("non_so con firewall su WinRM e rifiuto su WMI: conta il rifiuto, sulla strada del rifiuto", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    const e = await prova({
      password: "non_so",
      budget,
      winrm: c.winrmKo(errWinrm("TCP_TIMEOUT")),
      wmi: c.wmiKo(errWmi("AUTH_REJECTED")),
    });
    assert.equal(e.motivo, "errore");
    assert.equal(e.strada, "wmi");
    assert.equal(budget.consecutiveFailures(CRED), 1);
    assert.match(e.dettaglio, /WinRM/);
    assert.match(e.dettaglio, /WMI/);
  });
});

describe("risposta vuota da WinRM", () => {
  it("non è un accesso: niente recordSuccess, errore, strada dopo", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    budget.recordFailure(CRED);
    const e = await prova({
      porte: SOLO_WINRM,
      budget,
      winrm: async () => "   ",
    });
    assert.equal(e.motivo, "errore");
    assert.equal(budget.consecutiveFailures(CRED), 1);
    assert.equal(c.conto.wmi, 0);
  });

  it("passa a WMI", async () => {
    const e = await prova({ winrm: async () => "" });
    assert.equal(e.motivo, "ok");
    assert.equal(e.strada, "wmi");
  });
});

describe("password errata", () => {
  it("zero tentativi su 50 macchine, una verifica sola, un fallimento solo sul budget", async () => {
    const c = contatore();
    const verifica = c.verifica("errata");
    const budget = new CredentialRunBudget(() => {});
    for (let i = 0; i < 50; i++) {
      const e = await prova({
        ip: `10.0.0.${i}`,
        verifica,
        budget,
        winrm: c.winrmOk,
        wmi: c.wmiOk,
      });
      assert.equal(e.motivo, "password_errata", `host ${i}`);
      assert.equal(e.strada, null);
    }
    assert.deepEqual(c.conto, { winrm: 0, wmi: 0, verifiche: 1 });
    assert.equal(budget.consecutiveFailures(CRED), 1);
  });
});

describe("porte chiuse", () => {
  it("nessun login, nessuna verifica, budget intatto", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    budget.recordFailure(CRED);
    const e = await prova({
      porte: [445, 3389],
      verifica: c.verifica("valida"),
      budget,
      winrm: c.winrmOk,
      wmi: c.wmiOk,
    });
    assert.equal(e.motivo, "porte_chiuse");
    assert.equal(e.strada, null);
    assert.deepEqual(c.conto, { winrm: 0, wmi: 0, verifiche: 0 });
    assert.equal(budget.consecutiveFailures(CRED), 1);
  });

  it("con budget esaurito resta porte_chiuse: non conta come tentativo risparmiato", async () => {
    const righe: string[] = [];
    const budget = new CredentialRunBudget((m) => righe.push(m));
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(CRED);
    const e = await prova({ porte: [], budget });
    assert.equal(e.motivo, "porte_chiuse");
    assert.deepEqual(righe, []);
  });
});

describe("gate del budget", () => {
  function esaurito(): CredentialRunBudget {
    const budget = new CredentialRunBudget(() => {});
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(CRED);
    return budget;
  }

  it("budget esaurito: nessun tentativo e nemmeno la verifica, che è un logon", async () => {
    const c = contatore();
    const e = await prova({ budget: esaurito(), verifica: c.verifica("valida"), winrm: c.winrmOk, wmi: c.wmiOk });
    assert.equal(e.motivo, "budget_esaurito");
    assert.equal(e.strada, null);
    assert.deepEqual(c.conto, { winrm: 0, wmi: 0, verifiche: 0 });
  });

  it("un host bloccato conta un solo tentativo risparmiato nel riepilogo", async () => {
    const righe: string[] = [];
    const budget = new CredentialRunBudget((m) => righe.push(m));
    for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(CRED);
    await prova({ budget });
    budget.logSummary();
    assert.ok(righe.some((r) => r.includes("1 tentativi successivi risparmiati")), righe.join("\n"));
  });

  it("il gate si richiede prima di ogni strada: budget finito fra le due, WMI non parte", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    const e = await prova({
      budget,
      winrm: async () => {
        c.conto.winrm++;
        for (let i = 0; i < MAX_CONSECUTIVE_FAILURES_PER_RUN; i++) budget.recordFailure(CRED);
        throw errWinrm("TCP_TIMEOUT");
      },
      wmi: c.wmiOk,
    });
    assert.deepEqual([c.conto.winrm, c.conto.wmi], [1, 0]);
    assert.equal(e.motivo, "firewall", "la strada provata dice il suo esito");
    assert.equal(e.strada, "winrm");
  });

  it("backoff su tutte le strade: errore, strada null, dettaglio chiaro, nessun tentativo, budget intatto", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    const e = await prova({ budget, backoff: { winrm: FUTURO, wmi: FUTURO }, winrm: c.winrmOk, wmi: c.wmiOk });
    assert.equal(e.motivo, "errore");
    assert.equal(e.strada, null, "strada null: su questo host non è partito nessun login");
    assert.match(e.dettaglio, /backoff/);
    assert.ok(e.dettaglio.includes(FUTURO));
    assert.deepEqual([c.conto.winrm, c.conto.wmi], [0, 0]);
    assert.equal(budget.consecutiveFailures(CRED), 0);
  });

  it("backoff solo su WinRM: si prova WMI", async () => {
    const c = contatore();
    const e = await prova({ backoff: { winrm: FUTURO }, winrm: c.winrmOk, wmi: c.wmiOk });
    assert.equal(e.motivo, "ok");
    assert.equal(e.strada, "wmi");
    assert.deepEqual([c.conto.winrm, c.conto.wmi], [0, 1]);
  });

  it("backoffDi riceve strada e porta effettiva", async () => {
    const viste: Array<[string, number]> = [];
    const c = contatore();
    await provaAccessoWindows({
      ip: "10.0.0.1",
      hostId: 1,
      credId: CRED,
      porteAperte: [135, 5986],
      username: UTENTE,
      password: PASSWORD,
      dominioAd: "",
      verifica: c.verifica("valida"),
      budget: new CredentialRunBudget(() => {}),
      backoffDi: (strada, porta) => {
        viste.push([strada, porta]);
        return null;
      },
      nowIso: NOW,
      prova: { winrm: c.winrmKo(errWinrm("AUTH_REJECTED")), wmi: c.wmiOk },
    });
    assert.deepEqual(viste, [["winrm", 5986], ["wmi", 135]]);
  });
});

describe("casi che hanno motivato il lavoro", () => {
  it("72729: 12 PC rifiutano l'account con password giusta, tutti provati, nessuna esclusione", async () => {
    const c = contatore();
    const verifica = c.verifica("valida");
    const budget = new CredentialRunBudget(() => {});
    for (let i = 0; i < 12; i++) {
      const e = await prova({
        ip: `10.0.0.${i}`,
        porte: SOLO_WMI,
        verifica,
        budget,
        wmi: c.wmiKo(errWmi("AUTH_REJECTED")),
      });
      assert.equal(e.motivo, "diritti_mancanti", `PC ${i}`);
    }
    assert.equal(c.conto.wmi, 12);
    assert.equal(c.conto.verifiche, 1);
    assert.equal(budget.consecutiveFailures(CRED), 0);
  });

  it("password non verificabile e rifiuti: 3 tentativi, poi basta", async () => {
    const c = contatore();
    const verifica = c.verifica("non_so");
    const budget = new CredentialRunBudget(() => {});
    const motivi: MotivoAccesso[] = [];
    for (let i = 0; i < 6; i++) {
      const e = await prova({
        ip: `10.0.0.${i}`,
        porte: SOLO_WMI,
        verifica,
        budget,
        wmi: c.wmiKo(errWmi("AUTH_REJECTED")),
      });
      motivi.push(e.motivo);
    }
    assert.equal(c.conto.wmi, MAX_CONSECUTIVE_FAILURES_PER_RUN);
    assert.deepEqual(motivi, ["errore", "errore", "errore", "budget_esaurito", "budget_esaurito", "budget_esaurito"]);
  });

  it("5985 chiusa su tanti host: la voce non viene esclusa", async () => {
    const c = contatore();
    const budget = new CredentialRunBudget(() => {});
    for (let i = 0; i < 10; i++) {
      await prova({ ip: `10.0.0.${i}`, porte: SOLO_WINRM, budget, winrm: c.winrmKo(errWinrm("TCP_CLOSED")) });
    }
    assert.equal(c.conto.winrm, 10);
    assert.equal(budget.consecutiveFailures(CRED), 0);
  });
});

describe("motivo finale con due strade", () => {
  it("l'ordine è quello deciso", () => {
    assert.deepEqual(ORDINE_MOTIVI, ["ok", "password_errata", "diritti_mancanti", "firewall", "errore", "porte_chiuse"]);
  });

  for (let i = 0; i < ORDINE_MOTIVI.length; i++) {
    for (let j = i + 1; j < ORDINE_MOTIVI.length; j++) {
      it(`${ORDINE_MOTIVI[i]} vince su ${ORDINE_MOTIVI[j]}, nei due versi`, () => {
        assert.equal(motivoPiuUtile([ORDINE_MOTIVI[i], ORDINE_MOTIVI[j]]), ORDINE_MOTIVI[i]);
        assert.equal(motivoPiuUtile([ORDINE_MOTIVI[j], ORDINE_MOTIVI[i]]), ORDINE_MOTIVI[i]);
      });
    }
  }

  const coppie: Array<[WinrmErrorCode, WinrmErrorCode, MotivoAccesso, "winrm" | "wmi"]> = [
    ["AUTH_REJECTED", "TCP_TIMEOUT", "diritti_mancanti", "winrm"],
    ["TCP_TIMEOUT", "AUTH_REJECTED", "diritti_mancanti", "wmi"],
    ["TCP_CLOSED", "TCP_TIMEOUT", "firewall", "wmi"],
    ["PYWINRM_MISSING", "TCP_TIMEOUT", "firewall", "wmi"],
    ["TCP_CLOSED", "PYWINRM_MISSING", "errore", "wmi"],
    ["WSMAN_FAULT", "TCP_CLOSED", "errore", "winrm"],
  ];
  for (const [primo, secondo, atteso, strada] of coppie) {
    it(`WinRM ${primo} + WMI ${secondo} → ${atteso} su ${strada}`, async () => {
      const c = contatore();
      const e = await prova({ winrm: c.winrmKo(errWinrm(primo)), wmi: c.wmiKo(errWmi(secondo)) });
      assert.equal(e.motivo, atteso);
      assert.equal(e.strada, strada);
    });
  }

  it("il dettaglio racconta le due strade", async () => {
    const c = contatore();
    const e = await prova({ winrm: c.winrmKo(errWinrm("AUTH_REJECTED")), wmi: c.wmiKo(errWmi("TCP_TIMEOUT")) });
    assert.match(e.dettaglio, /WinRM/);
    assert.match(e.dettaglio, /WMI/);
  });
});

describe("il dettaglio non porta mai utente né password", () => {
  const sporco = [
    `logon di ${UTENTE} con ${PASSWORD} fallito`,
    `USER=${UTENTE.toUpperCase()} pass=${PASSWORD.toLowerCase()}`,
    `{"username":${JSON.stringify(UTENTE)},"password":${JSON.stringify(PASSWORD)}}`,
    `mario.rossi@dominio.local ha sbagliato ${PASSWORD}`,
  ];

  function assertPulito(testo: string) {
    const basso = testo.toLowerCase();
    assert.ok(!basso.includes(PASSWORD.toLowerCase()), testo);
    assert.ok(!basso.includes("mario.rossi"), testo);
  }

  sporco.forEach((messaggio, i) => {
    for (const codice of ["UNKNOWN", "WSMAN_FAULT", "AUTH_REJECTED", "TCP_TIMEOUT", "TCP_CLOSED"] as const) {
      for (const password of ["valida", "non_so"] as const) {
        it(`messaggio ${i} con ${codice}, password ${password}`, async () => {
          const c = contatore();
          const e = await prova({
            password,
            winrm: c.winrmKo(errWinrm(codice, messaggio)),
            wmi: c.wmiKo(errWmi(codice, messaggio)),
          });
          assertPulito(e.dettaglio);
        });
      }
    }
    it(`messaggio ${i} da un errore qualsiasi`, async () => {
      const c = contatore();
      const e = await prova({ winrm: c.winrmKo(new Error(messaggio)), wmi: c.wmiKo(messaggio) });
      assertPulito(e.dettaglio);
    });
  });

  it("password in dettaglio tagliata a metà: si maschera prima di tagliare", async () => {
    const c = contatore();
    const riempitivo = "x".repeat(190);
    const e = await prova({ porte: SOLO_WINRM, winrm: c.winrmKo(new Error(`${riempitivo} ${PASSWORD} coda`)) });
    assert.ok(!e.dettaglio.includes(PASSWORD.slice(0, 5)), e.dettaglio);
  });

  it("il testo dell'errore serve a chi legge: arriva, mascherato", async () => {
    const c = contatore();
    const e = await prova({
      porte: SOLO_WINRM,
      winrm: c.winrmKo(errWinrm("WSMAN_FAULT", `guasto del servizio per ${UTENTE}`)),
    });
    assert.match(e.dettaglio, /guasto del servizio/);
  });

  it("password vuota: il dettaglio non si riempie di asterischi", async () => {
    const c = contatore();
    const verifica = c.verifica("valida");
    const e = await provaAccessoWindows({
      ip: "10.0.0.1",
      hostId: 1,
      credId: CRED,
      porteAperte: SOLO_WINRM,
      username: "",
      password: "",
      dominioAd: "",
      verifica,
      budget: new CredentialRunBudget(() => {}),
      backoffDi: () => null,
      prova: { winrm: c.winrmKo(errWinrm("WSMAN_FAULT", "guasto")), wmi: c.wmiOk },
    });
    assert.match(e.dettaglio, /guasto/);
    assert.doesNotMatch(e.dettaglio, /\*\*\*/);
  });

  it("riuscita: il dettaglio non cita utente né nome del PC", async () => {
    const e = await prova({});
    assertPulito(e.dettaglio);
  });
});
