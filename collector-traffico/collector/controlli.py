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
    # tappa 6 (23/11): certificato visto nel saluto del server; i due DNS li decide `ascolto`, che conta per finestra
    "tls_certificato", "dns_esterno", "dns_errori",
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


def _tempo_asn1(tag: int, valore: bytes) -> str | None:
    """UTCTime (23) o GeneralizedTime (24) → «AAAA-MM-GG HH:MM:SS». None se non si legge."""
    try:
        t = valore.decode("ascii").rstrip("Z")
    except UnicodeDecodeError:
        return None
    if tag == 23 and len(t) >= 12 and t[:12].isdigit():
        anno = int(t[:2])
        t = f"{1900 + anno if anno >= 50 else 2000 + anno}{t[2:]}"
    elif not (tag == 24 and len(t) >= 14 and t[:14].isdigit()):
        return None
    return f"{t[0:4]}-{t[4:6]}-{t[6:8]} {t[8:10]}:{t[10:12]}:{t[12:14] if len(t) >= 14 else '00'}"


def _primo_certificato(carico: bytes) -> bytes | None:
    """Dal volo del server (TLS fino alla 1.2, in chiaro): i byte del primo certificato, anche tronchi.
    I messaggi di handshake possono stare in più record consecutivi: si ricuciono."""
    flusso = b""
    i = 0
    while i + 5 <= len(carico) and carico[i] == 0x16 and carico[i + 1] == 0x03:
        lungo = int.from_bytes(carico[i + 3:i + 5], "big")
        flusso += carico[i + 5:i + 5 + lungo]
        i += 5 + lungo
    j = 0
    while j + 4 <= len(flusso):
        tipo, lungo = flusso[j], int.from_bytes(flusso[j + 1:j + 4], "big")
        if tipo == 11:  # Certificate: lunghezza dell'elenco (3), lunghezza del primo (3), il primo
            if j + 10 > len(flusso):
                return None
            n = int.from_bytes(flusso[j + 7:j + 10], "big")
            return flusso[j + 10:j + 10 + n]
        if tipo != 2:  # prima del certificato c'è solo il ServerHello
            return None
        j += 4 + lungo
    return None


def certificato(carico: bytes) -> dict | None:
    """Dal saluto del server: {'scade': data o None, 'autofirmato': True/False/None}. None se qui non c'è un certificato.
    Un certificato tronco (la cattura tiene i primi byte) dice quello che si vede: None dove non si vede."""
    der = _primo_certificato(carico)
    if not der:
        return None
    cert = _ber(der, 0)
    if not cert or cert[0] != 0x30:
        return None
    tbs = _ber(der, cert[1])
    if not tbs or tbs[0] != 0x30:
        return None
    i = tbs[1]
    pezzi: list[tuple[int, int, int]] = []
    while len(pezzi) < 6:
        e = _ber(der, i)
        if not e:
            break
        if not pezzi and e[0] == 0xA0:  # [0] versione: facoltativa
            i = e[1] + e[2]
            continue
        pezzi.append(e)
        i = e[1] + e[2]
    # numero di serie, algoritmo, emittente, validità, soggetto
    esito: dict = {"scade": None, "autofirmato": None}
    if len(pezzi) >= 4 and pezzi[3][0] == 0x30:
        prima = _ber(der, pezzi[3][1])
        dopo = _ber(der, prima[1] + prima[2]) if prima else None
        if dopo and dopo[1] + dopo[2] <= len(der):
            esito["scade"] = _tempo_asn1(dopo[0], der[dopo[1]:dopo[1] + dopo[2]])
    if len(pezzi) >= 5 and pezzi[4][1] + pezzi[4][2] <= len(der):
        emittente = der[pezzi[2][1]:pezzi[2][1] + pezzi[2][2]]
        soggetto = der[pezzi[4][1]:pezzi[4][1] + pezzi[4][2]]
        esito["autofirmato"] = emittente == soggetto
    return esito


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
        # la risposta di stato (tipo 0x21, di solito al nome «*») la dà ogni macchina: non è un nome conteso
        if carico[46:48] == b"\x00\x21":
            return None
        nome = _nome_netbios(carico)
        return None if nome is None or nome.startswith("*") else nome
    return None


import re as _re

_VERSIONE = _re.compile(rb"([A-Za-z][A-Za-z0-9-]{1,40})[ /_-]v?(\d+(?:\.\d+)+[A-Za-z0-9.+-]{0,20})")
_BROWSER = (b"Edg/", b"OPR/", b"Firefox/", b"Chrome/", b"Safari/")


def _nome_versione(testo: bytes, anche_senza_versione: bool = True) -> str | None:
    """«Nome versione» dalla prima coppia che si legge («OpenSSH_9.2p1» → «OpenSSH 9.2p1»); il nome solo se non c'è versione."""
    testo = testo.strip()[:200]
    m = _VERSIONE.search(testo)
    if m:
        out = f"{m.group(1).decode('ascii', 'replace')} {m.group(2).decode('ascii', 'replace')}"
    elif not anche_senza_versione:
        return None
    else:
        primo = testo.split(b" ")[0].split(b"/")[0]
        out = primo.decode("ascii", "replace") if primo else ""
    return out if out and out.isprintable() else None


def _intestazione(carico: bytes, nome: bytes) -> bytes | None:
    i = carico[:2048].lower().find(b"\n" + nome + b":")
    if i < 0:
        return None
    fine = carico.find(b"\r", i + 1)
    return carico[i + len(nome) + 2:fine if fine > 0 else i + 300].strip()


def programma(proto: int, sport: int, dport: int, carico: bytes) -> str | None:
    """La versione che un programma dichiara di sé in un saluto in chiaro, nella forma di Zeek (`software.log`):
    `<tipo>:<nome> <versione>`, del programma di chi MANDA il pacchetto. Tappa 7, parte non rossa (Riccardo, 23/11:
    la versione dichiarata è una delle due eccezioni a «il fatto e mai il valore»)."""
    if proto != TCP or not carico:
        return None
    nv = None
    if carico.startswith(b"SSH-") and 22 in (sport, dport):
        nv, tipo = _nome_versione(carico.split(b"\r")[0].split(b"\n")[0].split(b"-", 2)[-1]), "SSH::SERVER" if sport == 22 else "SSH::CLIENT"
    elif sport == 80 and carico.startswith(b"HTTP/"):
        v = _intestazione(carico, b"server")
        nv, tipo = (_nome_versione(v) if v else None), "HTTP::SERVER"
    elif dport == 80:
        v = _intestazione(carico, b"user-agent")
        if v:
            for b in _BROWSER:
                j = v.find(b)
                if v.startswith(b"Mozilla/") and j >= 0:
                    v = v[j:]
                    break
            nv, tipo = _nome_versione(v), "HTTP::BROWSER"
    elif sport in (21, 25) and carico.startswith(b"220"):
        # il saluto dice spesso il nome della macchina: senza una versione non si tiene niente
        riga = carico.split(b"\r")[0].split(b"\n")[0][4:]
        nv, tipo = _nome_versione(riga, anche_senza_versione=False), "FTP::SERVER" if sport == 21 else "SMTP::MAIL_SERVER"
    return f"{tipo}:{nv}"[:253] if nv else None


def nomi(proto: int, sport: int, dport: int, carico: bytes) -> list[tuple[str, str]]:
    """I nomi che si tengono: quello chiesto al DNS, quello del server nel saluto TLS, il programma dichiarato."""
    sw = programma(proto, sport, dport, carico)
    if sw:
        return [("software", sw)]
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
