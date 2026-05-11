"""Esecuzione comandi remoti via SSH (asyncssh).

Sceglie ``asyncssh`` su ``paramiko`` perché:
    - Asincrono nativo (non blocca l'event loop FastAPI).
    - Supporto out-of-the-box per OpenSSH key formats moderni (Ed25519,
      keys con passphrase, certificati).
    - API più piccola e meno foot-guns.

Output troncato:
    - stdout 1 MiB
    - stderr 256 KiB
Il client viene informato via ``truncated.{stdout,stderr}``.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from ..errors import AgentException, ErrorCode


MAX_STDOUT = 1 * 1024 * 1024
MAX_STDERR = 256 * 1024


def _truncate(text: str, limit: int) -> tuple[str, bool]:
    if len(text) <= limit:
        return text, False
    return text[:limit], True


async def ssh_exec(
    *,
    host: str,
    port: int = 22,
    user: str,
    auth: dict[str, Any],
    command: str,
    timeout_ms: int = 30_000,
) -> dict[str, Any]:
    try:
        import asyncssh
    except ImportError as exc:  # pragma: no cover — solo se la dep manca a runtime
        raise AgentException(
            ErrorCode.TOOL_MISSING,
            "Modulo Python 'asyncssh' non installato. pip install asyncssh.",
            details={"tool": "asyncssh"},
        ) from exc

    auth_type = auth.get("type")
    kwargs: dict[str, Any] = {
        "host": host,
        "port": port,
        "username": user,
        "known_hosts": None,             # Phase 3: TOFU. In Phase 4+ consideriamo pinning.
        "client_keys_load_path": None,
    }
    client_keys: list[Any] | None = None

    if auth_type == "password":
        password = auth.get("password")
        if not isinstance(password, str) or not password:
            raise AgentException(ErrorCode.INVALID_INPUT, "auth.password mancante")
        kwargs["password"] = password
    elif auth_type == "key":
        pem = auth.get("private_key_pem")
        if not isinstance(pem, str) or not pem:
            raise AgentException(ErrorCode.INVALID_INPUT, "auth.private_key_pem mancante")
        try:
            key_obj = asyncssh.import_private_key(pem, passphrase=auth.get("passphrase"))
        except (asyncssh.KeyImportError, asyncssh.KeyEncryptionError) as exc:
            raise AgentException(ErrorCode.INVALID_INPUT, f"Chiave privata non valida: {exc}") from exc
        client_keys = [key_obj]
        kwargs["client_keys"] = client_keys
    else:
        raise AgentException(ErrorCode.INVALID_INPUT, f"auth.type non supportato: {auth_type!r}")

    timeout_s = max(1.0, timeout_ms / 1000)
    start = time.monotonic()

    async def _do() -> dict[str, Any]:
        try:
            async with asyncssh.connect(**kwargs) as conn:
                result = await conn.run(command, check=False)
                stdout = result.stdout if isinstance(result.stdout, str) else (result.stdout.decode("utf-8", errors="replace") if result.stdout else "")
                stderr = result.stderr if isinstance(result.stderr, str) else (result.stderr.decode("utf-8", errors="replace") if result.stderr else "")
                stdout_trunc, stdout_was = _truncate(stdout, MAX_STDOUT)
                stderr_trunc, stderr_was = _truncate(stderr, MAX_STDERR)
                return {
                    "stdout": stdout_trunc,
                    "stderr": stderr_trunc,
                    "exit_code": result.exit_status if result.exit_status is not None else -1,
                    "duration_ms": int((time.monotonic() - start) * 1000),
                    "truncated": {"stdout": stdout_was, "stderr": stderr_was},
                }
        except asyncssh.PermissionDenied as exc:
            raise AgentException(ErrorCode.AUTH_INVALID, f"SSH auth fallita: {exc}") from exc
        except (asyncssh.DisconnectError, asyncssh.ConnectionLost, OSError) as exc:
            raise AgentException(ErrorCode.TARGET_UNREACHABLE, f"SSH connection error: {exc}") from exc

    try:
        return await asyncio.wait_for(_do(), timeout=timeout_s + 5)
    except asyncio.TimeoutError as exc:
        raise AgentException(ErrorCode.TIMEOUT, f"SSH timeout dopo {timeout_s:.0f}s") from exc
