/**
 * Firmware QNAP nel percorso storico (21/10, piano recupero DADude3, S2).
 *
 * Difetti: (1) `getNasDeviceInfoFromSsh` scriveva in `firmware` l'uscita di `uname -rsm` (kernel, non firmware);
 * (2) `getDeviceInfo` stendeva l'SSH sopra l'SNMP con uno spread, quindi un firmware SSH nullo cancellava
 * quello letto via SNMP. Fixture: uscite di forma vera con numeri inventati.
 *
 * Run: DA_INVENT_DATA_DIR=$(mktemp -d) node --import tsx --test src/lib/devices/__tests__/qnap-firmware.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { identitaNasDaShell, type UsciteIdentitaNas } from "../nas-acquisition";
import { unisciInfoSsh, type DeviceInfo } from "../device-info";
import { parseQnapVersione } from "../nas/qnap-versione";

const VUOTE: UsciteIdentitaNas = {
  synoVer: "", synoInfo: "", synoSerial: "",
  qnapModel: "", qnapSerial: "", qnapUname: "", qnapFirmver: "", qnapEtcVersion: "", qnapBuild: "",
  dmiProduct: "", dmiSerial: "",
};
const UNAME = "Linux 5.10.60-qnap x86_64\n";

describe("parseQnapVersione", () => {
  it("firmver e build: versione con la build, senza troncare", () => {
    assert.deepEqual(parseQnapVersione({ firmver: "5.1.5\n", etcVersion: "", build: "20240101\n" }), { firmware: "5.1.5 build 20240101", build: "20240101" });
  });
  it("senza getsysinfo si usa /etc/version", () => {
    assert.equal(parseQnapVersione({ firmver: "", etcVersion: "5.2.0\n", build: "" }).firmware, "5.2.0");
  });
  it("versione a quattro numeri non viene accorciata", () => {
    assert.equal(parseQnapVersione({ firmver: "4.5.4.1800", etcVersion: "", build: "" }).firmware, "4.5.4.1800");
  });
  it("un messaggio di errore al posto della versione dà null", () => {
    assert.equal(parseQnapVersione({ firmver: "sh: getsysinfo: not found", etcVersion: "", build: "" }).firmware, null);
  });
  it("l'uscita di uname non è un firmware", () => {
    assert.equal(parseQnapVersione({ firmver: UNAME, etcVersion: "", build: "" }).firmware, null);
  });
  it("tutto vuoto: null", () => {
    assert.deepEqual(parseQnapVersione({ firmver: "", etcVersion: "", build: "" }), { firmware: null, build: null });
  });
});

describe("identitaNasDaShell (QNAP)", () => {
  it("il firmware viene da getsysinfo/etc-version, non dall'uname", () => {
    const r = identitaNasDaShell("qnap", { ...VUOTE, qnapUname: UNAME, qnapFirmver: "5.1.5\n", qnapBuild: "20240101" });
    assert.equal(r.firmware, "5.1.5 build 20240101");
  });
  it("con la sola uscita di uname il firmware è null, mai il kernel", () => {
    const r = identitaNasDaShell("qnap", { ...VUOTE, qnapUname: UNAME });
    assert.equal(r.firmware, null);
  });
  it("modello e seriale invariati", () => {
    const r = identitaNasDaShell("qnap", { ...VUOTE, qnapModel: "TS-X64\n", qnapSerial: "Q000000001\n" });
    assert.equal(r.model, "TS-X64");
    assert.equal(r.serial_number, "Q000000001");
  });
  it("Synology non cambia", () => {
    const r = identitaNasDaShell("synology", { ...VUOTE, synoVer: 'majorversion="7"\nminorversion="2"\nbuildnumber="64570"\n' });
    assert.equal(r.firmware, "7.2.64570");
  });
});

describe("unisciInfoSsh", () => {
  const base: DeviceInfo = { sysname: "nas", sysdescr: null, model: null, firmware: "5.1.5", serial_number: null, part_number: null };
  it("un firmware SSH nullo o assente non cancella quello già letto", () => {
    assert.equal(unisciInfoSsh(base, { firmware: null }).firmware, "5.1.5");
    assert.equal(unisciInfoSsh(base, { firmware: undefined }).firmware, "5.1.5");
  });
  it("un firmware SSH presente lo sostituisce", () => {
    assert.equal(unisciInfoSsh(base, { firmware: "5.2.0" }).firmware, "5.2.0");
  });
  it("gli altri campi si stendono come prima", () => {
    assert.equal(unisciInfoSsh(base, { model: "TS-X64" }).model, "TS-X64");
  });
});
