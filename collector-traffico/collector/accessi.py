"""Chi accede a cosa (tappa 7, ZONA ROSSA, 23/11/2026). SPENTO di serie: si accende solo con `ACCESSI=1`.

Dalla copia del traffico si legge il NOME UTENTE di un accesso e com'è andato, mai altro:
- Kerberos (porta 88): nome e dominio dalla richiesta AS-REQ; esito dalla risposta (AS-REP o errore);
- SMB (porta 445): utente e dominio dal messaggio NTLM AUTHENTICATE; esito dallo stato della risposta;
- LDAP (porta 389): il nome del bind; la parte con la password non si legge nemmeno.

Regole da non rompere (prova: `tests/test_accessi.py`, con una cattura vera del banco):
- mai password, hash, risposte NTLM, biglietti o testi cifrati: si leggono solo i campi del nome;
- un nome con caratteri non stampabili si scarta intero, non si «ripulisce»;
- mai un nome utente nei log o negli errori;
- ogni dizionario ha un tetto.
"""
from __future__ import annotations

from .controlli import _ber

PORTE = (88, 445, 389)
ATTESE_MASSIME = 5000   # richieste in attesa di risposta
RIGHE_MASSIME = 5000    # righe per finestra
LUNGHEZZA_MASSIMA = 128

KRB_ERRORI_FALLITO = {6, 12, 18, 23, 24}  # utente sconosciuto, restrizioni, revocato, password scaduta, password sbagliata
KRB_PREAUTH_RICHIESTA = 25                 # normale primo giro: non è un esito
SMB_IN_CORSO = 0xC0000016                  # MORE_PROCESSING_REQUIRED


def _nome_pulito(b: bytes, codifica: str) -> str | None:
    try:
        t = b.decode(codifica)
    except UnicodeDecodeError:
        return None
    t = t.strip()
    if not t or len(t) > LUNGHEZZA_MASSIMA or not t.isprintable():
        return None
    return t


def _figli(dati: bytes, inizio: int, fine: int):
    """Gli elementi BER fra `inizio` e `fine`: (tag, inizio del valore, lunghezza)."""
    i = inizio
    while i < fine:
        e = _ber(dati, i)
        if not e or e[1] + e[2] > fine:
            return
        yield e
        i = e[1] + e[2]


def _figlio(dati: bytes, e: tuple[int, int, int], tag: int):
    for f in _figli(dati, e[1], e[1] + e[2]):
        if f[0] == tag:
            return f
    return None


def _kerberos(carico: bytes, tcp: bool) -> tuple[str, object] | None:
    """('richiesta', (utente, dominio)) · ('riuscito', None) · ('fallito', None) · None."""
    if tcp:
        if len(carico) < 4:
            return None
        carico = carico[4:]  # lunghezza del messaggio
    radice = _ber(carico, 0)
    if not radice:
        return None
    if radice[0] == 0x6B:  # AS-REP: basta il primo byte (la risposta intera è più lunga della cattura)
        return ("riuscito", None)
    if radice[1] + radice[2] > len(carico):
        return None
    seq = _ber(carico, radice[1])
    if not seq or seq[0] != 0x30:
        return None
    if radice[0] == 0x7E:  # KRB-ERROR: error-code [6]
        codice = _figlio(carico, seq, 0xA6)
        intero = _ber(carico, codice[1]) if codice else None
        if not intero:
            return None
        n = int.from_bytes(carico[intero[1]:intero[1] + intero[2]], "big")
        if n == KRB_PREAUTH_RICHIESTA:
            return None
        return ("fallito", None) if n in KRB_ERRORI_FALLITO else None
    if radice[0] != 0x6A:  # AS-REQ
        return None
    corpo = _figlio(carico, seq, 0xA4)  # req-body [4]
    corpo = _ber(carico, corpo[1]) if corpo else None
    if not corpo:
        return None
    cname, realm = _figlio(carico, corpo, 0xA1), _figlio(carico, corpo, 0xA2)
    if not cname or not realm:
        return None
    pn = _ber(carico, cname[1])
    stringhe = _figlio(carico, pn, 0xA1) if pn else None
    elenco = _ber(carico, stringhe[1]) if stringhe else None
    if not elenco:
        return None
    parti = [carico[f[1]:f[1] + f[2]] for f in _figli(carico, elenco[1], elenco[1] + elenco[2]) if f[0] == 0x1B]
    r = _ber(carico, realm[1])
    utente = _nome_pulito(b"/".join(parti), "utf-8") if parti else None
    dominio = _nome_pulito(carico[r[1]:r[1] + r[2]], "utf-8") if r else None
    if not utente:
        return None
    return ("richiesta", (utente, dominio or ""))


def _smb(carico: bytes) -> tuple[str, object] | None:
    """SMB2 su TCP. ('richiesta', (utente, dominio)) dall'AUTHENTICATE di NTLM; esito dalla risposta a SESSION_SETUP."""
    i = carico.find(b"\xfeSMB")
    if i < 0 or i + 64 > len(carico) or int.from_bytes(carico[i + 12:i + 14], "little") != 0x0001:
        return None
    risposta = int.from_bytes(carico[i + 16:i + 20], "little") & 1
    if risposta:
        stato = int.from_bytes(carico[i + 8:i + 12], "little")
        if stato == SMB_IN_CORSO:
            return None
        return ("riuscito" if stato == 0 else "fallito", None)
    j = carico.find(b"NTLMSSP\x00\x03\x00\x00\x00", i)
    if j < 0 or j + 64 > len(carico):
        return None
    unicode = int.from_bytes(carico[j + 60:j + 64], "little") & 1
    def campo(off: int) -> str | None:  # noqa: E306
        lungo = int.from_bytes(carico[j + off:j + off + 2], "little")
        pos = int.from_bytes(carico[j + off + 4:j + off + 8], "little")
        if lungo == 0 or j + pos + lungo > len(carico):
            return None
        return _nome_pulito(carico[j + pos:j + pos + lungo], "utf-16-le" if unicode else "latin-1")
    utente = campo(36)
    if not utente:
        return None  # anonimo, o nome tronco dalla cattura: non si dice niente
    return ("richiesta", (utente, campo(28) or ""))


def _ldap(carico: bytes) -> tuple[str, object] | None:
    """('richiesta', (nome, '')) da un bindRequest; esito dal bindResponse. La parte `authentication` non si legge."""
    msg = _ber(carico, 0)
    if not msg or msg[0] != 0x30:
        return None
    figli = list(_figli(carico, msg[1], min(len(carico), msg[1] + msg[2])))
    if len(figli) < 2 or figli[0][0] != 0x02:
        return None
    op = figli[1]
    if op[0] == 0x61:  # bindResponse: resultCode ENUMERATED per primo
        codice = _ber(carico, op[1])
        if not codice or codice[0] != 0x0A:
            return None
        return ("riuscito" if int.from_bytes(carico[codice[1]:codice[1] + codice[2]], "big") == 0 else "fallito", None)
    if op[0] != 0x60:  # bindRequest: version, name, authentication
        return None
    parti = list(_figli(carico, op[1], min(len(carico), op[1] + op[2])))
    if len(parti) < 2 or parti[1][0] != 0x04:
        return None
    nome = _nome_pulito(carico[parti[1][1]:parti[1][1] + parti[1][2]], "utf-8")
    return ("richiesta", (nome, "")) if nome else None


class Accessi:
    """`lato(ip)` come per le connessioni; `scrivi(inizio, righe)` a ogni finestra chiusa."""

    def __init__(self, lato, scrivi):
        self._lato = lato
        self._scrivi = scrivi
        self._attese: dict[tuple, tuple[str, str, str]] = {}   # (client, porta client, server, porta) → (protocollo, utente, dominio)
        self._conti: dict[tuple, int] = {}                     # (client, server, protocollo, utente, dominio, esito) → volte

    def pacchetto(self, proto: int, src: str, dst: str, sport: int, dport: int, carico: bytes) -> None:
        porta = dport if dport in PORTE else sport if sport in PORTE else 0
        if not porta or not carico:
            return
        if porta == 88:
            r, protocollo = _kerberos(carico, proto == 6), "kerberos"
        elif porta == 445 and proto == 6:
            r, protocollo = _smb(carico), "smb"
        elif porta == 389 and proto == 6:
            r, protocollo = _ldap(carico), "ldap"
        else:
            return
        if r is None:
            return
        cosa, valore = r
        if cosa == "richiesta":
            if dport != porta:
                return
            if len(self._attese) < ATTESE_MASSIME or (src, sport, dst, dport) in self._attese:
                self._attese[(src, sport, dst, dport)] = (protocollo, valore[0], valore[1])
            return
        if sport != porta:
            return
        attesa = self._attese.pop((dst, dport, src, sport), None)
        if attesa is None:
            return
        chiave = (self._lato(dst), self._lato(src), attesa[0], attesa[1], attesa[2], cosa)
        if len(self._conti) < RIGHE_MASSIME or chiave in self._conti:
            self._conti[chiave] = self._conti.get(chiave, 0) + 1

    def chiudi_finestra(self, inizio: str) -> None:
        righe = [{"client": c, "server": s, "protocollo": p, "utente": u, "dominio": d, "esito": e, "volte": n}
                 for (c, s, p, u, d, e), n in self._conti.items()]
        self._conti = {}
        self._attese = {}  # una risposta arriva in pochi secondi: chi è ancora in attesa a fine finestra non avrà esito
        if righe:
            self._scrivi(inizio, righe)
