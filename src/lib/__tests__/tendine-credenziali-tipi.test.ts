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
];
const ids = (xs: Array<{ id: number }>) => xs.map((x) => x.id);

type Filtro = (v: typeof voci, piattaforma?: string | null) => typeof voci;
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

  const TENDINE_CON_TIPO = [
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
    });
  }
});
