/**
 * Tendine e filtri delle credenziali sui tipi d'archivio (tappa 2 credenziali,
 * T12, 16/10).
 *
 * Perché: dalla 2c le voci `linux` diventano `ssh` e le SNMP v3 diventano
 * `snmp_v3`. I filtri scritti sul codice grezzo le avrebbero fatte sparire:
 * - le tre tendine «SNMP aggiuntivo» tenevano solo `credential_type === "snmp"`;
 * - l'inventario software teneva solo `windows` o `linux`, e sull'apparato
 *   il tipo uguale a `device.vendor` («linux»): l'unica voce `linux` di H1,
 *   usata da 5 scansioni software, sarebbe sparita dalla tendina.
 * Le tendine mostravano anche il codice grezzo («(snmp_v3)», «(linux)»).
 * Revisione della 2c: la riga host e la lista della rete offrivano anche le
 * voci UniFi, Omada e AD, che il server rifiuta.
 *
 * Le funzioni si eseguono; la parte statica controlla che i componenti le
 * usino e non tornino al confronto sul codice grezzo.
 *
 * Run: node --import tsx --test src/lib/__tests__/tendine-credenziali-tipi.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as mappa from "@/lib/credential-protocol-map";

const voci = [
  { id: 1, name: "community", credential_type: "snmp" },
  { id: 2, name: "v3", credential_type: "snmp_v3" },
  { id: 3, name: "ssh", credential_type: "ssh" },
  { id: 4, name: "vecchia linux", credential_type: "linux" },
  { id: 5, name: "windows", credential_type: "windows" },
  { id: 6, name: "api", credential_type: "api" },
  { id: 7, name: "unifi", credential_type: "unifi" },
  { id: 8, name: "dominio", credential_type: "ad" },
  { id: 9, name: "omada", credential_type: "omada" },
];
const ids = (xs: Array<{ id: number }>) => xs.map((x) => x.id);

type Filtro = (v: typeof voci, secondo?: string | null) => typeof voci;
function funzione(nome: string): Filtro {
  const f = (mappa as unknown as Record<string, unknown>)[nome];
  assert.equal(typeof f, "function", `${nome} non esiste in credential-protocol-map`);
  return f as Filtro;
}

describe("SNMP aggiuntivo", () => {
  it("la tendina tiene community e SNMP v3, nient'altro", () => {
    assert.deepEqual(ids(funzione("vociSnmpAggiuntive")(voci)), [1, 2]);
  });
});

describe("inventario software", () => {
  it("apparato Linux: le voci SSH, anche le vecchie linux", () => {
    assert.deepEqual(ids(funzione("vociSoftware")(voci, "linux")), [3, 4]);
  });
  it("apparato macOS: le voci SSH", () => {
    assert.deepEqual(ids(funzione("vociSoftware")(voci, "macos")), [3, 4]);
  });
  it("apparato Windows: solo le Windows", () => {
    assert.deepEqual(ids(funzione("vociSoftware")(voci, "windows")), [5]);
  });
  it("host, senza piattaforma: Windows e SSH", () => {
    assert.deepEqual(ids(funzione("vociSoftware")(voci, undefined)), [3, 4, 5]);
  });
});

// Revisione della 2c (16/10): la riga host e «Aggiungi da archivio» della rete
// offrivano tutte le voci, anche UniFi, Omada e AD, che il server dalla 2c
// rifiuta (la rete annullava tutta la modifica, nome compreso).
describe("riga host: le voci del protocollo scelto", () => {
  it("WinRM: solo le Windows, mai l'account AD", () => {
    assert.deepEqual(ids(funzione("vociPerProtocollo")(voci, "winrm")), [5]);
  });
  it("SSH: SSH e le vecchie linux; SNMP: community e v3; API: API e SSH (Proxmox con root)", () => {
    assert.deepEqual(ids(funzione("vociPerProtocollo")(voci, "ssh")), [3, 4]);
    assert.deepEqual(ids(funzione("vociPerProtocollo")(voci, "snmp")), [1, 2]);
    assert.deepEqual(ids(funzione("vociPerProtocollo")(voci, "api")), [3, 6]);
  });
});

describe("lista della rete e modifica in blocco: solo voci d'accesso", () => {
  it("niente UniFi, Omada, AD", () => {
    assert.deepEqual(ids(funzione("vociDAccesso")(voci)), [1, 2, 3, 4, 5, 6]);
  });
});

const RADICE = process.cwd();
const leggi = (rel: string) => readFileSync(join(RADICE, rel), "utf8");

const TENDINE_SNMP = [
  "src/components/shared/credential-assignment-fields.tsx",
  "src/app/(dashboard)/networks/[id]/network-detail-client.tsx",
  "src/app/(dashboard)/discovery/page.tsx",
];

describe("i componenti usano la regola, non il codice grezzo", () => {
  for (const f of TENDINE_SNMP) {
    it(`${f}: «SNMP aggiuntivo» da vociSnmpAggiuntive`, () => {
      const src = leggi(f);
      assert.doesNotMatch(src, /credential_type === "snmp"/, "filtro sul codice grezzo «snmp»");
      assert.match(src, /vociSnmpAggiuntive\(/);
    });
  }

  it("host-software-card: il filtro passa da vociSoftware", () => {
    const src = leggi("src/components/hosts/host-software-card.tsx");
    assert.doesNotMatch(src, /credential_type === osHint/, "filtro sul vendor come se fosse un tipo");
    assert.doesNotMatch(src, /credential_type === "linux"/, "filtro sul codice grezzo «linux»");
    assert.match(src, /vociSoftware\(/);
  });

  it("finestra credenziali dell'host: la tendina segue il protocollo scelto", () => {
    assert.match(leggi("src/components/shared/host-credentials-dialog.tsx"), /vociPerProtocollo\(availableCredentials, addProtocol\)/);
  });

  it("«Aggiungi da archivio» della rete e la modifica in blocco degli host: solo voci d'accesso", () => {
    assert.match(leggi("src/components/shared/network-credentials-table.tsx"), /vociDAccesso\(/);
    assert.match(leggi("src/app/(dashboard)/discovery/page.tsx"), /vociDAccesso\(credentials\)/);
  });

  const TENDINE_CON_TIPO = [
    "src/components/shared/host-credentials-dialog.tsx",
    "src/components/networks/subnet-edge-scan-panel.tsx",
    "src/components/shared/network-credentials-table.tsx",
    "src/components/shared/credential-assignment-fields.tsx",
    "src/components/shared/device-credentials-table.tsx",
    "src/app/(dashboard)/discovery/page.tsx",
    "src/app/(dashboard)/networks/[id]/network-detail-client.tsx",
  ];
  for (const f of TENDINE_CON_TIPO) {
    it(`${f}: le tendine mostrano l'etichetta, non il codice`, () => {
      const src = leggi(f);
      assert.doesNotMatch(src, /\(\{c\.credential_type\}\)/, "«(codice)» in una tendina");
      assert.doesNotMatch(src, /extra: c\.credential_type\b/, "codice grezzo come nota della voce");
      assert.doesNotMatch(src, />\s*\{c\.credential_type\}\s*</, "codice grezzo come testo (badge)");
    });
  }
});
