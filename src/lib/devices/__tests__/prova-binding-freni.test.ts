/**
 * Freni della prova a mano di un legame Windows (revisione finale, piano accesso Windows).
 *
 * La scansione non fa mai più di 3 logon errati per account; il pulsante «Prova» del legame invece passava sopra a tutto:
 * un clic ripetuto su WMI, o su WinRM con una voce di dominio, era un logon errato per clic, e con la catena WinRM fino a
 * quattro. Cinque clic bastano a bloccare un account. Ora la prova legge il ricordo delle password errate, ha un limite
 * di 3 prove in 15 minuti per utente e chiede al DC se la password è giusta, come la scansione.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/prova-binding-freni.test.ts
 */
import { TEST_DATA_DIR } from "@/lib/__tests__/support/data-dir-isolata";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { encrypt } from "@/lib/crypto";
import { closeHubDb } from "@/lib/db-hub";
import { chiaveAccount, RicordoErrate } from "@/lib/scanner/account-windows";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import { WmiError } from "../wmi-run";
import { WinrmError, type OpzioniWinrm } from "../winrm-run";
import { provaBinding, type DipendenzeProvaBinding } from "../prova-binding";

void TEST_DATA_DIR;
const PASSWORD = "S3greta!";

after(() => {
  closeHubDb();
});

const legame = (utente: string, protocollo: "wmi" | "winrm") => ({
  credential_id: null,
  inline_username: utente,
  inline_encrypted_password: encrypt(PASSWORD),
  protocol_type: protocollo,
  port: protocollo === "wmi" ? 135 : 5985,
});

interface Banco {
  deps: DipendenzeProvaBinding;
  logonHost: () => number;
  verifiche: () => number;
  opzioniWinrm: Array<OpzioniWinrm | undefined>;
}

/** Il limite resta quello vero: ogni prova usa un utente suo, così il contatore non si porta dietro le altre. */
function banco(o: { verifica?: EsitoPassword; ricordo?: RicordoErrate } = {}): Banco {
  let logon = 0;
  let verifiche = 0;
  const opzioniWinrm: Array<OpzioniWinrm | undefined> = [];
  return {
    logonHost: () => logon,
    verifiche: () => verifiche,
    opzioniWinrm,
    deps: {
      ricordo: o.ricordo ?? new RicordoErrate(),
      verificaPassword: async () => {
        verifiche += 1;
        return o.verifica ?? "non_so";
      },
      wmiIdentita: async () => {
        logon += 1;
        throw new WmiError({ code: "AUTH_REJECTED", message: "rpc_s_access_denied" });
      },
      winrm: async (...a) => {
        logon += 1;
        opzioniWinrm.push(a[7]);
        throw new WinrmError({ code: "AUTH_REJECTED", message: "credentials were rejected" });
      },
    },
  };
}

async function clic(n: number, utente: string, protocollo: "wmi" | "winrm", b: Banco) {
  const esiti = [];
  for (let i = 0; i < n; i++) esiti.push(await provaBinding("10.0.0.5", legame(utente, protocollo), "1", b.deps));
  return esiti;
}

describe("il freno del legame WMI", () => {
  it("5 clic con la password rifiutata: al massimo 3 logon, e il quarto dice perché e non marca il legame", async () => {
    const b = banco();
    const esiti = await clic(5, "CLIENTE\\limite-wmi", "wmi", b);
    assert.equal(b.logonHost(), 3);
    for (const e of esiti.slice(3)) {
      assert.equal(e.success, false);
      assert.equal(e.nonDisponibile, true, "una prova non partita non è un rifiuto: il legame non si marca");
      assert.match(e.message, /Troppe prove/);
    }
  });

  it("il limite è per utente: due forme dello stesso account contano insieme, un altro account no", async () => {
    const b = banco();
    await clic(2, "CLIENTE\\limite-forme", "wmi", b);
    await clic(2, "limite-forme@cliente.local", "wmi", b);
    assert.equal(b.logonHost(), 3);
    await clic(1, "CLIENTE\\altro-utente", "wmi", b);
    assert.equal(b.logonHost(), 4);
  });

  it("password già nota errata: nessun logon, nessuna verifica, nessun tentativo consumato", async () => {
    const ricordo = new RicordoErrate();
    const utente = "CLIENTE\\gia-errata";
    ricordo.segna(chiaveAccount(utente, PASSWORD));
    const b = banco({ ricordo });
    const esiti = await clic(5, utente, "wmi", b);
    assert.equal(b.logonHost(), 0);
    assert.equal(b.verifiche(), 0);
    for (const e of esiti) {
      assert.equal(e.nonDisponibile, true);
      assert.match(e.message, /errata/i);
    }
  });

  it("il DC dice che la password è errata: nessun logon sull'host, e il ricordo si aggiorna", async () => {
    const ricordo = new RicordoErrate();
    const utente = "CLIENTE\\rifiuto-certo";
    const b = banco({ ricordo, verifica: "errata" });
    const esiti = await clic(5, utente, "wmi", b);
    assert.equal(b.logonHost(), 0);
    assert.equal(b.verifiche(), 1, "dal secondo clic risponde il ricordo: un bind solo");
    assert.equal(ricordo.ricorda(chiaveAccount(utente, PASSWORD)), true);
    assert.match(esiti[0].message, /errata/i);
  });

  it("un rifiuto dell'host non è una prova che la password sia sbagliata: il ricordo resta vuoto", async () => {
    const ricordo = new RicordoErrate();
    const utente = "CLIENTE\\rifiuto-incerto";
    await clic(1, utente, "wmi", banco({ ricordo }));
    assert.equal(ricordo.ricorda(chiaveAccount(utente, PASSWORD)), false, "può essere un diritto che manca: `errata` toglierebbe la validazione a tutta la voce");
  });
});

describe("il freno del legame WinRM", () => {
  it("voce di dominio: 5 clic, al massimo 3 prove, ciascuna da un logon solo se la password non è verificata", async () => {
    const b = banco();
    await clic(5, "CLIENTE\\limite-winrm", "winrm", b);
    assert.equal(b.logonHost(), 3);
    assert.deepEqual(b.opzioniWinrm, [{ unSoloLogon: true }, { unSoloLogon: true }, { unSoloLogon: true }]);
  });

  it("voce di dominio con la password verificata dal DC: la catena completa, come la scansione", async () => {
    const b = banco({ verifica: "valida" });
    await clic(1, "CLIENTE\\catena-winrm", "winrm", b);
    assert.deepEqual(b.opzioniWinrm, [undefined]);
  });

  it("voce di dominio senza password: nessun tentativo (un bind senza password il DC lo accetta come anonimo)", async () => {
    const b = banco({ verifica: "valida" });
    const r = await provaBinding("10.0.0.5", { ...legame("CLIENTE\\senza-password", "winrm"), inline_encrypted_password: null }, "1", b.deps);
    assert.equal(r.success, false);
    assert.equal(r.message, "Password mancante");
    assert.equal(b.logonHost() + b.verifiche(), 0);
  });

  it("account locale: non blocca il dominio, nessun limite e nessuna verifica, come prima", async () => {
    const b = banco();
    await clic(5, "amministratore", "winrm", b);
    assert.equal(b.logonHost(), 5);
    assert.equal(b.verifiche(), 0);
  });
});
