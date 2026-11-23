"""Adattatore dei registri di Zeek (profilo avanzato), con i registri veri del banco del PX-NAS (23/11/2026)."""
import os
import shutil
import tempfile
import time
import unittest

from collector import archivio, zeek_adattatore as za

DATI = os.path.join(os.path.dirname(__file__), "dati", "zeek", "filtrati")
RETI = ["192.168.99.0/24"]
CARICO, SIM, FINTI = "192.168.99.88", "192.168.99.222", "192.168.99.223"


def registro(nome):
    with open(os.path.join(DATI, f"{nome}.log"), encoding="utf-8") as f:
        return za.leggi_registro(f.read())


class Lettura(unittest.TestCase):
    def test_righe_vuote_e_ultima_a_meta(self):
        testo = '{"a": 1}\n\n{non json}\n{"b": 2}\n{"c": 3'
        self.assertEqual(za.leggi_registro(testo), [{"a": 1}, {"b": 2}])


class Conn(unittest.TestCase):
    def setUp(self):
        self.t = za.traduci_conn(registro("conn"), RETI)

    def coppia(self, server, porta):
        return [c for c in self.t["coppie"] if c["client"] == CARICO and c["server"] == server and c["porta"] == porta]

    def test_verso_dal_chi_apre(self):
        http = self.coppia(SIM, 80)
        self.assertEqual(len(http), 1)
        self.assertGreater(http[0]["byte_ritorno"], 0)
        self.assertEqual(http[0]["risposta"], 1)
        self.assertGreaterEqual(http[0]["flussi"], 60)  # una richiesta di prova e le 60 dell'iniezione SQL
        # nessuna coppia TCP/UDP rovesciata: banco-carico ha solo aperto (verso di lui solo ICMP: porta irraggiungibile, redirect)
        self.assertEqual([c for c in self.t["coppie"] if c["server"] == CARICO and c["proto"] != 1], [])
        self.assertTrue(any(c["server"] == CARICO and c["proto"] == 1 for c in self.t["coppie"]))

    def test_rifiutata_e_senza_risposta(self):
        storte = {(c["server"], c["porta"]): c for c in self.t["connessioni"] if c["client"]}
        self.assertEqual(storte[(SIM, 81)]["rifiutate"], 1)
        self.assertEqual(storte[("esterno", 9)]["senza_risposta"], 1)
        self.assertTrue(all(c["ms_minimo"] == -1 and c["ms_mediano"] == -1 for c in self.t["connessioni"]))
        riuscite = {(c["server"], c["porta"]): c["riuscite"] for c in self.t["connessioni"] if not c["client"]}
        self.assertGreaterEqual(riuscite[(FINTI, 21)], 1)

    def test_esterni(self):
        self.assertIn(("192.0.2.1", "fuori", 9), {(e["ip"], e["verso"], e["porta"]) for e in self.t["esterni"]})


class Nomi(unittest.TestCase):
    def test_dns(self):
        conteggi, nomi_ip = za.traduci_dns(registro("dns"), "2026-11-23 13:00:00", RETI)
        self.assertIn((CARICO, "dns", "prova-zeek.banco.test"), conteggi)
        self.assertIn("www.debian.org", {v["nome"] for v in nomi_ip})
        self.assertTrue(all(v["tipo"] == "dns" for v in nomi_ip))

    def test_sni_finto(self):
        righe = [{"id.orig_h": CARICO, "id.resp_h": "151.101.2.132", "server_name": "WWW.Esempio.IT"}]
        conteggi, nomi_ip = za.traduci_ssl(righe, "2026-11-23 13:00:00", RETI)
        self.assertEqual(conteggi, {(CARICO, "sni", "www.esempio.it"): 1})
        self.assertEqual(nomi_ip[0]["ip"], "151.101.2.132")


class Fatti(unittest.TestCase):
    def setUp(self):
        self.registri = {n: registro(n) for n in ("ftp", "http", "snmp", "ssl", "modbus", "ldap", "conn", "dns")}

    def test_ogni_controllo_una_volta(self):
        fatti = za.traduci_fatti(self.registri, RETI)
        per_tipo = {}
        for f in fatti:
            per_tipo.setdefault(f["tipo"], []).append(f)
        for tipo in ("chiaro_ftp", "chiaro_http_basic", "impianto_scrittura", "tls_vecchio"):
            self.assertEqual(len(per_tipo.get(tipo, [])), 1, tipo)
        # due comunità verso lo stesso server: un fatto l'ora per coppia di host, la prima vista (quella di prova)
        self.assertEqual(len(per_tipo["snmp_vecchio"]), 1)
        self.assertEqual(per_tipo["impianto_scrittura"][0]["dettaglio"], {"protocollo": "modbus", "cosa": "registro"})
        self.assertEqual(per_tipo["tls_vecchio"][0]["dettaglio"], {"versione": "TLS 1.0"})
        self.assertEqual(per_tipo["chiaro_http_basic"][0]["server"], SIM)
        self.assertTrue(all(f["client"] == CARICO for f in fatti))
        self.assertTrue(all(za.profili.fonte(f["tipo"], "avanzato") == "zeek" for f in fatti))

    def test_comunita_nota(self):
        snmp = [dict(r) for r in self.registri["snmp"]]
        self.assertEqual(sorted(r["comunita_nota"] for r in snmp), [False, True])
        # da due server diversi i due fatti escono tutti e due, e quello con «public» lo dice
        snmp[1]["id.resp_h"] = "192.168.99.224"
        fatti = za.traduci_fatti({"snmp": snmp}, RETI)
        self.assertEqual(sorted(f["dettaglio"]["comunita_nota"] for f in fatti), [False, True])
        self.assertTrue(all(f["dettaglio"]["versione"] == "2c" for f in fatti))

    def test_una_volta_l_ora_anche_fra_un_giro_e_l_altro(self):
        detti = {}
        self.assertEqual(len(za.traduci_fatti({"ftp": self.registri["ftp"]}, RETI, detti)), 1)
        self.assertEqual(za.traduci_fatti({"ftp": self.registri["ftp"]}, RETI, detti), [])
        dopo = [{**self.registri["ftp"][0], "ts": self.registri["ftp"][0]["ts"] + 3601}]
        self.assertEqual(len(za.traduci_fatti({"ftp": dopo}, RETI, detti)), 1)

    def test_ldap_solo_col_fatto_calcolato_da_zeek(self):
        bind = {**self.registri["ldap"][0]}
        self.assertEqual(za.traduci_fatti({"ldap": [bind]}, RETI), [])  # cattura fatta prima del campo: niente
        self.assertEqual([f["tipo"] for f in za.traduci_fatti({"ldap": [{**bind, "accesso_chiaro": True}]}, RETI)], ["chiaro_ldap"])


class Giro(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cartella = os.path.join(self.tmp, "zeek")
        os.makedirs(self.cartella)
        self.db = archivio.apri(os.path.join(self.tmp, "c.db"))
        for r in ("conn", "dns", "ssl"):
            shutil.copy(os.path.join(DATI, f"{r}.log"), os.path.join(self.cartella, f"{r}.2026-11-23-13-10-00.log"))
        # in scrittura, col nome che Zeek usa finché il file è aperto: non si tocca
        with open(os.path.join(self.cartella, "conn.log"), "w") as f:
            f.write('{"ts": 1}\n')

    def tearDown(self):
        self.db.close()
        shutil.rmtree(self.tmp)

    def test_traduce_e_cancella(self):
        n = za.giro_zeek(self.db, self.cartella, RETI, 50)
        self.assertGreater(n, 0)
        self.assertEqual(sorted(os.listdir(self.cartella)), ["conn.log"])
        inizi = {r[0] for r in self.db.execute("SELECT DISTINCT inizio FROM coppia")}
        self.assertEqual(inizi, {"2026-11-23 13:10:00"})
        self.assertIsNotNone(self.db.execute("SELECT byte_ritorno FROM coppia WHERE porta = 80").fetchone()[0])
        self.assertEqual(archivio.leggi_stato(self.db, "zeek_ultimo_conn"), "conn.2026-11-23-13-10-00.log")

    def test_file_a_meta_si_lascia_al_giro_dopo(self):
        with open(os.path.join(self.cartella, "dns.2026-11-23-13-10-00.log"), "a") as f:
            f.write('{"query": "a meta')
        self.assertEqual(za.giro_zeek(self.db, self.cartella, RETI, 50), 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM coppia").fetchone()[0], 0)
        self.assertEqual(len(os.listdir(self.cartella)), 4)
        # tronco da troppo: scartato e contato, gli altri tradotti
        self.assertGreater(za.giro_zeek(self.db, self.cartella, RETI, 50, adesso=time.time() + za.PARZIALE_SCARTA_S + 60), 0)
        self.assertEqual(os.listdir(os.path.join(self.cartella, "scartati")), ["dns.2026-11-23-13-10-00.log"])
        self.assertEqual(archivio.leggi_stato(self.db, "zeek_scartati"), "1")

    def test_gia_tradotto_non_si_ritraduce(self):
        # arresto dopo la scrittura e prima della cancellazione: lo stato dice che quella finestra c'è già
        for r in ("conn", "dns", "ssl"):
            archivio.metti_stato(self.db, f"zeek_ultimo_{r}", f"{r}.2026-11-23-13-10-00.log")
        self.assertEqual(za.giro_zeek(self.db, self.cartella, RETI, 50), 0)
        self.assertEqual(sorted(os.listdir(self.cartella)), ["conn.log"])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM coppia").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
