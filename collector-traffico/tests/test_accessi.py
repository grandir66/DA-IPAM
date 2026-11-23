"""Tappa 7, ZONA ROSSA (23/11/2026): chi accede a cosa. Prova di non-fuga scritta PRIMA del codice.

La cattura `dati/accessi-banco.pcap` è vera: banco del PX-NAS, 23/11/2026, dal contenitore 110 verso un
controller di dominio FINTO (contenitore 111, Samba, dominio banco.test, utente `prova`). Per Kerberos, SMB e
LDAP un accesso con la password giusta e uno con quella sbagliata, più un saluto SSH e una richiesta HTTP.
Password finte: «ProvaSegretaAccessi7» (giusta) e «Sbagliata99x». MAC azzerati.

Regola (Riccardo, 23/11): del contenuto si salva il fatto e mai il valore; uniche eccezioni il NOME UTENTE di un
accesso e la versione dichiarata di un programma. Mai password, hash, risposte NTLM, biglietti Kerberos.
La prova raccoglie TUTTO quello che il collector scriverebbe (fatti, nomi, identità, connessioni, accessi) e lo
cerca: password in ogni forma, blob cifrati presi dalla cattura, sequenze lunghe che sembrano dati codificati.
"""
import base64
import json
import os
import re
import unittest

from collector.ascolto import Ascolto, leggi_pcap
from collector.piega import RETI_INTERNE_DI_SERIE as RETI

CATTURA = os.path.join(os.path.dirname(__file__), "dati", "accessi-banco.pcap")
PASSWORD = ["ProvaSegretaAccessi7", "Sbagliata99x"]


def pacchetti():
    with open(CATTURA, "rb") as f:
        yield from leggi_pcap(f)


def blob_ntlm(cattura: list[bytes]) -> list[bytes]:
    """Le risposte NTLM (LM e NT) dei messaggi AUTHENTICATE della cattura: sono derivate dalla password."""
    blob = []
    for p in cattura:
        i = p.find(b"NTLMSSP\x00\x03\x00\x00\x00")
        while i >= 0:
            for campo in (12, 20):  # LmChallengeResponse, NtChallengeResponse: lunghezza (2), max (2), posizione (4)
                lungo = int.from_bytes(p[i + campo:i + campo + 2], "little")
                pos = int.from_bytes(p[i + campo + 4:i + campo + 8], "little")
                if lungo >= 16 and i + pos + lungo <= len(p):
                    blob.append(p[i + pos:i + pos + lungo])
            i = p.find(b"NTLMSSP\x00\x03\x00\x00\x00", i + 1)
    return blob


def blob_kerberos(cattura: list[bytes]) -> list[bytes]:
    """I testi cifrati di Kerberos (OCTET STRING lunghe dentro `cipher [2]`): timestamp cifrato, biglietti, enc-part."""
    blob = []
    for p in cattura:
        for m in re.finditer(rb"\xa2(?:\x82..|\x81.|[\x00-\x7f])\x04(\x82..|\x81.|[\x00-\x7f])", p, re.S):
            l = m.group(1)
            n = l[0] if len(l) == 1 else int.from_bytes(l[1:], "big")
            if n >= 32 and m.end() + n <= len(p):
                blob.append(p[m.end():m.end() + n])
    return blob


def forme(b: bytes) -> list[str]:
    """Come un segreto può finire scritto: esadecimale, base64, testo."""
    return [b.hex(), b.hex().upper(), base64.b64encode(b).decode(), b.decode("latin-1")]


class Collezionista:
    """Tutto quello che il collector scriverebbe, come testo, in un posto solo."""

    def __init__(self):
        self.scritto: list[str] = []
        self.accessi: list[dict] = []

    def ascolto(self, scrivi_accessi=True) -> Ascolto:
        s = self.scritto
        kw = {}
        if scrivi_accessi:
            def accessi(inizio, righe):
                self.accessi.extend(righe)
                s.append(json.dumps(righe, ensure_ascii=False))
            kw["scrivi_accessi"] = accessi
        return Ascolto(
            RETI,
            lambda *f: s.append(json.dumps(f, ensure_ascii=False)),
            lambda visto, c: s.append(json.dumps([list(k) + [v] for k, v in c.items()], ensure_ascii=False)),
            lambda voci: s.append(json.dumps(voci, ensure_ascii=False)),
            lambda voci: s.append(json.dumps(voci, ensure_ascii=False)),
            lambda inizio, righe: s.append(json.dumps(righe, ensure_ascii=False)),
            **kw,
        )


def fughe(testi: list[str], cattura: list[bytes]) -> list[str]:
    """Cosa di segreto compare in ciò che è stato scritto. Lista vuota: niente."""
    tutto = "\n".join(testi)
    trovate = []
    for pw in PASSWORD:
        for f in (pw, pw.lower(), pw.encode("utf-16-le").decode("latin-1"), pw.encode().hex(), base64.b64encode(pw.encode()).decode()):
            if f in tutto:
                trovate.append(f"password {pw!r}")
    for nome, blob in (("NTLM", blob_ntlm(cattura)), ("Kerberos", blob_kerberos(cattura))):
        for b in blob:
            for f in forme(b[:16]):
                if f in tutto:
                    trovate.append(f"blob {nome}")
                    break
    # sequenze che sembrano dati codificati: esadecimale lungo o base64 lungo
    if re.search(r"[0-9a-fA-F]{32,}", tutto):
        trovate.append("esadecimale lungo")
    if re.search(r"[A-Za-z0-9+/]{40,}={0,2}", tutto):
        trovate.append("base64 lungo")
    return trovate


class NonFuga(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cattura = [p for _, p in pacchetti()]

    def test_la_cattura_contiene_davvero_i_segreti(self):
        """Senza segreti nella cattura la prova non dimostrerebbe niente."""
        grezzo = b"".join(self.cattura)
        self.assertIn(PASSWORD[0].encode(), grezzo)   # bind LDAP semplice: password in chiaro
        self.assertTrue(blob_ntlm(self.cattura))      # SMB con NTLM
        self.assertTrue(blob_kerberos(self.cattura))  # Kerberos

    def test_il_rivelatore_scatta_se_si_scrive_il_grezzo(self):
        """Un collector che scrivesse il pacchetto (anche solo in esadecimale) deve far fallire la prova."""
        self.assertTrue(fughe([p.hex() for p in self.cattura], self.cattura))
        self.assertTrue(fughe([p.decode("latin-1") for p in self.cattura], self.cattura))

    def test_niente_segreti_in_cio_che_il_collector_scrive(self):
        c = Collezionista()
        a = c.ascolto()
        ultimo = 0
        for istante, p in pacchetti():
            ultimo = int(istante)
            a.pacchetto(ultimo, p, istante)
        a.chiudi(ultimo + 600)
        self.assertEqual(fughe(c.scritto, self.cattura), [])
        # e il nome utente c'è: altrimenti la prova passerebbe senza leggere niente
        visti = {(r["protocollo"], r["utente"].lower(), r["esito"]) for r in c.accessi}
        for protocollo in ("kerberos", "smb"):
            self.assertIn((protocollo, "prova", "riuscito"), visti, protocollo)
            self.assertIn((protocollo, "prova", "fallito"), visti, protocollo)
        self.assertTrue(any(p == "ldap" and "prova" in u for p, u, _ in visti), "ldap")

    def test_tagliati_a_600_byte_come_in_produzione(self):
        """La cattura del collector tiene 600 byte a pacchetto (`CATTURA`): niente segreti e gli esiti ci sono ancora."""
        c = Collezionista()
        a = c.ascolto()
        ultimo = 0
        for istante, p in pacchetti():
            ultimo = int(istante)
            a.pacchetto(ultimo, p[:600], istante)
        a.chiudi(ultimo + 600)
        self.assertEqual(fughe(c.scritto, self.cattura), [])
        visti = {(r["protocollo"], r["esito"]) for r in c.accessi}
        self.assertEqual(visti, {("kerberos", "riuscito"), ("kerberos", "fallito"), ("smb", "riuscito"), ("smb", "fallito"), ("ldap", "fallito")})

    def test_spento_non_scrive_nessun_accesso(self):
        c = Collezionista()
        a = c.ascolto(scrivi_accessi=False)
        for istante, p in pacchetti():
            a.pacchetto(int(istante), p, istante)
        self.assertNotIn('"prova', "\n".join(c.scritto).replace('"prova@banco.test', ""))
        self.assertEqual(fughe(c.scritto, self.cattura), [])


class Programmi(unittest.TestCase):
    """Parte non rossa della tappa 7: la versione dichiarata nei saluti, nella forma di Zeek (`<tipo>:<nome> <versione>`)."""

    def test_dalla_cattura_del_banco(self):
        nomi = {}
        a = Ascolto(RETI, lambda *f: None, lambda visto, c: nomi.update(c))
        ultimo = 0
        for istante, p in pacchetti():
            ultimo = int(istante)
            a.pacchetto(ultimo, p, istante)
        a.chiudi(ultimo + 600)
        sw = {(c, n) for (c, t, n) in nomi if t == "software"}
        self.assertIn(("192.168.99.88", "HTTP::BROWSER:ProvaAgente 1.0"), sw)
        self.assertTrue(any(c == "192.168.99.91" and n.startswith("SSH::SERVER:OpenSSH ") for c, n in sw), sw)
        self.assertTrue(any(c == "192.168.99.88" and n.startswith("SSH::CLIENT:OpenSSH ") for c, n in sw), sw)

    def test_saluti(self):
        from collector.controlli import programma
        self.assertEqual(programma(6, 5000, 80, b"GET / HTTP/1.1\r\nUser-Agent: Mozilla/5.0 (X11) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36\r\n\r\n"), "HTTP::BROWSER:Chrome 131.0.0.0")
        self.assertEqual(programma(6, 80, 5000, b"HTTP/1.1 200 OK\r\nServer: nginx/1.22.1\r\n\r\n"), "HTTP::SERVER:nginx 1.22.1")
        self.assertEqual(programma(6, 21, 5000, b"220 (vsFTPd 3.0.3)\r\n"), "FTP::SERVER:vsFTPd 3.0.3")
        self.assertIsNone(programma(6, 25, 5000, b"220 posta.cliente.it ESMTP Postfix\r\n"))  # il nome della macchina non è un programma


class Archivio(unittest.TestCase):
    def test_scritti_letti_e_tenuti_due_giorni(self):
        import sqlite3
        import tempfile
        from collector import archivio
        with tempfile.TemporaryDirectory() as cartella:
            db = archivio.apri(os.path.join(cartella, "a.db"))
            riga = {"client": "10.0.0.5", "server": "10.0.0.1", "protocollo": "smb", "utente": "prova", "dominio": "BANCO", "esito": "riuscito", "volte": 2}
            archivio.scrivi_accessi(db, "2020-01-01 00:00:00", [riga])
            archivio.scrivi_accessi(db, archivio.ora_utc(__import__("time").time()), [riga])
            righe, ultimo, _, _ = archivio.leggi_accessi(db, 0, 10)
            self.assertEqual((len(righe), righe[0]["utente"], ultimo), (2, "prova", 2))
            archivio.sfoltisci(db, giorni=7)
            self.assertEqual(db.execute("SELECT COUNT(*) FROM accesso").fetchone()[0], 1)
            db.close()
            del sqlite3


if __name__ == "__main__":
    unittest.main()
