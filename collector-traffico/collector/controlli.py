"""Controlli sul contenuto: una lista corta e fissa, sui primi byte di una connessione.

Funzioni pure su (proto, porta sorgente, porta destinazione, carico). Non c'è un motore di
firme: ogni controllo è scritto qui. Si salva il FATTO («FTP con password in chiaro»),
mai il valore: nessuna funzione restituisce password, utenti, comunità SNMP o URL.
"""
from __future__ import annotations

TCP, UDP = 6, 17

# Gravità e testo stanno in IPAM: qui solo il tipo e, dove serve, un dettaglio senza valori.
TIPI = (
    "chiaro_telnet", "chiaro_ftp", "chiaro_posta", "chiaro_http_basic", "chiaro_ldap", "snmp_vecchio",
    "smb1", "tls_vecchio", "ntlm1", "nome_conteso", "impianto_scrittura", "dns_anomalo",
)

MODBUS_SCRITTURE = {5: "bobina", 6: "registro", 15: "bobine", 16: "registri"}
S7_SCRITTURA = 0x05
DNS_NOME_LUNGO = 100


def _fatto(tipo: str, verso_server: bool = True, **dettaglio: object) -> dict:
    """`verso_server`: il pacchetto va dal client al server (falso per le risposte)."""
    return {"tipo": tipo, "verso_server": verso_server, "dettaglio": dettaglio}


def _ber(dati: bytes, i: int) -> tuple[int, int, int] | None:
    """Un elemento BER a partire da `i`: (tag, inizio del valore, lunghezza). None se non torna."""
    if i + 2 > len(dati):
        return None
    tag, n = dati[i], dati[i + 1]
    i += 2
    if n & 0x80:
        quanti = n & 0x7F
        if quanti == 0 or quanti > 4 or i + quanti > len(dati):
            return None
        n = int.from_bytes(dati[i:i + quanti], "big")
        i += quanti
    return tag, i, n


def _prima_riga(carico: bytes) -> bytes:
    return carico.split(b"\r", 1)[0].split(b"\n", 1)[0].upper()


def _ldap_bind_semplice(carico: bytes) -> bool:
    """LDAPMessage { messageID, bindRequest [APPLICATION 0] { version, name, simple [0] <password> } }
    con password non vuota (il bind anonimo ha la password vuota e non è una credenziale)."""
    e = _ber(carico, 0)
    if not e or e[0] != 0x30:
        return False
    e = _ber(carico, e[1])  # messageID
    if not e or e[0] != 0x02:
        return False
    e = _ber(carico, e[1] + e[2])  # bindRequest
    if not e or e[0] != 0x60:
        return False
    e = _ber(carico, e[1])  # version
    if not e or e[0] != 0x02:
        return False
    e = _ber(carico, e[1] + e[2])  # name
    if not e or e[0] != 0x04:
        return False
    e = _ber(carico, e[1] + e[2])  # authentication
    return bool(e) and e[0] == 0x80 and e[2] > 0


def _snmp(carico: bytes) -> dict | None:
    e = _ber(carico, 0)
    if not e or e[0] != 0x30:
        return None
    v = _ber(carico, e[1])
    if not v or v[0] != 0x02 or v[2] != 1:
        return None
    versione = carico[v[1]] if v[1] < len(carico) else 9
    if versione not in (0, 1):
        return None
    c = _ber(carico, v[1] + v[2])
    if not c or c[0] != 0x04:
        return None
    comunita = carico[c[1]:c[1] + c[2]]
    # Si dice solo SE è una delle due di fabbrica: il valore non esce da qui.
    return _fatto("snmp_vecchio", versione="1" if versione == 0 else "2c", comunita_nota=comunita in (b"public", b"private"))


def saluto_tls(carico: bytes) -> tuple[int, str] | None:
    """Dal saluto del client (ClientHello): (versione massima offerta, nome del server o '')."""
    if len(carico) < 43 or carico[0] != 0x16 or carico[1] != 0x03 or carico[5] != 0x01:
        return None
    massima = int.from_bytes(carico[9:11], "big")
    i = 11 + 32  # casuale
    if i >= len(carico):
        return massima, ""
    i += 1 + carico[i]  # sessione
    if i + 2 > len(carico):
        return massima, ""
    i += 2 + int.from_bytes(carico[i:i + 2], "big")  # cifrari
    if i + 1 > len(carico):
        return massima, ""
    i += 1 + carico[i]  # compressione
    if i + 2 > len(carico):
        return massima, ""
    fine = min(len(carico), i + 2 + int.from_bytes(carico[i:i + 2], "big"))
    i += 2
    nome = ""
    while i + 4 <= fine:
        tipo = int.from_bytes(carico[i:i + 2], "big")
        lungo = int.from_bytes(carico[i + 2:i + 4], "big")
        corpo = carico[i + 4:i + 4 + lungo]
        if tipo == 0x0000 and len(corpo) >= 5 and corpo[2] == 0:
            n = int.from_bytes(corpo[3:5], "big")
            nome = corpo[5:5 + n].decode("ascii", "replace").lower()
        elif tipo == 0x002B and corpo:  # supported_versions: la versione vera, da TLS 1.3 in poi
            versioni = [int.from_bytes(corpo[j:j + 2], "big") for j in range(1, min(len(corpo), 1 + corpo[0]) - 1, 2)]
            # i valori «GREASE» (0x?a?a) sono riempitivi, non versioni
            versioni = [v for v in versioni if (v & 0x0F0F) != 0x0A0A]
            if versioni:
                massima = max(versioni)
        i += 4 + lungo
    return massima, nome


def _ntlm1(carico: bytes) -> bool:
    """Messaggio NTLM di tipo 3 con risposta NT lunga 24 byte: è NTLM versione 1."""
    i = carico.find(b"NTLMSSP\x00\x03\x00\x00\x00")
    if i < 0 or i + 24 > len(carico):
        return False
    return int.from_bytes(carico[i + 20:i + 22], "little") == 24


def _s7_scrittura(carico: bytes) -> bool:
    """TPKT (03 00) + COTP dati (02 f0 80) + S7 (32), richiesta (01), funzione «scrivi variabile»."""
    return (len(carico) >= 18 and carico[0] == 0x03 and carico[1] == 0x00 and carico[4:7] == b"\x02\xf0\x80"
            and carico[7] == 0x32 and carico[8] == 0x01 and carico[17] == S7_SCRITTURA)


def nome_dns(carico: bytes, i: int = 12) -> str | None:
    """Il nome della prima domanda di un messaggio DNS (anche LLMNR, stessa forma)."""
    pezzi: list[str] = []
    while i < len(carico):
        n = carico[i]
        if n == 0:
            return ".".join(pezzi).lower() if pezzi else None
        if n & 0xC0 or i + 1 + n > len(carico):
            return None
        pezzi.append(carico[i + 1:i + 1 + n].decode("ascii", "replace"))
        i += 1 + n
    return None


def _nome_netbios(carico: bytes) -> str | None:
    """Nome NetBIOS in «mezzi byte» (32 lettere A-P) dopo l'intestazione di 12 byte."""
    if len(carico) < 12 + 34 or carico[12] != 0x20:
        return None
    grezzo = carico[13:45]
    try:
        nome = bytes(((grezzo[j] - 65) << 4) | (grezzo[j + 1] - 65) for j in range(0, 32, 2))
    except ValueError:
        return None
    return nome[:15].decode("ascii", "replace").strip().lower() or None


def risposta_nome(proto: int, sport: int, carico: bytes) -> str | None:
    """Se il pacchetto è una RISPOSTA LLMNR (5355) o NetBIOS (137) con almeno una risposta: il nome.
    Chi decide se è «conteso» è `ascolto`, che ricorda chi aveva risposto prima."""
    if proto != UDP or len(carico) < 12 or not carico[2] & 0x80 or int.from_bytes(carico[6:8], "big") == 0:
        return None
    if sport == 5355:
        return nome_dns(carico)
    if sport == 137:
        return _nome_netbios(carico)
    return None


def nomi(proto: int, sport: int, dport: int, carico: bytes) -> list[tuple[str, str]]:
    """I nomi che si tengono: quello chiesto al DNS e quello del server nel saluto TLS."""
    if proto == UDP and dport == 53 and len(carico) > 12 and not carico[2] & 0x80:
        n = nome_dns(carico)
        return [("dns", n[:253])] if n else []
    if proto == TCP:
        s = saluto_tls(carico)
        if s and s[1]:
            return [("sni", s[1][:253])]
    return []


def controlla(proto: int, sport: int, dport: int, carico: bytes) -> list[dict]:
    """I fatti che questo pacchetto dimostra. Lista vuota: niente da dire."""
    if not carico:
        return []
    fatti: list[dict] = []
    if proto == TCP:
        if dport == 23:
            fatti.append(_fatto("chiaro_telnet"))
        elif dport == 21:
            if _prima_riga(carico).startswith(b"PASS "):
                fatti.append(_fatto("chiaro_ftp"))
        elif dport == 110:
            if _prima_riga(carico).startswith((b"USER ", b"PASS ")):
                fatti.append(_fatto("chiaro_posta", protocollo="pop3"))
        elif dport == 143:
            parole = _prima_riga(carico).split()
            if len(parole) >= 3 and parole[1] == b"LOGIN":
                fatti.append(_fatto("chiaro_posta", protocollo="imap"))
        elif dport == 25:
            if _prima_riga(carico).startswith((b"AUTH PLAIN", b"AUTH LOGIN")):
                fatti.append(_fatto("chiaro_posta", protocollo="smtp"))
        elif dport == 80:
            if b"\nauthorization: basic " in carico[:2048].lower():
                fatti.append(_fatto("chiaro_http_basic"))
        elif dport == 389:
            if _ldap_bind_semplice(carico):
                fatti.append(_fatto("chiaro_ldap"))
        elif dport == 502:
            if len(carico) >= 8 and carico[2:4] == b"\x00\x00" and carico[7] in MODBUS_SCRITTURE:
                fatti.append(_fatto("impianto_scrittura", protocollo="modbus", cosa=MODBUS_SCRITTURE[carico[7]]))
        elif dport == 102:
            if _s7_scrittura(carico):
                fatti.append(_fatto("impianto_scrittura", protocollo="s7", cosa="variabile"))
        if sport == 445 and len(carico) >= 14 and carico[4:8] == b"\xffSMB" and carico[8] == 0x72 and carico[13] & 0x80:
            # La RISPOSTA alla negoziazione in SMB1: il server lo parla davvero. La sola richiesta
            # non basta, i client moderni la mandano per chiedere «anche SMB2?».
            fatti.append(_fatto("smb1", verso_server=False))
        if dport == 445 and _ntlm1(carico):
            fatti.append(_fatto("ntlm1"))
        s = saluto_tls(carico)
        if s and s[0] <= 0x0301:
            fatti.append(_fatto("tls_vecchio", versione={0x0300: "SSL 3.0", 0x0301: "TLS 1.0"}.get(s[0], "più vecchia")))
    elif proto == UDP:
        if dport == 161:
            f = _snmp(carico)
            if f:
                fatti.append(f)
        elif dport == 53 and len(carico) > 12 and not carico[2] & 0x80:
            n = nome_dns(carico)
            if n and len(n) > DNS_NOME_LUNGO:
                fatti.append(_fatto("dns_anomalo", motivo="nome_lungo", lunghezza=len(n)))
    return fatti
