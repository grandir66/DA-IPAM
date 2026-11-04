// Verifica della password una volta per esecuzione (piano accesso Windows, Task 3).
// Il motore di scansione (Task 4) deve distinguere «password errata» da «diritti mancanti» senza fare logon errati
// ripetuti sullo stesso account: un logon errato per ogni host porterebbe al blocco dell'account in dominio.
// Regola dell'esito: `errata` solo con prova certa (LDAP `data 52e`, SMB STATUS_LOGON_FAILURE); un account
// disabilitato/scaduto/bloccato, un timeout, un errore di trasporto sono `non_so`.
//
// Niente rete. La classe riceve le prove; le prove vere si provano con il client LDAP finto, `execFile` finto e,
// per `smb-login.py`, con il vero script Python lanciato contro un finto modulo `impacket` creato dalla prova.
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { InvalidCredentialsError, type Client } from "ldapts";

import { encrypt } from "@/lib/crypto";
import { withTenant, getTenantDb, deleteTenantDatabase } from "@/lib/db-tenant";
import type { AdIntegration } from "@/lib/db";
import type { DipendenzeWmi, OpzioniExecFile } from "@/lib/devices/wmi-run";
import type { TcpProbeResult } from "@/lib/devices/tcp-precheck";
import { RicordoErrate, VALIDITA_ERRATA_MS } from "../account-windows";
import {
  VerificaPasswordRun,
  provaLdapDellaVoce,
  provaSmbDellaVoce,
  utenteDelDominio,
  type DipendenzeLdap,
  type DipendenzeSmb,
  type EsitoPassword,
} from "../verifica-password-run";

void TEST_DATA_DIR;
const T = "TESTVERPWD";
const dbt = () => getTenantDb(T);
const PASSWORD = "S3greta!mai-in-argomento";

/* ---------------------------------------------------------------- la classe */

type Prove = ConstructorParameters<typeof VerificaPasswordRun>[0];

function proveFinte(ldap: EsitoPassword | (() => Promise<EsitoPassword>), smb: EsitoPassword | (() => Promise<EsitoPassword>)) {
  const chiamate = { ldap: [] as number[], smb: [] as Array<[number, string]> };
  const prove: Prove = {
    ldap: async (id) => {
      chiamate.ldap.push(id);
      return typeof ldap === "function" ? ldap() : ldap;
    },
    smb: async (id, ip) => {
      chiamate.smb.push([id, ip]);
      return typeof smb === "function" ? smb() : smb;
    },
  };
  return { prove, chiamate };
}

describe("VerificaPasswordRun: i tre esiti", () => {
  for (const esito of ["valida", "errata"] as const) {
    it(`LDAP ${esito}: è l'esito, SMB non parte`, async () => {
      const { prove, chiamate } = proveFinte(esito, "non_so");
      assert.equal(await new VerificaPasswordRun(prove).esito(1, "10.0.0.5"), esito);
      assert.deepEqual(chiamate.smb, []);
    });
  }
  for (const esito of ["valida", "errata", "non_so"] as const) {
    it(`LDAP non_so, SMB ${esito}: è l'esito di SMB, sull'ip dato`, async () => {
      const { prove, chiamate } = proveFinte("non_so", esito);
      assert.equal(await new VerificaPasswordRun(prove).esito(7, "10.0.0.9"), esito);
      assert.deepEqual(chiamate.smb, [[7, "10.0.0.9"]]);
    });
  }
  it("una prova che lancia è non_so: un errore di trasporto non è una risposta", async () => {
    const { prove } = proveFinte(
      async () => {
        throw new Error("ECONNRESET");
      },
      async () => {
        throw new Error("EPIPE");
      },
    );
    assert.equal(await new VerificaPasswordRun(prove).esito(1, "10.0.0.5"), "non_so");
  });
  it("LDAP che lancia ma SMB risponde: vale SMB", async () => {
    const { prove } = proveFinte(
      async () => {
        throw new Error("boom");
      },
      "errata",
    );
    assert.equal(await new VerificaPasswordRun(prove).esito(1, "10.0.0.5"), "errata");
  });
});

describe("VerificaPasswordRun: una sola verifica per voce", () => {
  it("due chiamate contemporanee per la stessa voce fanno una verifica sola (si memorizza la Promise)", async () => {
    let sblocca: (e: EsitoPassword) => void = () => {};
    const ldapLento = () => new Promise<EsitoPassword>((r) => (sblocca = r));
    const { prove, chiamate } = proveFinte(ldapLento, "non_so");
    const run = new VerificaPasswordRun(prove);
    const a = run.esito(3, "10.0.0.1");
    const b = run.esito(3, "10.0.0.2");
    sblocca("errata");
    assert.deepEqual(await Promise.all([a, b]), ["errata", "errata"]);
    assert.deepEqual(chiamate.ldap, [3]);
  });
  it("una chiamata dopo la prima non rifà la verifica, nemmeno con un altro host", async () => {
    const { prove, chiamate } = proveFinte("non_so", "non_so");
    const run = new VerificaPasswordRun(prove);
    assert.equal(await run.esito(4, "10.0.0.1"), "non_so");
    assert.equal(await run.esito(4, "10.0.0.2"), "non_so");
    assert.equal(await run.esito(4, "10.0.0.3"), "non_so");
    assert.deepEqual(chiamate.ldap, [4]);
    assert.deepEqual(chiamate.smb, [[4, "10.0.0.1"]], "SMB una volta, sul primo host: non_so non ritenta altrove");
  });
  it("voci diverse hanno verifiche diverse; un'altra esecuzione (istanza) riparte da zero", async () => {
    const { prove, chiamate } = proveFinte("valida", "non_so");
    const run = new VerificaPasswordRun(prove);
    await run.esito(1, "10.0.0.1");
    await run.esito(2, "10.0.0.1");
    assert.deepEqual(chiamate.ldap, [1, 2]);
    await new VerificaPasswordRun(prove).esito(1, "10.0.0.1");
    assert.deepEqual(chiamate.ldap, [1, 2, 1]);
  });
});

/* ------------------------------------------------------------ utente/dominio */

describe("VerificaPasswordRun: per account, e l'errata fra un giro e l'altro", () => {
  it("due voci con lo stesso account: una verifica sola", async () => {
    const { prove, chiamate } = proveFinte("non_so", "non_so");
    const run = new VerificaPasswordRun(prove);
    await Promise.all([run.esito(1, "10.0.0.1", "acc"), run.esito(2, "10.0.0.2", "acc")]);
    assert.deepEqual(chiamate.ldap, [1]);
  });

  it("errata ricordata: al giro dopo nessun logon", async () => {
    const ricordo = new RicordoErrate();
    const primo = proveFinte("errata", "non_so");
    assert.equal(await new VerificaPasswordRun(primo.prove, ricordo).esito(1, "10.0.0.1", "acc"), "errata");
    const secondo = proveFinte("valida", "valida");
    assert.equal(await new VerificaPasswordRun(secondo.prove, ricordo).esito(1, "10.0.0.1", "acc"), "errata");
    assert.deepEqual([secondo.chiamate.ldap, secondo.chiamate.smb], [[], []]);
  });

  it("errata da SMB: si ricorda anche quella", async () => {
    const ricordo = new RicordoErrate();
    await new VerificaPasswordRun(proveFinte("non_so", "errata").prove, ricordo).esito(1, "10.0.0.1", "acc");
    assert.equal(ricordo.ricorda("acc"), true);
  });

  it("scaduto il ricordo si verifica di nuovo", async () => {
    const ora = { ms: 0 };
    const ricordo = new RicordoErrate(() => ora.ms);
    await new VerificaPasswordRun(proveFinte("errata", "non_so").prove, ricordo).esito(1, "10.0.0.1", "acc");
    ora.ms = VALIDITA_ERRATA_MS;
    const dopo = proveFinte("valida", "non_so");
    assert.equal(await new VerificaPasswordRun(dopo.prove, ricordo).esito(1, "10.0.0.1", "acc"), "valida");
    assert.deepEqual(dopo.chiamate.ldap, [1]);
  });

  it("valida e non_so non si ricordano: un timeout non è una risposta", async () => {
    for (const esito of ["valida", "non_so"] as const) {
      const ricordo = new RicordoErrate();
      await new VerificaPasswordRun(proveFinte(esito, "non_so").prove, ricordo).esito(1, "10.0.0.1", "acc");
      assert.equal(ricordo.ricorda("acc"), false, esito);
    }
  });

  it("un altro account non legge il ricordo", async () => {
    const ricordo = new RicordoErrate();
    ricordo.segna("acc");
    const { prove, chiamate } = proveFinte("valida", "non_so");
    assert.equal(await new VerificaPasswordRun(prove, ricordo).esito(1, "10.0.0.1", "altro"), "valida");
    assert.deepEqual(chiamate.ldap, [1]);
  });
});

describe("utenteDelDominio: l'account locale non si verifica su LDAP", () => {
  const dominio = "cliente.local";
  it("senza dominio (utente nudo) o con «.»: locale", () => {
    assert.equal(utenteDelDominio("scansioni", dominio), false);
    assert.equal(utenteDelDominio(".\\scansioni", dominio), false);
    assert.equal(utenteDelDominio("\\scansioni", dominio), false);
    assert.equal(utenteDelDominio("scansioni@", dominio), false);
  });
  it("dominio diverso da quello dell'integrazione (anche il nome del PC): locale", () => {
    assert.equal(utenteDelDominio("PC-CONTAB\\admin", dominio), false);
    assert.equal(utenteDelDominio("ALTRO\\admin", dominio), false);
    assert.equal(utenteDelDominio("admin@altro.local", dominio), false);
    assert.equal(utenteDelDominio("admin@cliente.com", dominio), false);
  });
  it("NetBIOS (primo pezzo del dominio), FQDN, UPN: del dominio, senza badare alle maiuscole", () => {
    assert.equal(utenteDelDominio("CLIENTE\\admin", dominio), true);
    assert.equal(utenteDelDominio("cliente\\admin", dominio), true);
    assert.equal(utenteDelDominio("cliente.local\\admin", dominio), true);
    assert.equal(utenteDelDominio("admin@cliente.local", dominio), true);
    assert.equal(utenteDelDominio("admin@CLIENTE.LOCAL", dominio), true);
  });
  it("un dominio dell'integrazione vuoto non riconosce nessuno", () => {
    assert.equal(utenteDelDominio("CLIENTE\\admin", ""), false);
  });
});

/* ------------------------------------------------------------------- LDAP */

const INTEGRAZIONE = { id: 1, name: "Dominio", dc_host: "127.0.0.1", domain: "cliente.local", use_ssl: 0, port: 389, enabled: 1 } as AdIntegration;

type Evento = string;
function clienteFinto(bind: () => Promise<void>, startTls: () => Promise<void> = async () => {}) {
  const eventi: Evento[] = [];
  const creati: Array<{ url: string }> = [];
  const nuovoClient = (opzioni: { url: string }): Client => {
    creati.push({ url: opzioni.url });
    return {
      startTLS: async () => {
        eventi.push("startTLS");
        await startTls();
      },
      bind: async (dn: string, password: string) => {
        eventi.push(`bind:${dn}`);
        void password;
        await bind();
      },
      unbind: async () => {
        eventi.push("unbind");
      },
    } as unknown as Client;
  };
  return { nuovoClient, eventi, creati };
}

function depsLdap(extra: Partial<DipendenzeLdap> & { utente?: string }, finto: ReturnType<typeof clienteFinto>): Partial<DipendenzeLdap> {
  return {
    account: () => ({ username: extra.utente ?? "CLIENTE\\scansioni", password: PASSWORD }),
    integrazione: () => INTEGRAZIONE,
    nuovoClient: finto.nuovoClient as DipendenzeLdap["nuovoClient"],
    ...extra,
  };
}

const rifiutoAd = (data: string) =>
  new InvalidCredentialsError(`80090308: LdapErr: DSID-0C09044E, comment: AcceptSecurityContext error, data ${data}, v4563`);

describe("provaLdapDellaVoce: l'esito dal bind", () => {
  it("bind riuscito: valida, con StartTLS tentato prima del bind e chiusura finale", async () => {
    const f = clienteFinto(async () => {});
    assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "valida");
    assert.deepEqual(f.eventi, ["startTLS", "bind:CLIENTE\\scansioni", "unbind"]);
  });
  it("StartTLS rifiutato: nessun bind in chiaro, la voce è un amministratore; non_so, e tocca a SMB", async () => {
    const f = clienteFinto(
      async () => {},
      async () => {
        throw new Error("no TLS");
      },
    );
    assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "non_so");
    assert.deepEqual(f.eventi, ["startTLS", "unbind"]);
  });
  it("InvalidCredentialsError con data 52e (anche 52E): errata, l'unico caso", async () => {
    for (const data of ["52e", "52E"]) {
      const f = clienteFinto(async () => {
        throw rifiutoAd(data);
      });
      assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "errata", data);
      assert.ok(f.eventi.includes("unbind"));
    }
  });
  it("account disabilitato (533), scaduto (532), password da cambiare (773), bloccato (775), utente ignoto (525): non_so", async () => {
    for (const data of ["533", "532", "773", "775", "525", "701"]) {
      const f = clienteFinto(async () => {
        throw rifiutoAd(data);
      });
      assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "non_so", data);
    }
  });
  it("InvalidCredentialsError senza codice AD (non è un DC Microsoft): non_so", async () => {
    const f = clienteFinto(async () => {
      throw new InvalidCredentialsError();
    });
    assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "non_so");
  });
  it("un errore qualunque che nel testo cita 52e non è una risposta: non_so", async () => {
    const f = clienteFinto(async () => {
      throw new Error("AcceptSecurityContext error, data 52e");
    });
    assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "non_so");
  });
  it("errore di trasporto (connessione rifiutata, reset): non_so", async () => {
    for (const msg of ["connect ECONNREFUSED 127.0.0.1:389", "read ECONNRESET", "Timeout occurred"]) {
      const f = clienteFinto(async () => {
        throw new Error(msg);
      });
      assert.equal(await provaLdapDellaVoce(1, depsLdap({}, f)), "non_so", msg);
    }
  });
  it("bind che non risponde entro il tetto: non_so, e il client viene chiuso", async () => {
    const f = clienteFinto(() => new Promise<void>(() => {}));
    const t0 = Date.now();
    assert.equal(await provaLdapDellaVoce(1, depsLdap({ tettoMs: 40 }, f)), "non_so");
    assert.ok(Date.now() - t0 < 2000);
    assert.ok(f.eventi.includes("unbind"));
  });
  it("il tetto predefinito è 15 secondi", async () => {
    const { TETTO_VERIFICA_MS } = await import("../verifica-password-run");
    assert.equal(TETTO_VERIFICA_MS, 15_000);
  });
  it("account illeggibile (voce di tipo sbagliato o mancante): non_so, nessun client", async () => {
    const f = clienteFinto(async () => {});
    assert.equal(await provaLdapDellaVoce(1, depsLdap({ account: () => null }, f)), "non_so");
    assert.deepEqual(f.creati, []);
  });
});

describe("provaLdapDellaVoce: l'account locale non fa logon sul DC", () => {
  for (const utente of ["scansioni", ".\\scansioni", "PC-CONTAB\\admin", "admin@altro.local"]) {
    it(`«${utente}»: non_so, nessun client creato, nessun bind`, async () => {
      const f = clienteFinto(async () => {
        throw rifiutoAd("52e");
      });
      assert.equal(await provaLdapDellaVoce(1, depsLdap({ utente }, f)), "non_so");
      assert.deepEqual(f.creati, []);
      assert.deepEqual(f.eventi, []);
    });
  }
  it("nessuna integrazione AD: non_so, nessun client", async () => {
    const f = clienteFinto(async () => {});
    assert.equal(await provaLdapDellaVoce(1, depsLdap({ integrazione: () => undefined }, f)), "non_so");
    assert.deepEqual(f.creati, []);
  });
  it("UPN dello stesso dominio: bind con quell'utente", async () => {
    const f = clienteFinto(async () => {});
    assert.equal(await provaLdapDellaVoce(1, depsLdap({ utente: "admin@cliente.local" }, f)), "valida");
    assert.ok(f.eventi.includes("bind:admin@cliente.local"));
  });
  it("use_ssl: ldaps, come connectLdap", async () => {
    const f = clienteFinto(async () => {});
    await provaLdapDellaVoce(1, depsLdap({ integrazione: () => ({ ...INTEGRAZIONE, use_ssl: 1, port: 636 }) }, f));
    assert.deepEqual(f.creati, [{ url: "ldaps://127.0.0.1:636" }]);
    assert.ok(!f.eventi.includes("startTLS"), "su ldaps non si fa StartTLS");
  });
});

/* -------------------------------------------------------------------- SMB */

type Chiamata = { file: string; args: readonly string[]; opts: OpzioniExecFile; stdin: string[] };

function depsSmb(opts: {
  porta?: TcpProbeResult["state"];
  risposta?: (cb: (e: Error | null, out: string, err: string) => void) => void;
  utente?: string;
  account?: DipendenzeSmb["account"];
  integrazione?: AdIntegration | null;
}) {
  const chiamate: Chiamata[] = [];
  const porte: Array<[string, number]> = [];
  const deps: Partial<DipendenzeSmb> = {
    account: opts.account ?? (() => ({ username: opts.utente ?? "CLIENTE\\scansioni", password: PASSWORD })),
    integrazione: () => (opts.integrazione === null ? undefined : (opts.integrazione ?? INTEGRAZIONE)),
    execFile(file, args, o, cb) {
      const c: Chiamata = { file, args, opts: o, stdin: [] };
      chiamate.push(c);
      setImmediate(() => (opts.risposta ?? ((k) => k(null, JSON.stringify({ esito: "valida" }), "")))(cb as never));
      return { stdin: { write: (s: string) => (c.stdin.push(s), true), end: () => {} } };
    },
    async probeTcpPort(host, port) {
      porte.push([host, port]);
      return { state: opts.porta ?? "open", port, rttMs: 1 } as TcpProbeResult;
    },
    trovaPython: () => "/finto/python3",
  };
  return { deps, chiamate, porte };
}

describe("provaSmbDellaVoce: l'esito dal bridge", () => {
  it("porta 445 chiusa o muta: non_so, il bridge non parte", async () => {
    for (const porta of ["refused", "timeout", "error"] as const) {
      const { deps, chiamate, porte } = depsSmb({ porta });
      assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so", porta);
      assert.equal(chiamate.length, 0);
      assert.deepEqual(porte, [["10.0.0.5", 445]]);
    }
  });
  it("valida/errata/non_so dal bridge; password solo su stdin, tetto 15 s, nessuna password negli argomenti", async () => {
    for (const esito of ["valida", "errata", "non_so"] as const) {
      const { deps, chiamate } = depsSmb({ risposta: (cb) => cb(null, JSON.stringify({ esito }), "") });
      assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), esito);
      const c = chiamate[0];
      assert.equal(c.opts.timeout, 15_000);
      assert.ok(!c.args.join(" ").includes(PASSWORD));
      assert.match(c.args.join(" "), /smb-login\.py$/);
      const input = JSON.parse(c.stdin.join("")) as Record<string, unknown>;
      assert.equal(input.host, "10.0.0.5");
      assert.equal(input.username, "CLIENTE\\scansioni");
      assert.equal(input.password, PASSWORD);
      assert.equal(input.dominio, "cliente.local");
    }
  });
  it("esito sconosciuto, output non JSON, vuoto, processo fallito o scaduto: non_so", async () => {
    const casi: Array<(cb: (e: Error | null, o: string, s: string) => void) => void> = [
      (cb) => cb(null, JSON.stringify({ esito: "forse" }), ""),
      (cb) => cb(null, "Traceback (most recent call last)", ""),
      (cb) => cb(null, "", ""),
      (cb) => cb(new Error("spawn /finto/python3 ENOENT"), "", ""),
      (cb) => cb(Object.assign(new Error("timeout"), { killed: true }), "", ""),
      (cb) => cb(null, JSON.stringify({ errata: true }), ""),
    ];
    for (const risposta of casi) assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", depsSmb({ risposta }).deps), "non_so");
  });
  it("account illeggibile: non_so, nemmeno la porta si prova", async () => {
    const { deps, chiamate, porte } = depsSmb({ account: () => null });
    assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
    assert.equal(chiamate.length, 0);
    assert.deepEqual(porte, []);
  });
});

/**
 * Un account locale vale per una macchina sola: «valida» o «errata» sulla prima non dicono nulla delle altre, dove la
 * password può essere diversa. Esteso a tutta l'esecuzione, un rifiuto diventerebbe «diritti mancanti» senza contare sul
 * limite di 3. Quindi nessun login: `non_so`, e resta il limite.
 */
const SENZA_DOMINIO = ["scansioni", ".\\scansioni", "\\scansioni", "scansioni@", "localhost\\admin", "LOCALHOST\\admin"];

/**
 * Decisione del 04/11/2026: `PC-CONTAB\\admin` non si distingue da `DOM\\admin`. Se SMB partisse, una password valida su
 * quel PC varrebbe per tutta l'esecuzione e i rifiuti degli altri PC non conterebbero sul limite di 3. Quindi SMB solo per
 * il dominio dell'integrazione AD accesa; tutto il resto è `non_so`, e il limite resta.
 */
describe("SMB solo per un utente del dominio dell'integrazione AD accesa", () => {
  for (const utente of ["DOM\\admin", "PC-CONTAB\\admin", "ALTRO\\scansioni", "admin@altro.local", "cliente.altro\\admin"]) {
    it(`«${utente}» con dominio ignoto: non_so, nemmeno la porta si prova`, async () => {
      const { deps, chiamate, porte } = depsSmb({ utente });
      assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
      assert.equal(chiamate.length, 0);
      assert.deepEqual(porte, []);
    });
  }

  for (const utente of ["CLIENTE\\scansioni", "cliente\\scansioni", "CLIENTE.LOCAL\\scansioni", "scansioni@cliente.local", "scansioni@CLIENTE.Local"]) {
    it(`«${utente}»: è del dominio (nome DNS o primo pezzo, senza maiuscole/minuscole), SMB parte`, async () => {
      const { deps, chiamate } = depsSmb({ utente });
      assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "valida");
      assert.equal(chiamate.length, 1);
    });
  }

  it("nessuna integrazione accesa: ogni utente è non_so, senza SMB, nemmeno quello che sembra di dominio", async () => {
    const { deps, chiamate, porte } = depsSmb({ integrazione: null });
    assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
    assert.equal(chiamate.length, 0);
    assert.deepEqual(porte, []);
  });

  it("integrazione col dominio vuoto: non riconosce nessuno", async () => {
    const { deps, chiamate } = depsSmb({ integrazione: { ...INTEGRAZIONE, domain: "" } });
    assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
    assert.equal(chiamate.length, 0);
  });
});

describe("un account senza dominio è sempre non_so", () => {
  for (const utente of SENZA_DOMINIO) {
    it(`«${utente}»: SMB non_so, nemmeno la porta si prova`, async () => {
      const { deps, chiamate, porte } = depsSmb({ utente });
      assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
      assert.equal(chiamate.length, 0);
      assert.deepEqual(porte, []);
    });

    it(`«${utente}»: l'intera verifica non fa nessun login, né LDAP né SMB`, async () => {
      const f = clienteFinto(async () => {});
      const smb = depsSmb({ utente });
      const run = new VerificaPasswordRun({
        ldap: (id) => provaLdapDellaVoce(id, depsLdap({ utente }, f)),
        smb: (id, ip) => provaSmbDellaVoce(id, ip, smb.deps),
      });
      assert.equal(await run.esito(1, "10.0.0.5"), "non_so");
      assert.deepEqual(f.creati, []);
      assert.deepEqual(f.eventi, []);
      assert.equal(smb.chiamate.length, 0);
      assert.deepEqual(smb.porte, []);
    });
  }

  it("un account di dominio con LDAP che non sa: SMB parte e il suo esito vale", async () => {
    const f = clienteFinto(async () => {
      throw new Error("ECONNREFUSED");
    });
    const smb = depsSmb({ risposta: (k) => k(null, JSON.stringify({ esito: "errata" }), "") });
    const run = new VerificaPasswordRun({
      ldap: (id) => provaLdapDellaVoce(id, depsLdap({}, f)),
      smb: (id, ip) => provaSmbDellaVoce(id, ip, smb.deps),
    });
    assert.equal(await run.esito(1, "10.0.0.5"), "errata");
    assert.equal(smb.chiamate.length, 1);
  });

  it("un account di un altro dominio: nessun login, né LDAP né SMB (il dominio non è quello noto)", async () => {
    const f = clienteFinto(async () => {});
    const smb = depsSmb({ utente: "ALTRO\\scansioni" });
    const run = new VerificaPasswordRun({
      ldap: (id) => provaLdapDellaVoce(id, depsLdap({ utente: "ALTRO\\scansioni" }, f)),
      smb: (id, ip) => provaSmbDellaVoce(id, ip, smb.deps),
    });
    assert.equal(await run.esito(1, "10.0.0.5"), "non_so");
    assert.deepEqual(f.creati, []);
    assert.equal(smb.chiamate.length, 0);
    assert.deepEqual(smb.porte, []);
  });
});

/* ------------------------------------------- lo script vero, impacket finto */

const PYTHON = (() => {
  const r = spawnSync("python3", ["--version"]);
  return r.status === 0 ? "python3" : null;
})();

/** Un modulo `impacket` finto, creato qui: il comportamento lo decide la password. */
function creaImpacketFinto(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "impacket-finto-"));
  fs.mkdirSync(path.join(dir, "impacket"));
  fs.writeFileSync(path.join(dir, "impacket", "__init__.py"), "");
  fs.writeFileSync(
    path.join(dir, "impacket", "nt_errors.py"),
    "STATUS_LOGON_FAILURE = 0xC000006D\nSTATUS_ACCOUNT_DISABLED = 0xC0000072\nSTATUS_ACCOUNT_LOCKED_OUT = 0xC0000234\n",
  );
  fs.writeFileSync(
    path.join(dir, "impacket", "smbconnection.py"),
    `import os
class SessionError(Exception):
    def __init__(self, code):
        Exception.__init__(self, "SMB SessionError")
        self._code = code
    def getErrorCode(self):
        return self._code
class SMBConnection:
    def __init__(self, remoteName, remoteHost, myName=None, sess_port=445, timeout=60, **kw):
        self.port = sess_port
        self.timeout = timeout
    def login(self, user, password, domain=""):
        open(os.environ["SMB_FINTO_LOG"], "a").write("login:%s:%s:%s:%s\\n" % (user, domain, self.port, self.timeout))
        if password == "ok" or password == "guest":
            self.guest = password == "guest"
            return True
        if password == "bad":
            raise SessionError(0xC000006D)
        if password == "disabled":
            raise SessionError(0xC0000072)
        if password == "locked":
            raise SessionError(0xC0000234)
        raise OSError("rete irraggiungibile")
    def isGuestSession(self):
        return self.guest
    def getServerDomain(self):
        dominio = os.environ.get("SMB_FINTO_DOMINIO", "CLIENTE")
        if dominio == "!lancia":
            raise RuntimeError("sessione chiusa")
        return dominio
    def logoff(self):
        open(os.environ["SMB_FINTO_LOG"], "a").write("logoff\\n")
    def close(self):
        pass
    def connectTree(self, share):
        raise RuntimeError("condivisione aperta")
    def listShares(self):
        raise RuntimeError("condivisioni elencate")
`,
  );
  return dir;
}

describe("smb-login.py: lo script vero contro un impacket finto", () => {
  const finto = creaImpacketFinto();
  const vuoto = fs.mkdtempSync(path.join(os.tmpdir(), "senza-impacket-"));
  const log = path.join(finto, "log.txt");
  const salvato = { pp: process.env.PYTHONPATH, log: process.env.SMB_FINTO_LOG };
  after(() => {
    if (salvato.pp === undefined) delete process.env.PYTHONPATH;
    else process.env.PYTHONPATH = salvato.pp;
    if (salvato.log === undefined) delete process.env.SMB_FINTO_LOG;
    else process.env.SMB_FINTO_LOG = salvato.log;
    fs.rmSync(finto, { recursive: true, force: true });
    fs.rmSync(vuoto, { recursive: true, force: true });
  });

  /** Lancia la prova vera: execFile vero, 445 finta aperta, Python di sistema. Registra args e stdin. */
  function lancia(utente: string, password: string, pythonPath: string) {
    process.env.PYTHONPATH = pythonPath;
    process.env.SMB_FINTO_LOG = log;
    fs.writeFileSync(log, "");
    const visti: Array<{ args: readonly string[]; stdin: string }> = [];
    const deps: Partial<DipendenzeSmb> = {
      account: () => ({ username: utente, password }),
      integrazione: () => INTEGRAZIONE,
      execFile(file, args, opts, cb) {
        const figlio = execFile(file, [...args], opts, cb);
        const scritto: string[] = [];
        visti.push({ args, stdin: "" });
        return {
          stdin: {
            write(chunk: string) {
              scritto.push(chunk);
              visti[visti.length - 1].stdin = scritto.join("");
              return figlio.stdin?.write(chunk);
            },
            end: () => figlio.stdin?.end(),
          },
        };
      },
      probeTcpPort: async (_h, port) => ({ state: "open", port, rttMs: 1 }) as TcpProbeResult,
      trovaPython: () => PYTHON as string,
    };
    return { deps, visti };
  }

  const casi: Array<[string, string, EsitoPassword]> = [
    ["password giusta", "ok", "valida"],
    ["STATUS_LOGON_FAILURE", "bad", "errata"],
    ["account disabilitato", "disabled", "non_so"],
    ["account bloccato", "locked", "non_so"],
    ["sessione guest (utente ignoto mappato a guest)", "guest", "non_so"],
    ["errore di rete", "rete", "non_so"],
  ];
  for (const [nome, password, atteso] of casi) {
    it(`${nome} → ${atteso}`, { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
      const { deps, visti } = lancia("CLIENTE\\scansioni", password, finto);
      assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), atteso);
      assert.ok(!visti[0].args.join(" ").includes(password), "password negli argomenti");
      const righe = fs.readFileSync(log, "utf-8");
      assert.match(righe, /login:scansioni:CLIENTE:445:/);
    });
  }
  it("nessuna condivisione aperta né elencata (login e logoff soltanto)", { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
    const { deps } = lancia("CLIENTE\\scansioni", "ok", finto);
    assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "valida");
    assert.equal(fs.readFileSync(log, "utf-8").trim().split("\n").at(-1), "logoff");
  });
  it("UPN: utente e dominio NetBIOS separati", { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
    const { deps } = lancia("admin@cliente.local", "ok", finto);
    await provaSmbDellaVoce(1, "10.0.0.5", deps);
    assert.match(fs.readFileSync(log, "utf-8"), /login:admin:cliente:445:/);
  });
  it("utente locale (senza dominio): lo script non parte, nessun login", { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
    const { deps, visti } = lancia("scansioni", "ok", finto);
    assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
    assert.deepEqual(visti, []);
    assert.equal(fs.readFileSync(log, "utf-8"), "");
  });
  describe("una sessione vale solo sul dominio dell'integrazione", () => {
    const casi: Array<[string, string, EsitoPassword]> = [
      ["nome NetBIOS del dominio", "CLIENTE", "valida"],
      ["senza badare alle maiuscole", "cliente", "valida"],
      ["nome DNS intero", "CLIENTE.LOCAL", "valida"],
      ["macchina fuori dominio: risponde col suo nome", "PC-CONTAB", "non_so"],
      ["un altro dominio", "ALTRO", "non_so"],
      ["il server non lo dice", "", "non_so"],
    ];
    for (const [nome, serverDomain, atteso] of casi) {
      it(`${nome} → ${atteso}`, { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
        const { deps } = lancia("CLIENTE\\scansioni", "ok", finto);
        process.env.SMB_FINTO_DOMINIO = serverDomain;
        try {
          assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), atteso);
        } finally {
          delete process.env.SMB_FINTO_DOMINIO;
        }
        assert.equal(fs.readFileSync(log, "utf-8").trim().split("\n").at(-1), "logoff", "la sessione si chiude comunque");
      });
    }

    it("getServerDomain che lancia: non_so", { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
      const { deps } = lancia("CLIENTE\\scansioni", "ok", finto);
      process.env.SMB_FINTO_DOMINIO = "!lancia";
      try {
        assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
      } finally {
        delete process.env.SMB_FINTO_DOMINIO;
      }
    });
  });

  it("impacket assente: non_so, senza lanciare", { skip: PYTHON ? false : "python3 non disponibile" }, async () => {
    const { deps } = lancia("CLIENTE\\scansioni", "bad", vuoto);
    // Il Python di sistema può avere impacket vero: allora il finto non c'è e il giro andrebbe in rete. Si evita
    // nascondendo il modulo con un percorso che lo copre: un impacket vuoto, senza smbconnection.
    fs.mkdirSync(path.join(vuoto, "impacket"), { recursive: true });
    fs.writeFileSync(path.join(vuoto, "impacket", "__init__.py"), "");
    assert.equal(await provaSmbDellaVoce(1, "10.0.0.5", deps), "non_so");
  });
});

/* --------------------------- le prove vere con l'archivio vero (DB del tenant) */

function voce(nome: string, tipo: string, utente: string, password: string): number {
  return Number(
    dbt()
      .prepare("INSERT INTO credentials (name, credential_type, encrypted_username, encrypted_password) VALUES (?, ?, ?, ?)")
      .run(nome, tipo, encrypt(utente), encrypt(password)).lastInsertRowid,
  );
}
function integrazione(nome: string, enabled: number, dominio: string, dcHost: string): void {
  dbt()
    .prepare(
      `INSERT INTO ad_integrations (name, dc_host, domain, base_dn, encrypted_username, encrypted_password, use_ssl, port, enabled)
       VALUES (?, ?, ?, 'DC=x', '', '', 0, 389, ?)`,
    )
    .run(nome, dcHost, dominio, enabled);
}

describe("le prove leggono l'account come il login: ripulito dagli spazi", () => {
  // Il login di discovery passa da `coppiaLoginDb`, che ripulisce: una password con uno spazio in coda, verificata com'è,
  // dava `errata` su una voce che entra.
  it("LDAP e SMB ricevono utente e password senza spazi attorno", async () => {
    dbt().exec("DELETE FROM credentials; DELETE FROM ad_integrations;");
    const id = voce("Scansioni", "windows", "  CLIENTE\\scansioni ", ` ${PASSWORD}  `);
    integrazione("Accesa", 1, "cliente.local", "10.1.1.1");

    const binds: Array<[string, string]> = [];
    const client = { startTLS: async () => {}, bind: async (dn: string, pw: string) => void binds.push([dn, pw]), unbind: async () => {} } as unknown as Client;
    assert.equal(await withTenant(T, () => provaLdapDellaVoce(id, { nuovoClient: () => client })), "valida");
    assert.deepEqual(binds, [["CLIENTE\\scansioni", PASSWORD]]);

    const { deps, chiamate } = depsSmb({});
    delete deps.account;
    delete deps.integrazione;
    assert.equal(await withTenant(T, () => provaSmbDellaVoce(id, "10.0.0.5", deps)), "valida");
    const input = JSON.parse(chiamate[0].stdin.join("")) as Record<string, string>;
    assert.deepEqual([input.username, input.password], ["CLIENTE\\scansioni", PASSWORD]);
  });
});

describe("le prove vere leggono la voce Windows dall'archivio", () => {
  beforeEach(() => {
    deleteTenantDatabase(T);
    withTenant(T, () => dbt());
  });
  after(() => deleteTenantDatabase(T));

  it("LDAP: account della voce Windows, sulla prima integrazione ACCESA", async () => {
    const id = voce("Scansioni", "windows", "CLIENTE\\scansioni", PASSWORD);
    integrazione("Spenta", 0, "cliente.local", "10.9.9.9");
    integrazione("Accesa", 1, "cliente.local", "10.1.1.1");
    integrazione("Accesa 2", 1, "cliente.local", "10.2.2.2");
    const binds: Array<[string, string, string]> = [];
    const nuovoClient = (o: { url: string }): Client =>
      ({
        startTLS: async () => {},
        bind: async (dn: string, pw: string) => void binds.push([o.url, dn, pw]),
        unbind: async () => {},
      }) as unknown as Client;
    const esito = await withTenant(T, () => provaLdapDellaVoce(id, { nuovoClient: nuovoClient as DipendenzeLdap["nuovoClient"] }));
    assert.equal(esito, "valida");
    assert.deepEqual(binds, [["ldap://10.1.1.1:389", "CLIENTE\\scansioni", PASSWORD]]);
  });
  it("LDAP: voce che non è Windows o non esiste → non_so; nessuna integrazione accesa → non_so", async () => {
    const snmp = voce("Community", "snmp", "x", "y");
    integrazione("Spenta", 0, "cliente.local", "10.9.9.9");
    const id = voce("Scansioni", "windows", "CLIENTE\\scansioni", PASSWORD);
    let creati = 0;
    const nuovoClient = (): Client => {
      creati++;
      return { startTLS: async () => {}, bind: async () => {}, unbind: async () => {} } as unknown as Client;
    };
    const d = { nuovoClient: nuovoClient as DipendenzeLdap["nuovoClient"] };
    assert.equal(await withTenant(T, () => provaLdapDellaVoce(snmp, d)), "non_so");
    assert.equal(await withTenant(T, () => provaLdapDellaVoce(9999, d)), "non_so");
    assert.equal(await withTenant(T, () => provaLdapDellaVoce(id, d)), "non_so");
    assert.equal(creati, 0);
  });
  it("SMB: utente e password della voce arrivano su stdin; voce non Windows → non_so senza processo", async () => {
    const id = voce("Scansioni", "windows", "CLIENTE\\scansioni", PASSWORD);
    const snmp = voce("Community", "snmp", "x", "y");
    integrazione("Accesa", 1, "cliente.local", "10.1.1.1");
    const { deps, chiamate } = depsSmb({});
    delete deps.account;
    delete deps.integrazione;
    assert.equal(await withTenant(T, () => provaSmbDellaVoce(id, "10.0.0.5", deps)), "valida");
    const input = JSON.parse(chiamate[0].stdin.join("")) as Record<string, string>;
    assert.equal(input.username, "CLIENTE\\scansioni");
    assert.equal(input.password, PASSWORD);
    assert.equal(await withTenant(T, () => provaSmbDellaVoce(snmp, "10.0.0.5", deps)), "non_so");
    assert.equal(chiamate.length, 1);
  });
  it("SMB: con l'unica integrazione spenta la voce di dominio non fa nessun login", async () => {
    const id = voce("Scansioni", "windows", "CLIENTE\\scansioni", PASSWORD);
    integrazione("Spenta", 0, "cliente.local", "10.9.9.9");
    const { deps, chiamate } = depsSmb({});
    delete deps.account;
    delete deps.integrazione;
    assert.equal(await withTenant(T, () => provaSmbDellaVoce(id, "10.0.0.5", deps)), "non_so");
    assert.equal(chiamate.length, 0);
  });
});

// Tipi usati solo per l'inferenza sopra.
export type _Dipendenze = DipendenzeWmi;
