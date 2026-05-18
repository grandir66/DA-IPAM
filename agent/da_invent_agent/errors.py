"""Contratto errori uniforme.

Tutte le risposte 4xx/5xx hanno questa shape::

    {
      "error": {
        "code":      "tool_missing" | "auth_invalid" | "target_unreachable"
                   | "timeout" | "parse_error" | "internal"
                   | "scope_denied" | "invalid_input",
        "message":   str,
        "retriable": bool,
        "details":   any (opzionale)
      }
    }

Convenzione status HTTP per codice:
    tool_missing       -> 503
    auth_invalid       -> 401
    scope_denied       -> 403
    invalid_input      -> 400
    target_unreachable -> 502
    timeout            -> 504
    parse_error        -> 502
    internal           -> 500

``AgentException`` è l'eccezione di dominio: i handler di FastAPI la
convertono in ``JSONResponse`` con la shape sopra. Sollevarla da
endpoint o exec wrapper invece di sollevare ``HTTPException``.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from fastapi import Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse


class ErrorCode(StrEnum):
    TOOL_MISSING = "tool_missing"
    AUTH_INVALID = "auth_invalid"
    SCOPE_DENIED = "scope_denied"
    INVALID_INPUT = "invalid_input"
    TARGET_UNREACHABLE = "target_unreachable"
    TIMEOUT = "timeout"
    PARSE_ERROR = "parse_error"
    INTERNAL = "internal"


_STATUS_BY_CODE: dict[ErrorCode, int] = {
    ErrorCode.TOOL_MISSING: 503,
    ErrorCode.AUTH_INVALID: 401,
    ErrorCode.SCOPE_DENIED: 403,
    ErrorCode.INVALID_INPUT: 400,
    ErrorCode.TARGET_UNREACHABLE: 502,
    ErrorCode.TIMEOUT: 504,
    ErrorCode.PARSE_ERROR: 502,
    ErrorCode.INTERNAL: 500,
}


_RETRIABLE_BY_CODE: dict[ErrorCode, bool] = {
    ErrorCode.TOOL_MISSING: False,
    ErrorCode.AUTH_INVALID: False,
    ErrorCode.SCOPE_DENIED: False,
    ErrorCode.INVALID_INPUT: False,
    ErrorCode.TARGET_UNREACHABLE: True,
    ErrorCode.TIMEOUT: True,
    ErrorCode.PARSE_ERROR: False,
    # internal=True: i 500 generici sono spesso transienti (OOM, socket
    # exhaustion, race interne). Vogliamo che l'hub li ri-tenti con backoff
    # invece di forzare logica ad-hoc lato chiamante. Se un endpoint produce
    # un 500 deterministico è un bug da diagnosticare lato server, non da
    # rendere non-retriable nel contratto.
    ErrorCode.INTERNAL: True,
}


class AgentException(Exception):
    """Sollevata dagli endpoint/exec quando una richiesta fallisce in modo
    "atteso" (target non raggiungibile, timeout, ecc.). Tradotta a
    ``JSONResponse`` dall'handler globale."""

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        details: Any = None,
        retriable: bool | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details
        self.retriable = _RETRIABLE_BY_CODE[code] if retriable is None else retriable

    @property
    def status_code(self) -> int:
        return _STATUS_BY_CODE[self.code]

    def to_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "error": {
                "code": self.code.value,
                "message": self.message,
                "retriable": self.retriable,
            }
        }
        if self.details is not None:
            payload["error"]["details"] = jsonable_encoder(self.details)
        return payload


async def agent_exception_handler(request: Request, exc: AgentException) -> JSONResponse:  # noqa: ARG001
    return JSONResponse(status_code=exc.status_code, content=exc.to_payload())


def envelope(code: ErrorCode, message: str, *, details: Any = None) -> dict[str, Any]:
    """Helper per costruire la stessa busta fuori dal flow eccezioni
    (es. handler di ``HTTPException`` di FastAPI per i 422 validation)."""

    return AgentException(code, message, details=details).to_payload()
