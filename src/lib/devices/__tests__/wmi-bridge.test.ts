/**
 * `wmi-bridge.py` vero contro un impacket finto: il codice d'errore decide se un fallimento conta sul limite dei logon
 * errati, quindi non deve dipendere da una stringa che compare per caso nel messaggio.
 *
 * Incidente: revisione del 04/11/2026. `"0x5" in msg` prendeva per accesso negato anche 0x52e, 0x5b4 e ogni altro codice
 * che comincia così.
 *
 * Run: node --import tsx --test src/lib/devices/__tests__/wmi-bridge.test.ts
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";

const SCRIPT = path.resolve(process.cwd(), "src/lib/devices/wmi-bridge.py");
const PYTHON = spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;
const salta = PYTHON ? false : "python3 non disponibile";

const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "impacket-wmi-finto-"));
const moduli = path.join(cartella, "moduli");
const vuoto = path.join(cartella, "vuoto");
fs.mkdirSync(path.join(moduli, "impacket", "dcerpc", "v5", "dcom"), { recursive: true });
fs.mkdirSync(path.join(vuoto, "impacket"), { recursive: true });
fs.writeFileSync(path.join(vuoto, "impacket", "__init__.py"), "");
for (const f of ["impacket/__init__.py", "impacket/dcerpc/__init__.py", "impacket/dcerpc/v5/__init__.py", "impacket/dcerpc/v5/dcom/__init__.py"]) {
  fs.writeFileSync(path.join(moduli, f), "");
}
fs.writeFileSync(path.join(moduli, "impacket/dcerpc/v5/dtypes.py"), "NULL = None\n");
fs.writeFileSync(path.join(moduli, "impacket/dcerpc/v5/dcom/wmi.py"), "CLSID_WbemLevel1Login = 1\nIID_IWbemLevel1Login = 2\n");
fs.writeFileSync(
  path.join(moduli, "impacket/dcerpc/v5/dcomrt.py"),
  `import os
class DCOMConnection:
    def __init__(self, *args, **kwargs):
        raise Exception(os.environ["WMI_FINTO_ERRORE"])
`,
);

after(() => fs.rmSync(cartella, { recursive: true, force: true }));

function lancia(input: string, pythonPath: string, errore = ""): { errorCode?: string } {
  const r = spawnSync(PYTHON as string, [SCRIPT], { input, encoding: "utf-8", env: { ...process.env, PYTHONPATH: pythonPath, WMI_FINTO_ERRORE: errore } });
  return JSON.parse(r.stdout) as { errorCode?: string };
}

const connessione = (errore: string) => lancia(JSON.stringify({ host: "10.0.0.5", username: "DOM\\u", password: "p" }), moduli, errore);

describe("wmi-bridge.py: l'accesso negato è quello vero", () => {
  const negati = [
    "DCERPC Runtime Error: code: 0x5 - rpc_s_access_denied",
    "rpc_s_access_denied",
    "WMI Session Error: code: 0x80041003 - WBEM_E_ACCESS_DENIED",
    "DCOM SessionError: code: 0x80070005 - E_ACCESSDENIED - General access denied error",
    "code: 0x00000005",
    "Error 0x5",
  ];
  for (const errore of negati) {
    it(`«${errore}» → AUTH_REJECTED`, { skip: salta }, () => assert.equal(connessione(errore).errorCode, "AUTH_REJECTED"));
  }

  const altri = [
    "code: 0x52e",
    "RPC error 0x5b4",
    "SessionError 0xc000005e",
    "server unavailable 0x50",
    "code: 0x8007005a",
  ];
  for (const errore of altri) {
    it(`«${errore}» non è un accesso negato`, { skip: salta }, () => assert.equal(connessione(errore).errorCode, "UNKNOWN"));
  }
});

describe("wmi-bridge.py: i codici senza logon", () => {
  it("impacket assente: IMPACKET_MISSING", { skip: salta }, () => {
    assert.equal(lancia(JSON.stringify({ host: "10.0.0.5", username: "u", password: "p" }), vuoto).errorCode, "IMPACKET_MISSING");
  });

  it("input non valido: BRIDGE_INPUT", { skip: salta }, () => {
    assert.equal(lancia("non è json", moduli).errorCode, "BRIDGE_INPUT");
    assert.equal(lancia(JSON.stringify({ host: "", username: "" }), moduli).errorCode, "BRIDGE_INPUT");
  });
});
