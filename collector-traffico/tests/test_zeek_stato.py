"""Sonda avanzata: copertura dai contatori di Zeek e freno sul disco."""
import os
import unittest

from collector import zeek_stato

DATI = os.path.join(os.path.dirname(__file__), "dati", "zeek", "filtrati")


class Stato(unittest.TestCase):
    def test_copertura_dai_contatori(self):
        righe = [{"pkts_link": 1000, "pkts_dropped": 0}, {"pkts_link": 500, "pkts_dropped": 5}, {"pkts_proc": 9}]
        self.assertEqual(zeek_stato.copertura_da_stats(righe), (1500, 5))
        self.assertEqual(zeek_stato.copertura_da_stats([{"pkts_link": "x"}]), (0, 0))

    def test_stats_letto_da_file_non_conta(self):
        # la cattura del banco è letta da file: Zeek non ha i contatori della scheda
        from collector import zeek_adattatore
        with open(os.path.join(DATI, "stats.log"), encoding="utf-8") as f:
            self.assertEqual(zeek_stato.copertura_da_stats(zeek_adattatore.leggi_registro(f.read())), (0, 0))

    def test_freno_con_isteresi(self):
        self.assertEqual(zeek_stato.freno(71, False), "ferma")
        self.assertEqual(zeek_stato.freno(71, True), "niente")
        self.assertEqual(zeek_stato.freno(60, True), "niente")   # fra le soglie non si cambia
        self.assertEqual(zeek_stato.freno(49, True), "riparti")
        self.assertEqual(zeek_stato.freno(49, False), "niente")
        self.assertEqual(zeek_stato.freno(70, False), "niente")


if __name__ == "__main__":
    unittest.main()
