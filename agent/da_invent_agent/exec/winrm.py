"""Esecuzione comandi WinRM via subprocess di ``winrm_bridge.py``.

``winrm_bridge.py`` è copia 1:1 di ``src/lib/devices/winrm-bridge.py``
dell'hub. Incorpora gotchas già hardenati:
    - Catena di trasporto automatica Kerberos -> NTLM -> CredSSP -> Basic.
    - Realm uppercase forzato per pywinrm compat.
    - Reverse DNS automatico per connessioni via IP (Kerberos SPN).
    - Auto-kinit se username+password forniti.

I/O:
    stdin  -> JSON ``{host, port, username, password, command, usePowershell, realm?}``
    stdout -> JSON success ``{stdout, stderr, exitCode, transport}``
               | error ``{error: msg}`` (exit_code 1)

Output viene adattato al contratto agent: ``exit_code`` snake_case,
``duration_ms`` aggiunto, ``truncated`` per stdout/stderr, ``transport_used``
ribattezzato.
"""

from __future__ import annotations

import asyncio
import json
import logging
import sys
import time
from pathlib import Path
from typing import Any

from ..errors import AgentException, ErrorCode


log = logging.getLogger(__name__)


_BRIDGE_PATH = Path(__file__).parent / "winrm_bridge.py"

MAX_STDOUT = 1 * 1024 * 1024
MAX_STDERR = 256 * 1024


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit], True


def _classify_error(message: str) -> ErrorCode:
    lower = message.lower()
    if any(k in lower for k in ("timeout", "timed out")):
        return ErrorCode.TIMEOUT
    if any(k in lower for k in ("credentials", "401", "auth", "kerberos")):
        # Conservativo: Kerberos misconfig classifichiamo come auth_invalid.
        return ErrorCode.AUTH_INVALID
    if any(k in lower for k in ("refused", "unreachable", "no route", "connection")):
        return ErrorCode.TARGET_UNREACHABLE
    return ErrorCode.INTERNAL


async def winrm_exec(
    *,
    host: str,
    port: int | None,
    user: str,
    auth: dict[str, Any],
    command: str,
    use_powershell: bool = True,
    realm: str | None = None,
    transport: str | None = None,
    timeout_ms: int = 60_000,
) -> dict[str, Any]:
    """Spawna winrm_bridge.py e attende la risposta JSON.

    ``auth`` accetta solo ``type="password"``: pywinrm supporta Kerberos
    soltanto via password (più TGT cache locale). Per chiavi/cert si
    userà PSRemoting in fasi future."""

    if auth.get("type") != "password":
        raise AgentException(ErrorCode.INVALID_INPUT, "WinRM supporta solo auth.type='password'")
    password = auth.get("password")
    if not isinstance(password, str) or not password:
        raise AgentException(ErrorCode.INVALID_INPUT, "auth.password mancante")

    payload = {
        "host": host,
        "port": port or 5985,
        "username": user,
        "password": password,
        "command": command,
        "usePowershell": use_powershell,
    }
    if realm:
        payload["realm"] = realm

    env: dict[str, str] = {}
    if transport:
        env["WINRM_TRANSPORT"] = transport

    if not _BRIDGE_PATH.exists():
        raise AgentException(
            ErrorCode.TOOL_MISSING,
            "winrm_bridge.py non trovato (installazione corrotta).",
            details={"path": str(_BRIDGE_PATH)},
        )

    timeout_s = max(2.0, timeout_ms / 1000)
    start = time.monotonic()
    try:
        proc = await asyncio.create_subprocess_exec(
            sys.executable,
            str(_BRIDGE_PATH),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env={**_inherited_env(), **env},
        )
    except FileNotFoundError as exc:
        raise AgentException(ErrorCode.TOOL_MISSING, "Python interpreter non disponibile", details={"tool": "python"}) from exc

    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(input=json.dumps(payload).encode("utf-8")),
            timeout=timeout_s + 5,
        )
    except asyncio.TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise AgentException(ErrorCode.TIMEOUT, f"WinRM timeout dopo {timeout_s:.0f}s") from exc

    stdout_str = stdout_b.decode("utf-8", errors="replace").strip()
    stderr_str = stderr_b.decode("utf-8", errors="replace").strip()

    if not stdout_str:
        raise AgentException(
            ErrorCode.INTERNAL,
            "winrm_bridge.py non ha prodotto output",
            details={"stderr": stderr_str[:500]},
        )

    try:
        result = json.loads(stdout_str)
    except json.JSONDecodeError as exc:
        raise AgentException(
            ErrorCode.PARSE_ERROR,
            f"winrm_bridge.py output non-JSON: {exc}",
            details={"stdout": stdout_str[:500], "stderr": stderr_str[:500]},
        ) from exc

    if "error" in result:
        err_msg = str(result["error"])
        raise AgentException(_classify_error(err_msg), err_msg)

    stdout = result.get("stdout", "") or ""
    stderr = result.get("stderr", "") or ""
    stdout_trunc, stdout_was = _truncate(stdout, MAX_STDOUT)
    stderr_trunc, stderr_was = _truncate(stderr, MAX_STDERR)
    return {
        "stdout": stdout_trunc,
        "stderr": stderr_trunc,
        "exit_code": int(result.get("exitCode", -1)),
        "duration_ms": int((time.monotonic() - start) * 1000),
        "transport_used": result.get("transport", "unknown"),
        "truncated": {"stdout": stdout_was, "stderr": stderr_was},
    }


def _inherited_env() -> dict[str, str]:
    """Eredita solo le env var necessarie a Kerberos/Python — evita di
    passare l'intero env del processo agente (potrebbe contenere
    credenziali di tenant diversi)."""

    import os

    keep = {"PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "KRB5_CONFIG", "KRB5CCNAME"}
    return {k: v for k, v in os.environ.items() if k in keep}
