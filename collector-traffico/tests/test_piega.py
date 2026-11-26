import unittest

from collector.piega import RETI_INTERNE_DI_SERIE as RETI, da_pmacct, dimezza, piega


def riga(src, dst, proto, sport, dport, byte=100, pacchetti=1):
    return {"src": src, "dst": dst, "proto": proto, "sport": sport, "dport": dport, "byte": byte, "pacchetti": pacchetti}


class Piega(unittest.TestCase):
    def test_due_direzioni_nella_stessa_coppia(self):
        c = piega([
            riga("192.168.99.10", "192.168.99.221", 6, 51000, 502, 300, 3),
            riga("192.168.99.221", "192.168.99.10", 6, 502, 51000, 700, 4),
        ], RETI)
        self.assertEqual(c, [{"client": "192.168.99.10", "server": "192.168.99.221", "proto": 6, "porta": 502,
                              "byte": 1000, "pacchetti": 7, "flussi": 1, "esterni": 0}])

    def test_due_connessioni_due_flussi(self):
        c = piega([
            riga("192.168.99.10", "192.168.99.222", 6, 51000, 80),
            riga("192.168.99.10", "192.168.99.222", 6, 51001, 80),
            riga("192.168.99.222", "192.168.99.10", 6, 80, 51001),
        ], RETI)
        self.assertEqual(len(c), 1)
        self.assertEqual(c[0]["flussi"], 2)

    def test_porta_alta_diventa_zero_e_server_e_la_destinazione(self):
        c = piega([riga("10.0.0.1", "10.0.0.2", 17, 40000, 50000)], RETI)
        self.assertEqual((c[0]["client"], c[0]["server"], c[0]["porta"]), ("10.0.0.1", "10.0.0.2", 0))

    def test_esterni_contati_e_non_elencati(self):
        c = piega([
            riga("192.168.1.5", "8.8.8.8", 17, 40000, 53),
            riga("192.168.1.5", "1.1.1.1", 17, 40001, 53),
            riga("1.1.1.1", "192.168.1.5", 17, 53, 40001),
        ], RETI)
        self.assertEqual(len(c), 1)
        self.assertEqual((c[0]["client"], c[0]["server"], c[0]["porta"], c[0]["esterni"]), ("192.168.1.5", "esterno", 53, 2))

    def test_esterno_che_entra(self):
        c = piega([riga("203.0.113.9", "192.168.1.5", 6, 44000, 443)], RETI)
        self.assertEqual((c[0]["client"], c[0]["server"], c[0]["esterni"]), ("esterno", "192.168.1.5", 1))

    def test_icmp_senza_porta(self):
        c = piega([riga("10.0.0.1", "10.0.0.2", 1, 0, 0)], RETI)
        self.assertEqual((c[0]["proto"], c[0]["porta"], c[0]["server"]), (1, 0, "10.0.0.2"))

    def test_multicast_non_e_esterno(self):
        c = piega([riga("192.168.1.5", "224.0.0.251", 17, 5353, 5353)], RETI)
        self.assertEqual((c[0]["server"], c[0]["esterni"]), ("diffusione", 0))

    def test_rete_aggiunta_dall_env(self):
        c = piega([riga("100.64.0.1", "100.64.0.2", 6, 50000, 22)], RETI + ["100.64.0.0/10"])
        self.assertEqual(c[0]["server"], "100.64.0.2")

    def test_da_pmacct(self):
        testo = ('{"event_type": "purge", "ip_src": "192.168.99.10", "ip_dst": "192.168.99.221", "ip_proto": "tcp",'
                 ' "port_src": 51000, "port_dst": 502, "packets": 3, "bytes": 300}\n'
                 'riga rotta\n{"troncata": \n')
        self.assertEqual(da_pmacct(testo), [riga("192.168.99.10", "192.168.99.221", 6, 51000, 502, 300, 3)])

    def test_dimezza(self):
        self.assertEqual(dimezza([{"byte": 1000, "pacchetti": 7, "flussi": 1}])[0], {"byte": 500, "pacchetti": 4, "flussi": 1})


if __name__ == "__main__":
    unittest.main()
