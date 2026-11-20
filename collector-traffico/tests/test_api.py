import json
import os
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

from collector import api, archivio


class Api(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        percorso = os.path.join(self.dir.name, "c.db")
        db = archivio.apri(percorso)
        archivio.scrivi_finestra(db, archivio.ora_utc(), [
            {"client": "192.168.99.10", "server": "192.168.99.221", "proto": 6, "porta": 502,
             "byte": 1000, "pacchetti": 7, "flussi": 1, "esterni": 0}] * 3)
        archivio.metti_stato(db, "pacchetti_visti", 950)
        archivio.metti_stato(db, "pacchetti_persi", 50)
        db.close()
        self.srv = api.crea_server(percorso, "gettone-di-prova", "banco", "2026-11-20 10:00:00", "127.0.0.1", 0)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.dir.cleanup()

    def chiedi(self, percorso, gettone="gettone-di-prova"):
        r = urllib.request.Request(self.base + percorso)
        if gettone is not None:
            r.add_header("Authorization", f"Bearer {gettone}")
        try:
            with urllib.request.urlopen(r, timeout=5) as risposta:
                return risposta.status, json.loads(risposta.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_401_senza_gettone_o_sbagliato(self):
        self.assertEqual(self.chiedi("/v1/stato", None)[0], 401)
        self.assertEqual(self.chiedi("/v1/coppie?dopo=0", "altro")[0], 401)

    def test_stato(self):
        codice, s = self.chiedi("/v1/stato")
        self.assertEqual(codice, 200)
        self.assertEqual((s["nome"], s["ultimo_seq"], s["pacchetti_visti"], s["pacchetti_persi"], s["copertura"]),
                         ("banco", 3, 950, 50, 0.95))

    def test_coppie_col_cursore(self):
        codice, c = self.chiedi("/v1/coppie?dopo=0&limite=2")
        self.assertEqual((codice, len(c["righe"]), c["ultimo_seq"], c["altri"], c["buco"]), (200, 2, 2, True, False))
        self.assertEqual(c["righe"][0]["porta"], 502)
        _, c = self.chiedi("/v1/coppie?dopo=2")
        self.assertEqual((len(c["righe"]), c["ultimo_seq"], c["altri"]), (1, 3, False))

    def test_parametri_sbagliati_e_rotta_sconosciuta(self):
        self.assertEqual(self.chiedi("/v1/coppie?dopo=abc")[0], 400)
        self.assertEqual(self.chiedi("/v1/coppie?limite=5000")[0], 400)
        self.assertEqual(self.chiedi("/v1/altro")[0], 404)

    def test_non_parte_senza_gettone(self):
        with self.assertRaises(ValueError):
            api.crea_server("x.db", "", "banco", "", "127.0.0.1", 0)


if __name__ == "__main__":
    unittest.main()
