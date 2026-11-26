import os
import tempfile
import unittest

from collector import archivio
from collector.__main__ import contatori_scheda, giro, inizio_da_nome


def coppia(n):
    return {"client": f"10.0.0.{n}", "server": "10.0.0.200", "proto": 6, "porta": 80,
            "byte": 10 * n, "pacchetti": n, "flussi": 1, "esterni": 0}


class Archivio(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = archivio.apri(os.path.join(self.dir.name, "c.db"))

    def tearDown(self):
        self.db.close()
        self.dir.cleanup()

    def test_cursore_a_pagine(self):
        archivio.scrivi_finestra(self.db, archivio.ora_utc(), [coppia(n) for n in range(1, 6)])
        righe, ultimo, altri, buco = archivio.leggi_coppie(self.db, 0, 2)
        self.assertEqual(([r["seq"] for r in righe], ultimo, altri, buco), ([1, 2], 2, True, False))
        righe, ultimo, altri, buco = archivio.leggi_coppie(self.db, 2, 1000)
        self.assertEqual(([r["seq"] for r in righe], ultimo, altri, buco), ([3, 4, 5], 5, False, False))
        righe, ultimo, altri, _ = archivio.leggi_coppie(self.db, 5, 1000)
        self.assertEqual((righe, ultimo, altri), ([], 5, False))
        self.assertEqual(righe := archivio.leggi_coppie(self.db, 0, 1)[0][0]["inizio"][10], " ")  # mai la «T»

    def test_buco_dopo_lo_sfoltimento(self):
        archivio.scrivi_finestra(self.db, "2020-01-01 00:00:00", [coppia(n) for n in range(1, 4)])
        archivio.scrivi_finestra(self.db, archivio.ora_utc(), [coppia(n) for n in range(4, 6)])
        self.assertEqual(archivio.sfoltisci(self.db, 7), 3)
        self.assertTrue(archivio.leggi_coppie(self.db, 1, 1000)[3])   # era fermo alla 1: 2 e 3 perse
        self.assertFalse(archivio.leggi_coppie(self.db, 3, 1000)[3])  # aveva già letto fino alla 3
        self.assertFalse(archivio.leggi_coppie(self.db, 0, 1000)[3])  # prima lettura: nessun buco
        self.assertEqual(archivio.ultimo_seq(self.db), 5)

    def test_stato(self):
        archivio.metti_stato(self.db, "pacchetti_visti", 10)
        archivio.metti_stato(self.db, "pacchetti_visti", 12)
        self.assertEqual(archivio.leggi_stato(self.db, "pacchetti_visti"), "12")
        self.assertEqual(archivio.leggi_stato(self.db, "manca", "0"), "0")

    def test_giro_legge_scrive_e_cancella(self):
        cartella = os.path.join(self.dir.name, "in")
        os.makedirs(cartella)
        f = os.path.join(cartella, "20261120-101000.json")
        with open(f, "w") as o:
            o.write('{"ip_src": "192.168.99.10", "ip_dst": "192.168.99.221", "ip_proto": "tcp", "port_src": 51000,'
                    ' "port_dst": 502, "packets": 4, "bytes": 400}\n')
        self.assertEqual(giro(self.db, cartella, ["192.168.0.0/16"], False), 0)  # troppo giovane: forse in scrittura
        self.assertEqual(giro(self.db, cartella, ["192.168.0.0/16"], True, adesso=os.path.getmtime(f) + 60), 1)
        self.assertEqual(os.listdir(cartella), [])
        r = archivio.leggi_coppie(self.db, 0, 10)[0][0]
        self.assertEqual((r["inizio"], r["server"], r["porta"], r["byte"]), ("2026-11-20 10:05:00", "192.168.99.221", 502, 200))

    def test_netflow_stessa_piega_fonte_dal_nome_e_niente_dimezzamento(self):
        """Un file di nfacctd ha la stessa forma di quello di pmacctd (qui com'è scritto dalla 1.7.7)."""
        cartella = os.path.join(self.dir.name, "in")
        os.makedirs(cartella)
        riga = ('{"event_type": "purge", "ip_src": "192.168.4.20", "ip_dst": "192.168.4.8", "port_src": 52100,'
                ' "port_dst": 443, "ip_proto": "tcp", "packets": 40, "bytes": 8000}\n')
        for nome in ("netflow-20261120-101000.json", "sflow-20261120-101000.json", "mirror-20261120-101000.json", "20261120-101500.json"):
            with open(os.path.join(cartella, nome), "w") as o:
                o.write(riga)
        self.assertEqual(giro(self.db, cartella, ["192.168.0.0/16"], True, adesso=4102444800), 4)
        righe = archivio.leggi_coppie(self.db, 0, 10)[0]
        self.assertEqual(sorted((r["fonte"], r["byte"]) for r in righe),
                         [("mirror", 4000), ("mirror", 4000), ("netflow", 8000), ("sflow", 8000)])
        self.assertEqual({r["inizio"] for r in righe}, {"2026-11-20 10:05:00", "2026-11-20 10:10:00"})

    def test_archivio_vecchio_prende_la_colonna_fonte(self):
        import sqlite3
        percorso = os.path.join(self.dir.name, "vecchio.db")
        v = sqlite3.connect(percorso)
        v.execute("CREATE TABLE coppia (seq INTEGER PRIMARY KEY AUTOINCREMENT, inizio TEXT NOT NULL, durata_s INTEGER NOT NULL,"
                  " client TEXT NOT NULL, server TEXT NOT NULL, proto INTEGER NOT NULL, porta INTEGER NOT NULL,"
                  " byte INTEGER NOT NULL, pacchetti INTEGER NOT NULL, flussi INTEGER NOT NULL, esterni INTEGER NOT NULL DEFAULT 0)")
        v.execute("INSERT INTO coppia (inizio, durata_s, client, server, proto, porta, byte, pacchetti, flussi) VALUES ('2026-11-20 10:00:00', 300, 'a', 'b', 6, 80, 1, 1, 1)")
        v.commit()
        v.close()
        d = archivio.apri(percorso)
        self.assertEqual(archivio.leggi_coppie(d, 0, 10)[0][0]["fonte"], "mirror")
        d.close()

    def test_inizio_senza_ora_nel_nome(self):
        self.assertEqual(inizio_da_nome("coppie.json", 600.0), "1970-01-01 00:05:00")

    def test_contatori_scheda(self):
        testo = ("Inter-|   Receive                                                |  Transmit\n"
                 " face |bytes    packets errs drop fifo frame compressed multicast|bytes ...\n"
                 "  ens19: 123456    1000    0   25    5     0          0         0        0 0 0 0 0 0 0 0\n")
        self.assertEqual(contatori_scheda("ens19", testo), (1000, 30))
        self.assertIsNone(contatori_scheda("ens20", testo))


if __name__ == "__main__":
    unittest.main()
