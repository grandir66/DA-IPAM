"""Adattatore dei registri di Zeek (profilo avanzato), con i registri veri del banco del PX-NAS (23/11/2026)."""
import json
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


class Vive(unittest.TestCase):
    """24/11/2026: le connessioni che non si chiudono. sonda.zeek scrive in `conn` una riga a finestra con la differenza."""

    def test_byte_sommati_e_riuscita_contata_una_volta(self):
        r = {"id.orig_h": CARICO, "id.orig_p": 40000, "id.resp_h": SIM, "id.resp_p": 443, "proto": "tcp", "conn_state": "S1",
             "orig_ip_bytes": 100, "resp_ip_bytes": 300, "orig_pkts": 2, "resp_pkts": 3, "gia_vista": False}
        fine = {**r, "conn_state": "SF", "orig_ip_bytes": 10, "resp_ip_bytes": 20, "orig_pkts": 1, "resp_pkts": 1, "gia_vista": True}
        muta = {**fine, "id.resp_p": 8443, "orig_ip_bytes": 0, "resp_ip_bytes": 0, "orig_pkts": 0, "resp_pkts": 0}
        t = za.traduci_conn([r, {**r, "gia_vista": True}, fine, muta], RETI)
        self.assertEqual([(c["porta"], c["byte"], c["byte_ritorno"], c["risposta"]) for c in t["coppie"]], [(443, 830, 620, 1)])
        self.assertEqual([(c["porta"], c["riuscite"]) for c in t["connessioni"]], [(443, 1)])


class Scansione(unittest.TestCase):
    """24/11/2026, DA-PX-03: tutte le porte da un solo host, 1,35 milioni di righe in una finestra."""

    @staticmethod
    def righe(da, quante, stato="REJ"):
        return [{"id.orig_h": da, "id.orig_p": 40000, "id.resp_h": SIM, "id.resp_p": p, "proto": "tcp", "conn_state": stato,
                 "orig_ip_bytes": 60, "resp_ip_bytes": 40, "orig_pkts": 1, "resp_pkts": 1} for p in range(1, quante + 1)]

    def test_il_tetto_piega_e_lo_dice(self):
        t = za.traduci_conn(self.righe(CARICO, 20000) + self.righe(FINTI, 5), RETI)
        mie = [c for c in t["coppie"] if c["client"] == CARICO]
        self.assertLessEqual(len(mie), za.COPPIE_PER_CLIENT + 1)
        self.assertEqual(sum(c["flussi"] for c in mie), 20000)  # i totali non si perdono, solo le porte
        self.assertEqual(sum(c["byte"] for c in mie), 2000000)
        self.assertEqual(t["tagliate"], 20000 - za.COPPIE_PER_CLIENT)
        self.assertEqual(len([c for c in t["coppie"] if c["client"] == FINTI]), 5)  # gli altri host restano interi

    def test_sonda_nota(self):
        t = za.traduci_conn(self.righe(CARICO, 5000) + [{**self.righe(FINTI, 1)[0], "id.resp_h": CARICO, "id.resp_p": 443}], RETI,
                            sonde=frozenset({CARICO}))
        self.assertEqual([(c["client"], c["server"], c["porta"]) for c in t["coppie"]], [(FINTI, CARICO, 443)])
        self.assertEqual(t["tagliate"], 0)


class DueFileNellaStessaFinestra(unittest.TestCase):
    """24/11/2026: Zeek riavviato più volte nella finestra; i secondi file si cancellavano senza tradurli."""

    def test_non_si_perde_il_secondo(self):
        with tempfile.TemporaryDirectory() as d:
            for ora, porta in (("09-05-00", 11), ("09-05-24", 12), ("09-10-00", 13)):
                with open(os.path.join(d, f"conn.2026-11-24-{ora}.log"), "w") as f:
                    f.write(json.dumps({**Scansione.righe(CARICO, 1)[0], "id.resp_p": porta}) + "\n")
            db = archivio.apri(os.path.join(d, "x.db"))
            for _ in range(3):
                za.giro_zeek(db, d, RETI, 50, detti={})
            self.assertEqual([r[0] for r in db.execute("SELECT porta FROM coppia ORDER BY porta")], [11, 12, 13])
            db.close()


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
        for tipo in ("chiaro_ftp", "chiaro_http_basic", "chiaro_ldap", "impianto_scrittura", "tls_vecchio"):
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
        # dal banco: il bind semplice con password ha il campo calcolato da sonda.zeek, l'unbind no
        self.assertEqual([r.get("accesso_chiaro") for r in self.registri["ldap"]], [True, None])
        self.assertEqual([f["tipo"] for f in za.traduci_fatti({"ldap": self.registri["ldap"]}, RETI)], ["chiaro_ldap"])
        # senza il campo (un bind anonimo, o un Zeek senza sonda.zeek) niente fatto
        senza = [{k: v for k, v in r.items() if k != "accesso_chiaro"} for r in self.registri["ldap"]]
        self.assertEqual(za.traduci_fatti({"ldap": senza}, RETI), [])


class Avvisi(unittest.TestCase):
    """Task 6: certificati, avvisi di Zeek scelti, programmi visti in rete."""

    def setUp(self):
        self.registri = {n: registro(n) for n in ("ssl", "x509", "notice")}

    def test_dal_banco_certificato_autofirmato_e_iniezione_sql(self):
        fatti = {f["tipo"]: f for f in za.traduci_fatti(self.registri, RETI)}
        self.assertEqual(fatti["tls_certificato"]["dettaglio"], {"motivo": "autofirmato"})
        self.assertEqual((fatti["tls_certificato"]["client"], fatti["tls_certificato"]["server"], fatti["tls_certificato"]["porta"]), ("", FINTI, 4443))
        self.assertEqual((fatti["sql_injection"]["client"], fatti["sql_injection"]["server"]), (CARICO, SIM))
        self.assertNotIn("password_ssh_provate", fatti)  # sul banco la soglia di Zeek (30 falliti) non è stata passata

    def test_scaduto_con_la_data_vince_sull_avviso(self):
        x509 = [{**self.registri["x509"][0], "certificate.not_valid_after": 1700000000.0}]
        fatti = [f for f in za.traduci_fatti({**self.registri, "x509": x509}, RETI) if f["tipo"] == "tls_certificato"]
        self.assertEqual(len(fatti), 1)
        self.assertEqual(fatti[0]["dettaglio"], {"motivo": "scaduto", "scaduto_il": "2023-11-14"})

    def test_certificato_di_un_servizio_fuori_non_si_guarda(self):
        ssl = [{**self.registri["ssl"][0], "id.resp_h": "151.101.2.132"}]
        notice = [{**n, "dst": "151.101.2.132", "id.resp_h": "151.101.2.132"} for n in self.registri["notice"]]
        self.assertEqual([f for f in za.traduci_fatti({"ssl": ssl, "notice": notice}, RETI) if f["tipo"] == "tls_certificato"], [])

    def test_password_ssh_provate(self):
        avviso = {"ts": 1795438700.0, "note": "SSH::Password_Guessing", "src": CARICO,
                  "msg": f"{CARICO} appears to be guessing SSH passwords (seen in 30 connections).", "sub": "Sampled servers:  192.168.99.223"}
        fatti = za.traduci_fatti({"notice": [avviso]}, RETI)
        self.assertEqual([(f["tipo"], f["client"], f["server"], f["porta"], f["dettaglio"]) for f in fatti],
                         [("password_ssh_provate", CARICO, "", 22, {"connessioni": 30})])

    def test_avvisi_fuori_elenco_si_ignorano(self):
        self.assertEqual(za.traduci_fatti({"notice": [{"ts": 1.0, "note": "Scan::Port_Scan", "src": CARICO}]}, RETI), [])
        vittima = [n for n in self.registri["notice"] if n["note"] == "HTTP::SQL_Injection_Victim"]
        self.assertTrue(vittima)
        self.assertEqual(za.traduci_fatti({"notice": vittima}, RETI), [])

    def test_programmi_dal_banco(self):
        nomi = {k[2] for k in za.traduci_software(registro("software"), RETI)}
        self.assertIn("HTTP::BROWSER:curl 7.88.1", nomi)
        self.assertTrue(any(n.startswith("SSH::SERVER:OpenSSH") for n in nomi))

    def test_programmi(self):
        righe = [
            {"host": SIM, "host_p": 80, "software_type": "HTTP::SERVER", "name": "BaseHTTP", "version.major": 0, "version.minor": 6},
            {"host": CARICO, "software_type": "HTTP::BROWSER", "name": "curl", "version.major": 7, "version.minor": 88, "version.minor2": 1},
            {"host": "151.101.2.132", "software_type": "HTTP::SERVER", "name": "nginx", "version.major": 1},
            {"host": FINTI, "software_type": "SSH::SERVER", "name": "OpenSSH", "version.major": 9, "version.minor": 2, "version.addl": "p1"},
        ]
        self.assertEqual(za.traduci_software(righe, RETI), {
            (SIM, "software", "HTTP::SERVER:BaseHTTP 0.6"): 1,
            (CARICO, "software", "HTTP::BROWSER:curl 7.88.1"): 1,
            (FINTI, "software", "SSH::SERVER:OpenSSH 9.2p1"): 1,
        })


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


class Memoria(unittest.TestCase):
    """23/11/2026, DA-PX-03: un conn di 5 minuti da 39 MB letto tutto insieme faceva uccidere collector-traffico
    (limite di 128 MB) trenta volte di fila. Ora si legge a righe: la memoria non cresce col numero di connessioni."""

    def test_registro_grande_a_righe(self):
        import json
        import tracemalloc
        tmp = tempfile.mkdtemp()
        try:
            cartella = os.path.join(tmp, "zeek")
            os.makedirs(cartella)
            with open(os.path.join(cartella, "conn.2026-11-23-13-15-00.log"), "w") as f:
                for i in range(60000):
                    f.write(json.dumps({"ts": 1795440000.0 + i / 100, "uid": f"C{i:012d}", "id.orig_h": f"192.168.{i % 50}.{i % 200 + 1}",
                                        "id.orig_p": 40000 + i % 20000, "id.resp_h": f"10.0.{i % 7}.{i % 9 + 1}" if i % 3 else f"151.101.{i % 250}.{i % 200 + 1}",
                                        "id.resp_p": [443, 80, 53, 161][i % 4], "proto": "tcp" if i % 4 != 2 else "udp", "conn_state": "SF",
                                        "orig_pkts": 5, "orig_ip_bytes": 600, "resp_pkts": 4, "resp_ip_bytes": 2400, "service": "ssl"}) + "\n")
            db = archivio.apri(os.path.join(tmp, "c.db"))
            tracemalloc.start()
            n = za.giro_zeek(db, cartella, RETI, 50)
            picco = tracemalloc.get_traced_memory()[1]
            tracemalloc.stop()
            db.close()
            self.assertGreater(n, 0)
            self.assertEqual(os.listdir(cartella), [])
            # 60.000 righe tenute come elenco di dizionari passano i 60 MB; a righe resta qualche MB
            self.assertLess(picco, 25 * 1024 * 1024, f"picco {picco // 1024} KB")
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
