"""`ascolto.main()` avviato con l'ambiente vero del servizio (24/11/2026).

Incidente del 23/11 (v0.9.1313): la tappa 7 passava `scrivi_accessi` come settimo argomento posizionale, che
nel costruttore di `Ascolto` è `profilo`. TypeError all'avvio e `collector-ascolto` fermo su DA-COLLECTOR-PX03.
Le prove costruivano `Ascolto` a mano e non passavano mai da `main()`, quindi non lo vedevano.

Qui `main()` gira davvero con tutte le combinazioni di interruttori del servizio; solo `tcpdump` è sostituito da
una cattura vera del banco.
"""
import os
import signal
import sqlite3
import tempfile
import unittest
from unittest import mock

from collector import ascolto

CATTURA = os.path.join(os.path.dirname(__file__), "dati", "accessi-banco.pcap")


class _TcpdumpFinto:
    def __init__(self, *_a, **_k):
        self.stdout = open(CATTURA, "rb")

    def terminate(self):
        self.stdout.close()


class AscoltoMain(unittest.TestCase):
    def _avvia(self, **ambiente):
        with tempfile.TemporaryDirectory() as dati:
            env = {"DATI": dati, "MIRROR_IF": "finta0", **ambiente}
            vecchio = signal.getsignal(signal.SIGTERM)
            try:
                with mock.patch.dict(os.environ, env), mock.patch.object(ascolto.subprocess, "Popen", _TcpdumpFinto):
                    ascolto.main()
            finally:
                signal.signal(signal.SIGTERM, vecchio)
            con = sqlite3.connect(os.path.join(dati, "collector.db"))
            try:
                tabelle = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")]
                return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0] for t in tabelle}
            finally:
                con.close()

    def test_di_serie(self):
        righe = self._avvia()
        self.assertIn("accesso", " ".join(righe))  # lo schema c'è comunque
        self.assertEqual(sum(n for t, n in righe.items() if "access" in t), 0)

    def test_tutto_acceso(self):
        righe = self._avvia(ACCESSI="1", PROFILO="leggero")
        self.assertGreater(sum(n for t, n in righe.items() if "access" in t), 0)

    def test_tutto_spento(self):
        self._avvia(IDENTITA="0", ESTERNI="0", CONNESSIONI="0", ACCESSI="0", SECONDO_GRUPPO_MISURA="1")

    def test_senza_scheda_non_parte(self):
        with mock.patch.dict(os.environ, {"MIRROR_IF": ""}):
            self.assertEqual(ascolto.main(), 1)


if __name__ == "__main__":
    unittest.main()
