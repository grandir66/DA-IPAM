#!/usr/bin/env python3
"""
Bridge Python per SSH (paramiko): riceve un comando via stdin JSON, lo esegue
sull'host remoto e restituisce stdout JSON.

Simmetrico a `winrm-bridge.py`. **Solo password auth** (riusa
`credentials.encrypted_password`). Niente key auth, niente known_hosts strict
(AutoAddPolicy). Mai loggare password.

Input JSON (stdin):
  {"host": "10.0.0.5", "port": 22, "username": "root", "password": "...",
   "command": "...", "timeout_sec": 60}

Output JSON (stdout) — successo:
  {"stdout": "...", "stderr": "...", "exit_code": 0, "transport": "ssh-paramiko"}

Output JSON (stdout) — errore: {"error": "..."}.
Exit code 1 in caso di errore.
"""
import json
import sys


def _err(msg: str) -> None:
    print(json.dumps({"error": msg}))
    sys.exit(1)


def main() -> None:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except Exception as e:
        _err(f"JSON parse error: {e}")
        return

    host = str(req.get("host", "")).strip()
    port = int(req.get("port", 22) or 22)
    username = str(req.get("username", ""))
    password = str(req.get("password", ""))
    command = str(req.get("command", ""))
    timeout_sec = float(req.get("timeout_sec", 60) or 60)

    if not host or not username or not command:
        _err("host, username e command sono obbligatori")
        return

    try:
        import paramiko  # noqa: F401
    except ImportError as e:
        _err(
            "Modulo Python paramiko assente: "
            + str(e)
            + ". Sul server DA-INVENT: python3 -m venv ~/.da-invent-venv && "
            "~/.da-invent-venv/bin/pip install paramiko"
        )
        return

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=host,
            port=port,
            username=username,
            password=password,
            timeout=timeout_sec,
            banner_timeout=min(30.0, timeout_sec),
            auth_timeout=min(30.0, timeout_sec),
            allow_agent=False,
            look_for_keys=False,
        )
    except Exception as e:
        try:
            client.close()
        except Exception:
            pass
        msg = str(e)
        low = msg.lower()
        if "authentication failed" in low or "no authentication" in low:
            _err(f"Credenziali SSH rifiutate da {host}:{port}: {msg}")
        elif "timed out" in low or "timeout" in low:
            _err(f"Timeout connessione SSH a {host}:{port}: {msg}")
        elif "refused" in low or "econnrefused" in low:
            _err(f"Connessione SSH rifiutata da {host}:{port}: {msg}")
        elif "no route" in low or "unreachable" in low:
            _err(f"Host SSH non raggiungibile {host}:{port}: {msg}")
        else:
            _err(f"Errore connessione SSH ({host}:{port}): {msg}")
        return

    try:
        stdin, stdout, stderr = client.exec_command(
            command,
            timeout=timeout_sec,
            get_pty=False,
        )
        try:
            stdin.close()
        except Exception:
            pass

        out_bytes = stdout.read()
        err_bytes = stderr.read()
        exit_code = stdout.channel.recv_exit_status()

        try:
            out_text = out_bytes.decode("utf-8", errors="replace")
        except Exception:
            out_text = ""
        try:
            err_text = err_bytes.decode("utf-8", errors="replace")
        except Exception:
            err_text = ""

        print(json.dumps({
            "stdout": out_text,
            "stderr": err_text,
            "exit_code": exit_code,
            "transport": "ssh-paramiko",
        }))
    except Exception as e:
        _err(f"Errore esecuzione comando SSH: {e}")
    finally:
        try:
            client.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
