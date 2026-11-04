#!/usr/bin/env python3
"""
Verifica di un login SMB via impacket, senza aprire nessuna condivisione.

Serve a distinguere «password errata» da «diritti mancanti» prima di provare
WinRM/WMI su un host (piano accesso Windows, Task 3): un solo logon, poi si esce.

Input JSON (stdin): host, username, password, port (opzionale, default 445).
  username: DOMINIO\\utente, utente@dominio.fqdn oppure utente nudo (account locale).

Output JSON (stdout, exit 0 sempre): {"esito": "valida" | "errata" | "non_so", "dettaglio": "..."}
  - valida: sessione aperta con un utente vero (una sessione guest NON vale: Windows mappa
    gli utenti ignoti a guest, e il login «riuscirebbe» con qualunque password);
  - errata: SOLO STATUS_LOGON_FAILURE (0xC000006D);
  - non_so: tutto il resto (account disabilitato, scaduto, bloccato, rete, timeout, impacket assente).

La password non compare mai né nell'output né negli errori.
"""
import json
import sys

TIMEOUT_S = 10


def _fine(esito: str, dettaglio: str = ""):
    print(json.dumps({"esito": esito, "dettaglio": dettaglio}))
    sys.exit(0)


def main():
    try:
        req = json.loads(sys.stdin.read())
    except Exception:
        _fine("non_so", "input non valido")

    host = req.get("host", "")
    username = req.get("username", "")
    password = req.get("password", "")
    port = req.get("port", 445)
    if not host or not username or not isinstance(port, int):
        _fine("non_so", "host e username obbligatori")

    # DOMINIO\utente oppure utente@dominio.fqdn → utente, dominio NetBIOS (come wmi-bridge.py)
    domain = ""
    user = username
    if "\\" in username:
        domain, user = username.split("\\", 1)
    elif "@" in username:
        user, domain = username.split("@", 1)
        domain = domain.split(".", 1)[0]
    if domain == ".":
        domain = ""

    try:
        from impacket.smbconnection import SMBConnection, SessionError
        from impacket.nt_errors import STATUS_LOGON_FAILURE
    except ImportError as e:
        _fine("non_so", "impacket assente: %s" % type(e).__name__)

    conn = None
    try:
        conn = SMBConnection(host, host, sess_port=port, timeout=TIMEOUT_S)
        conn.login(user, password, domain)
        if conn.isGuestSession():
            _fine("non_so", "sessione guest")
        try:
            conn.logoff()
        except Exception:
            pass
        _fine("valida")
    except SessionError as e:
        try:
            codice = e.getErrorCode()
        except Exception:
            codice = None
        if codice == STATUS_LOGON_FAILURE:
            _fine("errata", "STATUS_LOGON_FAILURE")
        _fine("non_so", "SessionError 0x%x" % codice if isinstance(codice, int) else "SessionError")
    except SystemExit:
        raise
    except Exception as e:
        _fine("non_so", type(e).__name__)
    finally:
        try:
            if conn:
                conn.close()
        except Exception:
            pass


if __name__ == "__main__":
    main()
