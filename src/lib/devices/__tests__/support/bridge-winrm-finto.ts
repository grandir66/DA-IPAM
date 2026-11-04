/**
 * Banco del bridge WinRM vero: `winrm-bridge.py` gira davvero, con un modulo `winrm` finto e un `kinit` finto creati qui.
 * Ogni tentativo di autenticazione finisce in un registro: si contano i logon, non le chiamate alla prova.
 *
 * I messaggi d'errore sono quelli veri di pywinrm: su quelli il bridge decide se passare al trasporto dopo.
 */
import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DipendenzeWinrm } from "@/lib/devices/winrm-run";

export const SCRIPT_BRIDGE = path.resolve(process.cwd(), "src/lib/devices/winrm-bridge.py");

export const PYTHON: string | null = spawnSync("python3", ["--version"]).status === 0 ? "python3" : null;

/** Cosa fa il trasporto: `ok`, `rifiuta` (401), `timeout`, `senza_credssp`, `appeso` (entra e resta fermo anche in chiusura). */
export type CondottaTrasporto = "ok" | "rifiuta" | "timeout" | "senza_credssp" | "appeso";

const WINRM_FINTO = `import json
import os
import time


CONDOTTE = json.loads(os.environ.get("WINRM_FINTO_CONDOTTE", "{}"))


def scrivi(riga):
    with open(os.environ["WINRM_FINTO_LOG"], "a") as f:
        f.write(riga + "\\n")


class Response:
    def __init__(self, args):
        self.std_out, self.std_err, self.status_code = args


class Protocol:
    def __init__(self, transport, utente):
        self.transport = transport
        self.utente = utente
        self.condotta = CONDOTTE.get(transport, "rifiuta")

    def open_shell(self):
        scrivi("logon:%s:%s" % (self.transport, self.utente))
        if self.condotta == "rifiuta":
            raise Exception("the specified credentials were rejected by the server")
        if self.condotta == "timeout":
            raise Exception("HTTPConnectionPool: Read timed out. (read timeout=120)")
        if self.condotta == "senza_credssp":
            raise Exception("The server did not response with CredSSP being an available authentication method")
        return "shell"

    def run_command(self, shell_id, command, args=()):
        if self.condotta == "appeso":
            scrivi("comando-appeso")
            time.sleep(60)
        return "comando"

    def get_command_output(self, shell_id, command_id):
        return (b"PC-FINTO\\r\\n", b"", 0)

    def cleanup_command(self, shell_id, command_id):
        if self.condotta == "appeso":
            time.sleep(60)

    def close_shell(self, shell_id):
        if self.condotta == "appeso":
            time.sleep(60)


class Session:
    def __init__(self, target, auth, transport="plaintext", server_cert_validation="validate", read_timeout_sec=30):
        self.protocol = Protocol(transport, auth[0])

    def run_cmd(self, command, args=()):
        raise NotImplementedError

    def run_ps(self, script):
        raise NotImplementedError
`;

/** `kinit` è un logon sul DC come gli altri: va nel registro. */
const KINIT_FINTO = `#!/bin/sh
cat > /dev/null
echo "kinit:$1" >> "$WINRM_FINTO_LOG"
exit "\${KINIT_FINTO_ESITO:-1}"
`;

export interface BridgeFinto {
  /** Ambiente del bridge: `winrm`, `kinit` e `klist` finti, krb5.conf già pronto, niente scritture in casa dell'utente. */
  ambiente(condotte: Partial<Record<string, CondottaTrasporto>>, extra?: Record<string, string>): NodeJS.ProcessEnv;
  /** I logon fatti finora, nell'ordine. */
  logon(): string[];
  /** Tutto il registro, logon e il resto. */
  registro(): string[];
  /** Le dipendenze di `runWinrmCommand` col processo vero: porte aperte, nessuna rete. */
  dipendenze(condotte: Partial<Record<string, CondottaTrasporto>>, extra?: Record<string, string>): DipendenzeWinrm;
  /** Lancia lo script con questa richiesta e ne legge il JSON. */
  lancia(richiesta: Record<string, unknown>, condotte: Partial<Record<string, CondottaTrasporto>>, extra?: Record<string, string>): Record<string, unknown>;
  togli(): void;
}

export function creaBridgeFinto(): BridgeFinto {
  const cartella = fs.mkdtempSync(path.join(os.tmpdir(), "bridge-winrm-finto-"));
  const moduli = path.join(cartella, "moduli");
  const bin = path.join(cartella, "bin");
  const log = path.join(cartella, "logon.log");
  const krb5 = path.join(cartella, "krb5.conf");
  fs.mkdirSync(path.join(moduli, "winrm"), { recursive: true });
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(moduli, "winrm", "__init__.py"), WINRM_FINTO);
  fs.writeFileSync(path.join(bin, "kinit"), KINIT_FINTO, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "klist"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  // Col segno del bridge il file è già «nostro»: niente scritture in /etc/krb5.conf o nella cartella di casa.
  fs.writeFileSync(krb5, "# DA-INVENT-KRB5-DNS-SRV\n");
  fs.writeFileSync(log, "");

  const registro = (): string[] => fs.readFileSync(log, "utf-8").split("\n").filter(Boolean);

  const ambiente: BridgeFinto["ambiente"] = (condotte, extra = {}) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      PYTHONPATH: moduli,
      HOME: cartella,
      KRB5_CONFIG: krb5,
      WINRM_FINTO_LOG: log,
      WINRM_FINTO_CONDOTTE: JSON.stringify(condotte),
      ...extra,
    };
    if (!("WINRM_TRANSPORT" in extra)) delete env.WINRM_TRANSPORT;
    return env;
  };

  return {
    ambiente,
    registro,
    logon: () => registro().filter((r) => r.startsWith("logon:") || r.startsWith("kinit:")),
    dipendenze(condotte, extra) {
      const env = ambiente(condotte, extra);
      return {
        checkWinrmReachability: async () => ({ reachable: true, summary: "open", results: [] }),
        trovaPython: () => PYTHON as string,
        execFile: (file, args, opts, cb) => execFile(file, [...args], { ...opts, env }, cb),
      };
    },
    lancia(richiesta, condotte, extra) {
      const r = spawnSync(PYTHON as string, [SCRIPT_BRIDGE], {
        input: JSON.stringify(richiesta),
        env: ambiente(condotte, extra),
        encoding: "utf-8",
      });
      return JSON.parse(r.stdout) as Record<string, unknown>;
    },
    togli: () => fs.rmSync(cartella, { recursive: true, force: true }),
  };
}
