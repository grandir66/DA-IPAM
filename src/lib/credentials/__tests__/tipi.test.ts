/**
 * Tipi d'archivio per esteso e regola unica tipo ↔ protocollo (tappa 2
 * credenziali, T2, 15/10).
 *
 * Prima la stessa regola stava in due posti con valori diversi
 * (`credential-protocol-map.ts` ammetteva `ssh` per `api`, il livello 5 del
 * motore in `resolve.ts` no), e i tipi esistevano solo come codici grezzi
 * («linux», «snmp») mostrati così nelle tendine. Qui i valori esatti della
 * tabella dei vincoli del piano: un cambio della regola deve passare da qui.
 *
 * Run: node --import tsx --test src/lib/credentials/__tests__/tipi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  TIPI_CREDENZIALE,
  METODI_PER_TIPO,
  ETICHETTE_TIPO,
  normalizzaTipo,
  etichettaTipo,
  tipiPerProtocollo,
  campiRichiesti,
  type MetodoAccesso,
  type TipoCredenziale,
  portaVoceValePer,
} from "../tipi";
import { SNMP_V3_SECURITY_LEVELS } from "@/lib/protocols/snmpv3";

describe("tipi d'archivio — valori esatti", () => {
  it("gli otto tipi, in quest'ordine", () => {
    assert.deepEqual([...TIPI_CREDENZIALE], ["ssh", "snmp", "snmp_v3", "windows", "api", "unifi", "omada", "ad"]);
  });

  it("metodi per tipo (il primo è quello di auth_method NULL)", () => {
    assert.deepEqual(METODI_PER_TIPO, {
      ssh: ["password", "chiave"],
      snmp: ["community"],
      snmp_v3: ["utente_v3"],
      windows: ["password"],
      api: ["utente", "token"],
      unifi: ["chiave", "utente"],
      omada: ["client", "utente"],
      ad: ["password"],
    });
  });

  it("etichette per esteso", () => {
    assert.deepEqual(ETICHETTE_TIPO, {
      ssh: "SSH (password o chiave)",
      snmp: "SNMP v1/v2c",
      snmp_v3: "SNMP v3",
      windows: "Windows (WinRM e WMI)",
      api: "API (token o utente)",
      unifi: "Controller UniFi",
      omada: "Controller Omada",
      ad: "Active Directory",
    });
  });
});

describe("normalizzaTipo / etichettaTipo", () => {
  it("«linux» è un alias di «ssh»", () => {
    assert.equal(normalizzaTipo("linux"), "ssh");
  });

  it("un tipo sconosciuto o assente dà null", () => {
    assert.equal(normalizzaTipo("boh"), null);
    assert.equal(normalizzaTipo(""), null);
    assert.equal(normalizzaTipo(null), null);
    assert.equal(normalizzaTipo(undefined), null);
  });

  it("ogni tipo d'archivio resta se stesso, maiuscole e spazi non contano", () => {
    for (const t of TIPI_CREDENZIALE) assert.equal(normalizzaTipo(t), t);
    assert.equal(normalizzaTipo(" SSH "), "ssh");
    assert.equal(normalizzaTipo("Linux"), "ssh");
  });

  it("etichetta per esteso, «linux» come SSH, sconosciuto → il codice", () => {
    assert.equal(etichettaTipo("snmp"), "SNMP v1/v2c");
    assert.equal(etichettaTipo("windows"), "Windows (WinRM e WMI)");
    assert.equal(etichettaTipo("linux"), "SSH (password o chiave)");
    assert.equal(etichettaTipo("boh"), "boh");
    assert.equal(etichettaTipo(null), "");
  });
});

describe("tipiPerProtocollo — la regola unica, valori esatti", () => {
  const attesi: Array<[string | null | undefined, string[]]> = [
    ["ssh", ["ssh", "linux"]],
    // D7 = (a): l'account AD non entra nelle tendine e nelle catene WinRM.
    ["winrm", ["windows"]],
    ["snmp", ["snmp", "snmp_v3"]],
    ["snmp_v2", ["snmp", "snmp_v3"]],
    ["snmp_v3", ["snmp", "snmp_v3"]],
    // Proxmox con utente root (regola della tappa 1).
    ["api", ["api", "ssh"]],
    ["redfish", ["api"]],
    ["onvif", ["api"]],
    ["boh", ["ssh", "windows", "api", "linux"]],
    ["", ["ssh", "windows", "api", "linux"]],
    [null, ["ssh", "windows", "api", "linux"]],
    [undefined, ["ssh", "windows", "api", "linux"]],
  ];
  for (const [protocollo, tipi] of attesi) {
    it(`${String(protocollo)} → ${tipi.join(", ")}`, () => {
      assert.deepEqual(tipiPerProtocollo(protocollo), tipi);
    });
  }

  it("UniFi, Omada e AD non valgono per nessun protocollo", () => {
    for (const [protocollo] of attesi) {
      const tipi = tipiPerProtocollo(protocollo);
      for (const escluso of ["unifi", "omada", "ad"]) {
        assert.ok(!tipi.includes(escluso), `${escluso} ammesso per ${String(protocollo)}`);
      }
    }
  });

  it("ogni chiamata dà un elenco nuovo: chi lo modifica non cambia la regola", () => {
    const primo = tipiPerProtocollo("ssh");
    primo.push("windows");
    primo.sort();
    assert.deepEqual(tipiPerProtocollo("ssh"), ["ssh", "linux"]);
  });
});

describe("campiRichiesti — i campi obbligatori di ogni metodo", () => {
  const attesi: Array<[TipoCredenziale, MetodoAccesso, string | null, string[]]> = [
    ["ssh", "password", null, ["username", "password"]],
    // la passphrase della chiave è facoltativa
    ["ssh", "chiave", null, ["username", "private_key"]],
    ["snmp", "community", null, ["password"]],
    ["snmp_v3", "utente_v3", "noAuthNoPriv", ["username"]],
    ["snmp_v3", "utente_v3", "authNoPriv", ["username", "auth_key"]],
    ["snmp_v3", "utente_v3", "authPriv", ["username", "auth_key", "priv_key"]],
    // livello non ancora scelto: si chiede tutto, mai di meno
    ["snmp_v3", "utente_v3", null, ["username", "auth_key", "priv_key"]],
    ["windows", "password", null, ["username", "password"]],
    ["api", "utente", null, ["username", "password"]],
    // l'id del token è facoltativo
    ["api", "token", null, ["password"]],
    ["unifi", "chiave", null, ["password"]],
    ["unifi", "utente", null, ["username", "password"]],
    ["omada", "client", null, ["username", "password"]],
    ["omada", "utente", null, ["username", "password"]],
    ["ad", "password", null, ["username", "password"]],
  ];
  for (const [tipo, metodo, livello, campi] of attesi) {
    it(`${tipo}/${metodo}${livello ? `/${livello}` : ""} → ${campi.join(", ")}`, () => {
      assert.deepEqual(campiRichiesti(tipo, metodo, livello), campi);
    });
  }

  it("copre ogni coppia tipo/metodo della tabella", () => {
    const coperte = new Set(attesi.map(([t, m]) => `${t}/${m}`));
    for (const t of TIPI_CREDENZIALE) {
      for (const m of METODI_PER_TIPO[t]) assert.ok(coperte.has(`${t}/${m}`), `${t}/${m} senza prova`);
    }
  });

  it("un metodo che il tipo non ha è un errore, non un elenco vuoto", () => {
    assert.throws(() => campiRichiesti("snmp", "password"), /non vale per il tipo/);
    assert.throws(() => campiRichiesti("windows", "chiave"), /non vale per il tipo/);
  });

  // tipi.ts non può importare snmpv3.ts (carica net-snmp, non va nel client):
  // i livelli sono copiati, e qui si controlla che restino gli stessi.
  it("accetta tutti e soli i livelli SNMPv3 di snmpv3.ts", () => {
    for (const livello of SNMP_V3_SECURITY_LEVELS) {
      assert.doesNotThrow(() => campiRichiesti("snmp_v3", "utente_v3", livello), livello);
    }
    assert.equal(SNMP_V3_SECURITY_LEVELS.length, 3);
  });

  it("un livello SNMPv3 sconosciuto è un errore", () => {
    assert.throws(() => campiRichiesti("snmp_v3", "utente_v3", "authPrivato"), /livello SNMPv3/);
  });
});

// Revisione della 2a: una voce ammessa per un protocollo che non è il suo (SSH
// per le API di Proxmox) non porta la sua porta in quel protocollo.
describe("portaVoceValePer — la porta della voce solo nei protocolli del suo tipo", () => {
  it("SSH (e l'alias linux) per ssh sì, per api no", () => {
    assert.equal(portaVoceValePer("ssh", "ssh"), true);
    assert.equal(portaVoceValePer("linux", "ssh"), true);
    assert.equal(portaVoceValePer("ssh", "api"), false);
  });
  it("API per api, redfish e onvif; SNMP e SNMPv3 per le tre forme di snmp; Windows per winrm", () => {
    for (const p of ["api", "redfish", "onvif"]) assert.equal(portaVoceValePer("api", p), true, p);
    for (const p of ["snmp", "snmp_v2", "snmp_v3"]) {
      assert.equal(portaVoceValePer("snmp", p), true, p);
      assert.equal(portaVoceValePer("snmp_v3", p), true, p);
    }
    assert.equal(portaVoceValePer("windows", "winrm"), true);
  });
  it("tipo o protocollo sconosciuto, o assente: mai la porta della voce", () => {
    assert.equal(portaVoceValePer("boh", "ssh"), false);
    assert.equal(portaVoceValePer(null, "ssh"), false);
    assert.equal(portaVoceValePer("ssh", "telnet"), false);
    assert.equal(portaVoceValePer("ssh", null), false);
  });
});
