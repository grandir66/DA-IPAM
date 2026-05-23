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
    except paramiko.BadAuthenticationType as e:
        # Il server espone metodi auth che paramiko non sa gestire (es. solo publickey).
        try: client.close()
        except Exception: pass
        allowed = ", ".join(getattr(e, "allowed_types", []) or [])
        _err(
            f"[auth_method_unsupported] {host}:{port} per utente '{username}': "
            f"il server SSH non accetta password (metodi offerti: {allowed or 'sconosciuti'}). "
            f"Verifica sshd_config (PasswordAuthentication, KbdInteractiveAuthentication) o usa una chiave."
        )
        return
    except paramiko.AuthenticationException as e:
        try: client.close()
        except Exception: pass
        _err(
            f"[auth_failed] {host}:{port} per utente '{username}': credenziali rifiutate. "
            f"Verifica username/password e che l'utente sia abilitato a SSH. Dettaglio: {e}"
        )
        return
    except paramiko.SSHException as e:
        try: client.close()
        except Exception: pass
        msg = str(e)
        low = msg.lower()
        if "no authentication methods available" in low or "no acceptable kex" in low or "no acceptable" in low:
            _err(
                f"[protocol_error] {host}:{port}: negoziazione SSH fallita ({msg}). "
                f"Il dispositivo potrebbe richiedere algoritmi legacy: aggiorna firmware o usa un client compatibile."
            )
        else:
            _err(f"[protocol_error] {host}:{port}: errore SSH ({msg}).")
        return
    except Exception as e:
        try: client.close()
        except Exception: pass
        msg = str(e)
        low = msg.lower()
        if "timed out" in low or "timeout" in low:
            _err(f"[connect_timeout] {host}:{port}: timeout connessione SSH. Verifica raggiungibilità e firewall.")
        elif "refused" in low or "econnrefused" in low:
            _err(f"[connect_refused] {host}:{port}: connessione rifiutata. Servizio SSH attivo?")
        elif "no route" in low or "unreachable" in low:
            _err(f"[unreachable] {host}:{port}: host non raggiungibile (no route).")
        elif "name or service not known" in low or "getaddrinfo" in low:
            _err(f"[unreachable] hostname '{host}' non risolto. Usa IP statico o verifica DNS.")
        else:
            _err(f"[unknown] {host}:{port}: errore SSH ({msg}).")
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
