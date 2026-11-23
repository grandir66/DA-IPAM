"""Chi fa cosa: l'unico posto che dice da quale fonte esce ogni controllo sul contenuto.

Nel profilo leggero tutto viene da `ascolto`; nell'avanzato i tipi in `DA_ZEEK` vengono dai registri di Zeek
(`zeek_adattatore.traduci_fatti`) e `ascolto` non li fa. Un controllo non deve mai uscire due volte, né sparire:
`tests/test_profili.py` controlla che ogni tipo abbia una fonte sola e che `TIPI` sia `TIPI_FATTO` di IPAM.
"""
from __future__ import annotations

# = TIPI_FATTO di src/lib/traffico/anomalie.ts (la prova lo controlla)
TIPI = (
    "chiaro_telnet", "chiaro_ftp", "chiaro_posta", "chiaro_http_basic", "chiaro_ldap", "snmp_vecchio",
    "smb1", "tls_vecchio", "ntlm1", "nome_conteso", "impianto_scrittura", "dns_anomalo",
    "tls_certificato", "dns_esterno", "dns_errori",
    # sonda avanzata, Task 6 (23/11): dagli avvisi di Zeek, solo nel profilo avanzato
    "password_ssh_provate", "sql_injection",
)

# Tipi che sa fare solo Zeek: nel profilo leggero non li fa nessuno (dichiarato, non dimenticato).
SOLO_ZEEK: frozenset[str] = frozenset({"password_ssh_provate", "sql_injection"})

# Visti nei registri del banco del PX-NAS (23/11/2026): ftp (accesso_chiaro), http (accesso_basic), snmp (versione,
# comunita_nota), ssl (versione), modbus (funzione), ldap (opcode del bind). smb1 e ntlm1: Zeek li distingue
# (`smb_mapping`/`smb_files` non bastano, ma `conn.service` e `ntlm` sì) solo in parte: restano ad `ascolto`
# finché non c'è una cattura vera che lo provi (sul banco non c'è un server SMB).
# tls_certificato (Task 6): da `ssl` + `x509` (scaduto) e dall'avviso SSL::Invalid_Server_Cert (autofirmato, non valido).
DA_ZEEK: frozenset[str] = frozenset({
    "chiaro_ftp", "chiaro_http_basic", "chiaro_ldap", "snmp_vecchio", "tls_vecchio", "impianto_scrittura",
    "tls_certificato",
}) | SOLO_ZEEK

# Un tipo che Zeek fa solo in parte: la parte che non fa resta ad `ascolto`, e lì si controlla solo quella.
# impianto_scrittura: Zeek legge Modbus, non S7 (pacchetto aggiuntivo, fuori dal piano) → ascolto guarda solo la porta 102.
IN_PARTE = {"impianto_scrittura": "s7"}

PROFILI = ("leggero", "avanzato")


def fonte(tipo: str, profilo: str) -> str:
    """"zeek" | "ascolto" | "nessuna" (un tipo di SOLO_ZEEK nel profilo leggero).
    Un tipo che Zeek fa in parte, per la sua parte, è "zeek": la parte restante sta in IN_PARTE."""
    if tipo not in TIPI:
        raise ValueError(f"tipo sconosciuto: {tipo}")
    if profilo == "avanzato" and tipo in DA_ZEEK:
        return "zeek"
    return "nessuna" if tipo in SOLO_ZEEK else "ascolto"


def ascolto_lo_fa(tipo: str, profilo: str, parte: str = "") -> bool:
    """Se `ascolto` deve controllare questo tipo (e, per i tipi divisi, questa parte: es. "modbus", "s7")."""
    if fonte(tipo, profilo) == "ascolto":
        return True
    return IN_PARTE.get(tipo) == parte != ""
