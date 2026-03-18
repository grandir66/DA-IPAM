#!/usr/bin/env python3
"""
Bridge Python per WinRM: riceve comandi via stdin JSON, esegue via pywinrm, restituisce stdout JSON.
Usato da winrm-run.ts perché WinRM su HTTP richiede SPNEGO session encryption
che pywinrm gestisce nativamente tramite pyspnego + requests-ntlm.
"""
import json
import sys
import base64
import os

def run_large_ps(session, script):
    """Execute large PowerShell scripts that exceed cmd.exe's 8191 char limit.
    Writes base64 chunks to a temp file on the target, then decodes and executes."""
    encoded = base64.b64encode(script.encode("utf_16_le")).decode("ascii")
    cmd_line_len = len(f"powershell -encodedcommand {encoded}")

    if cmd_line_len <= 7500:
        return session.run_ps(script)

    temp_id = f"da-invent-{os.getpid()}"
    b64_file = f"C:\\Windows\\Temp\\{temp_id}.b64"

    chunk_size = 6000
    for i in range(0, len(encoded), chunk_size):
        chunk = encoded[i:i + chunk_size]
        redir = ">" if i == 0 else ">>"
        session.run_cmd(f"echo {chunk}{redir}{b64_file}")

    exec_script = (
        f"$b=[IO.File]::ReadAllText('{b64_file}').Trim();"
        f"$clean=$b -replace '[\\r\\n\\s]','';"
        f"$bytes=[Convert]::FromBase64String($clean);"
        f"$s=[Text.Encoding]::Unicode.GetString($bytes);"
        f"Remove-Item '{b64_file}' -Force -EA 0;"
        f"Invoke-Expression $s"
    )
    return session.run_ps(exec_script)


def main():
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
    except Exception as e:
        print(json.dumps({"error": f"JSON parse error: {e}"}))
        sys.exit(1)

    host = req.get("host", "")
    port = req.get("port", 5985)
    username = req.get("username", "")
    password = req.get("password", "")
    command = req.get("command", "")
    use_powershell = req.get("usePowershell", False)

    protocol = "https" if port == 5986 else "http"
    endpoint = f"{protocol}://{host}:{port}/wsman"

    try:
        import winrm
        s = winrm.Session(
            endpoint,
            auth=(username, password),
            transport="ntlm",
            server_cert_validation="ignore",
            read_timeout_sec=120,
        )

        if use_powershell:
            r = run_large_ps(s, command)
        else:
            r = s.run_cmd(command)

        stdout = r.std_out.decode("utf-8", errors="replace") if r.std_out else ""
        stderr = r.std_err.decode("utf-8", errors="replace") if r.std_err else ""

        print(json.dumps({
            "stdout": stdout,
            "stderr": stderr,
            "exitCode": r.status_code,
        }))

    except Exception as e:
        error_msg = str(e)
        if "401" in error_msg:
            error_msg = "Autenticazione rifiutata (401). Verifica username e password."
        elif "ECONNREFUSED" in error_msg or "Connection refused" in error_msg:
            error_msg = "Connessione rifiutata. WinRM non attivo o porta errata."
        elif "timed out" in error_msg.lower() or "timeout" in error_msg.lower():
            error_msg = "Timeout connessione WinRM."
        print(json.dumps({"error": error_msg}))
        sys.exit(1)

if __name__ == "__main__":
    main()
