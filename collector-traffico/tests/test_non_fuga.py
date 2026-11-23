"""Nessun segreto arriva su disco: né nei registri di Zeek filtrati da `sonda.zeek`, né nell'archivio.

I registri vengono da una cattura vera sul banco del PX-NAS (`banco/cattura-zeek.sh`, 23/11/2026) con valori di prova
inventati: utente e password in HTTP Basic, FTP e LDAP, comunità SNMP. `grezzi/` è la stessa copia letta da Zeek SENZA
i filtri (anche quelli di Zeek spenti): serve a dimostrare che la prova i segreti li saprebbe trovare.
Regola dura della spec «sonda avanzata» (Riccardo, 23/11): mai password, comunità SNMP, hash, biglietti, utenti su disco.

Vista rossa: `NON_FUGA_CARTELLA=grezzi python3 -m unittest tests.test_non_fuga` fa fallire `test_i_filtrati_no`.
"""
import base64
import os
import sqlite3
import tempfile
import unittest

DATI = os.path.join(os.path.dirname(__file__), "dati", "zeek")
SEGRETI = ("Prova-Segreto-7731", "comunita-di-prova-7731", "prova-utente")
# anche in base64, come viaggia nell'intestazione Basic
IN_BASE64 = (base64.b64encode(b"prova-utente:Prova-Segreto-7731").decode(),)


def _testi(cartella: str) -> dict[str, str]:
    fuori = {}
    for nome in sorted(os.listdir(cartella)):
        if nome.endswith(".log"):
            with open(os.path.join(cartella, nome), encoding="utf-8", errors="replace") as f:
                fuori[nome] = f.read()
    return fuori


def _trovati(testi: dict[str, str]) -> list[tuple[str, str]]:
    return [(nome, s) for nome, t in testi.items() for s in SEGRETI + IN_BASE64 if s in t]


class NonFuga(unittest.TestCase):
    def test_i_grezzi_li_contengono(self):
        testi = _testi(os.path.join(DATI, "grezzi"))
        for s in SEGRETI:
            self.assertTrue(any(s in t for t in testi.values()), f"nei grezzi manca {s}: la prova non saprebbe trovarlo")

    def test_i_filtrati_no(self):
        cartella = os.path.join(DATI, os.environ.get("NON_FUGA_CARTELLA", "filtrati"))
        testi = _testi(cartella)
        self.assertTrue(testi, "nessun registro filtrato: la prova non proverebbe niente")
        self.assertEqual(_trovati(testi), [])

    def test_l_archivio_no(self):
        from collector import archivio, zeek_adattatore
        with tempfile.TemporaryDirectory() as tmp:
            db = archivio.apri(os.path.join(tmp, "c.db"))
            registri = {nome[:-4]: zeek_adattatore.leggi_registro(t) for nome, t in _testi(os.path.join(DATI, "filtrati")).items()}
            zeek_adattatore.scrivi_registri(db, registri, "2026-11-23 13:00:00", ["192.168.99.0/24"], 50)
            db.close()
            db = sqlite3.connect(os.path.join(tmp, "c.db"))
            righe = 0
            for (tabella,) in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'"):
                for riga in db.execute(f"SELECT * FROM {tabella}"):
                    righe += 1
                    testo = " ".join(str(v) for v in riga)
                    for s in SEGRETI + IN_BASE64:
                        self.assertNotIn(s, testo, f"{s} nella tabella {tabella}")
            self.assertGreater(righe, 0, "archivio vuoto: la prova non proverebbe niente")
            # i fatti ci sono: la prova guarda anche il dettaglio dei controlli, non solo le coppie
            self.assertGreaterEqual(db.execute("SELECT COUNT(*) FROM fatto").fetchone()[0], 4)


if __name__ == "__main__":
    unittest.main()
