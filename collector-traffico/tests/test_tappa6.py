"""Tappa 6 (23/11/2026): certificato del server scaduto o autofirmato, DNS verso fuori, errori DNS."""
import struct
import unittest

from collector import controlli
from collector.ascolto import DNS_ERRORI_SOGLIA, Ascolto
from collector.piega import RETI_INTERNE_DI_SERIE as RETI


def der(tag: int, valore: bytes) -> bytes:
    n = len(valore)
    if n < 0x80:
        return bytes([tag, n]) + valore
    lung = n.to_bytes((n.bit_length() + 7) // 8, "big")
    return bytes([tag, 0x80 | len(lung)]) + lung + valore


def nome(cn: str) -> bytes:
    return der(0x30, der(0x31, der(0x30, der(0x06, b"\x55\x04\x03") + der(0x0C, cn.encode()))))


def cert(emittente: str, soggetto: str, scade: str) -> bytes:
    tbs = der(0x30, der(0xA0, der(0x02, b"\x02")) + der(0x02, b"\x01\x02") + der(0x30, der(0x06, b"\x2a\x86\x48")) + nome(emittente)
              + der(0x30, der(0x17, b"200101000000Z") + der(0x17, scade.encode())) + nome(soggetto) + der(0x30, b"\x00" * 40))
    return der(0x30, tbs + der(0x30, der(0x06, b"\x2a")) + der(0x03, b"\x00" * 20))


def volo_server(c: bytes, spezza: bool = False) -> bytes:
    """ServerHello e Certificate, in un record o in due record di handshake."""
    hello = bytes([2]) + (38).to_bytes(3, "big") + b"\x03\x03" + b"\x00" * 36
    lista = len(c).to_bytes(3, "big") + c
    certmsg = bytes([11]) + (len(lista) + 3).to_bytes(3, "big") + len(lista).to_bytes(3, "big") + lista
    rec = lambda corpo: b"\x16\x03\x03" + len(corpo).to_bytes(2, "big") + corpo  # noqa: E731
    return rec(hello) + rec(certmsg) if spezza else rec(hello + certmsg)


def pacchetto(src, dst, proto, sport, dport, carico: bytes) -> bytes:
    if proto == 6:
        l4 = struct.pack(">HHIIBBHHH", sport, dport, 1, 1, 0x50, 0x18, 0, 0, 0)
    else:
        l4 = struct.pack(">HHHH", sport, dport, 8 + len(carico), 0)
    ip = bytes([0x45, 0]) + struct.pack(">H", 20 + len(l4) + len(carico)) + b"\x00" * 4 + bytes([64, proto]) + b"\x00\x00" + bytes(src) + bytes(dst)
    return b"\x02" * 6 + b"\x04" * 6 + b"\x08\x00" + ip + l4 + carico


def dns(txid: int, risposta: bool = False, rcode: int = 0) -> bytes:
    bandiere = (0x8180 | rcode) if risposta else 0x0100
    return struct.pack(">HHHHHH", txid, bandiere, 1, 0, 0, 0) + b"\x03www\x07esempio\x02it\x00\x00\x01\x00\x01"


CLIENT, SERVER, FUORI = [10, 4, 0, 10], [10, 4, 0, 20], [8, 8, 8, 8]


class Certificato(unittest.TestCase):
    def test_scaduto_autofirmato_e_normale(self):
        self.assertEqual(controlli.certificato(volo_server(cert("stampante", "stampante", "250101000000Z"))), {"scade": "2025-01-01 00:00:00", "autofirmato": True})
        self.assertEqual(controlli.certificato(volo_server(cert("CA di casa", "server", "300101000000Z"), spezza=True)), {"scade": "2030-01-01 00:00:00", "autofirmato": False})

    def test_tronco_dice_solo_quello_che_si_vede(self):
        intero = volo_server(cert("una autorità con un nome molto lungo" * 3, "server", "300101000000Z"))
        tronco = intero[:intero.index(b"300101") + 13]  # la cattura finisce appena dopo la scadenza
        self.assertEqual(controlli.certificato(tronco), {"scade": "2030-01-01 00:00:00", "autofirmato": None})
        self.assertIsNone(controlli.certificato(b"\x16\x03\x03\x00\x05" + b"\x01\x00\x00\x01\x00"))  # saluto del client
        self.assertIsNone(controlli.certificato(b"GET / HTTP/1.1\r\n"))


class Ascolta(unittest.TestCase):
    def setUp(self):
        self.fatti = []
        self.a = Ascolto(RETI, lambda visto, tipo, c, s, p, d: self.fatti.append((tipo, c, s, p, d)), lambda *x: None)

    def test_certificato_di_casa_uno_per_servizio_non_per_client(self):
        volo = volo_server(cert("stampante", "stampante", "250101000000Z"))
        for i in range(5):
            self.a.pacchetto(1_795_000_000 + i, pacchetto(SERVER, [10, 4, 0, 30 + i], 6, 443, 50000, volo))
        self.a.pacchetto(1_795_000_010, pacchetto(FUORI, CLIENT, 6, 443, 50000, volo))  # di un servizio fuori non si dice
        self.assertEqual(self.fatti, [("tls_certificato", "", "10.4.0.20", 443, {"motivo": "scaduto", "scaduto_il": "2025-01-01"})])

    def test_dns_verso_fuori(self):
        self.a.pacchetto(1000, pacchetto(CLIENT, FUORI, 17, 40000, 53, dns(1)))
        self.a.pacchetto(1001, pacchetto(CLIENT, SERVER, 17, 40001, 53, dns(2)))
        self.assertEqual([f for f in self.fatti if f[0] == "dns_esterno"], [("dns_esterno", "10.4.0.10", "esterno", 53, {})])

    def test_errori_e_senza_risposta_oltre_la_soglia(self):
        t = 1200
        for i in range(DNS_ERRORI_SOGLIA):
            self.a.pacchetto(t, pacchetto(CLIENT, SERVER, 17, 40000 + i, 53, dns(i)))
            self.a.pacchetto(t, pacchetto(SERVER, CLIENT, 17, 53, 40000 + i, dns(i, risposta=True, rcode=2)))
        self.a.pacchetto(t + 400, pacchetto(CLIENT, SERVER, 17, 1, 53, dns(999)))  # chiude la finestra
        self.assertIn(("dns_errori", "10.4.0.10", "", 53, {"richieste": DNS_ERRORI_SOGLIA, "errori": DNS_ERRORI_SOGLIA, "senza_risposta": 0}), self.fatti)

    def test_senza_nessuna_risposta_non_si_inventa_niente(self):
        for i in range(DNS_ERRORI_SOGLIA * 2):
            self.a.pacchetto(1200, pacchetto(CLIENT, SERVER, 17, 40000 + i, 53, dns(i)))
        self.a.pacchetto(1600, pacchetto(CLIENT, SERVER, 17, 1, 53, dns(999)))
        self.assertEqual([f for f in self.fatti if f[0] == "dns_errori"], [])


if __name__ == "__main__":
    unittest.main()
