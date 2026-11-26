import base64
import io
import struct
import unittest

from collector import controlli
from collector.ascolto import FILTRO, Ascolto, leggi_pcap, spacchetta
from collector.controlli import TCP, UDP, controlla, nomi, risposta_nome, saluto_tls
from collector.piega import RETI_INTERNE_DI_SERIE as RETI

SEGRETO = b"ProvaSegreta123"


def tipi(proto, sport, dport, carico):
    return [f["tipo"] for f in controlla(proto, sport, dport, carico)]


def saluto(versione=0x0303, nome=b"posta.esempio.it", versioni=None):
    """Un ClientHello fatto a mano: versione nell'intestazione, SNI, ed eventuale supported_versions."""
    est = b""
    if nome:
        sni = b"\x00" + struct.pack(">H", len(nome)) + nome
        sni = struct.pack(">H", len(sni)) + sni
        est += struct.pack(">HH", 0, len(sni)) + sni
    if versioni:
        v = b"".join(struct.pack(">H", x) for x in versioni)
        est += struct.pack(">HHB", 0x2B, len(v) + 1, len(v)) + v
    corpo = struct.pack(">H", versione) + bytes(32) + b"\x00" + struct.pack(">H", 2) + b"\x00\x2f" + b"\x01\x00" + struct.pack(">H", len(est)) + est
    stretta = b"\x01" + struct.pack(">I", len(corpo))[1:] + corpo
    return b"\x16\x03\x01" + struct.pack(">H", len(stretta)) + stretta


def dns(nome, risposta=False, risposte=0):
    q = b"".join(bytes([len(p)]) + p.encode() for p in nome.split(".")) + b"\x00\x00\x01\x00\x01"
    return struct.pack(">HHHHHH", 0x1234, 0x8000 if risposta else 0x0100, 1, risposte, 0, 0) + q


def snmp(versione, comunita):
    corpo = b"\x02\x01" + bytes([versione]) + b"\x04" + bytes([len(comunita)]) + comunita + b"\xa0\x02\x05\x00"
    return b"\x30" + bytes([len(corpo)]) + corpo


def ldap(password, nome=b"cn=admin,dc=esempio,dc=it"):
    bind = b"\x02\x01\x03" + b"\x04" + bytes([len(nome)]) + nome + b"\x80" + bytes([len(password)]) + password
    corpo = b"\x02\x01\x01" + b"\x60" + bytes([len(bind)]) + bind
    return b"\x30" + bytes([len(corpo)]) + corpo


def pacchetto(src, dst, proto, sport, dport, carico, vlan=None):
    ip = lambda a: bytes(int(x) for x in a.split("."))
    if proto == TCP:
        l4 = struct.pack(">HHIIBBHHH", sport, dport, 1, 1, 5 << 4, 0x18, 1000, 0, 0)
    else:
        l4 = struct.pack(">HHHH", sport, dport, 8 + len(carico), 0)
    ipv4 = struct.pack(">BBHHHBBH", 0x45, 0, 20 + len(l4) + len(carico), 0, 0, 64, proto, 0) + ip(src) + ip(dst)
    eth = bytes(12) + (struct.pack(">HH", 0x8100, vlan) if vlan else b"") + b"\x08\x00"
    return eth + ipv4 + l4 + carico


class Controlli(unittest.TestCase):
    def test_chiaro_telnet_ftp(self):
        self.assertEqual(tipi(TCP, 50000, 23, b"\xff\xfd\x18"), ["chiaro_telnet"])
        self.assertEqual(tipi(TCP, 50000, 21, b"PASS " + SEGRETO + b"\r\n"), ["chiaro_ftp"])
        self.assertEqual(tipi(TCP, 50000, 21, b"USER anonimo\r\n"), [])
        self.assertEqual(tipi(TCP, 21, 50000, b"230 PASS accettata\r\n"), [])

    def test_chiaro_posta(self):
        self.assertEqual(tipi(TCP, 50000, 110, b"PASS " + SEGRETO + b"\r\n"), ["chiaro_posta"])
        self.assertEqual(tipi(TCP, 50000, 143, b"a1 LOGIN mario " + SEGRETO + b"\r\n"), ["chiaro_posta"])
        self.assertEqual(tipi(TCP, 50000, 143, b"a1 CAPABILITY\r\n"), [])
        self.assertEqual(tipi(TCP, 50000, 25, b"AUTH PLAIN " + base64.b64encode(SEGRETO) + b"\r\n"), ["chiaro_posta"])
        self.assertEqual(tipi(TCP, 50000, 25, b"EHLO banco\r\n"), [])

    def test_chiaro_http_basic(self):
        r = b"GET / HTTP/1.1\r\nHost: x\r\nAuthorization: Basic " + base64.b64encode(b"mario:" + SEGRETO) + b"\r\n\r\n"
        self.assertEqual(tipi(TCP, 50000, 80, r), ["chiaro_http_basic"])
        self.assertEqual(tipi(TCP, 50000, 80, b"GET / HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer abc\r\n\r\n"), [])

    def test_chiaro_ldap(self):
        self.assertEqual(tipi(TCP, 50000, 389, ldap(SEGRETO)), ["chiaro_ldap"])
        self.assertEqual(tipi(TCP, 50000, 389, ldap(b"", b"")), [])  # bind anonimo
        self.assertEqual(tipi(TCP, 50000, 389, b"\x30\x05\x02\x01\x01\x42\x00"), [])  # unbind

    def test_snmp_vecchio(self):
        f = controlla(UDP, 50000, 161, snmp(1, b"public"))[0]
        self.assertEqual((f["tipo"], f["dettaglio"]), ("snmp_vecchio", {"versione": "2c", "comunita_nota": True}))
        f = controlla(UDP, 50000, 161, snmp(0, b"ComunitaSegreta"))[0]
        self.assertEqual(f["dettaglio"], {"versione": "1", "comunita_nota": False})
        self.assertEqual(tipi(UDP, 50000, 161, snmp(3, b"")), [])

    def test_smb1_solo_dalla_risposta(self):
        testa = b"\x00\x00\x00\x40" + b"\xffSMB" + b"\x72" + bytes(4)
        f = controlla(TCP, 445, 50000, testa + b"\x98" + bytes(40))
        self.assertEqual([(x["tipo"], x["verso_server"]) for x in f], [("smb1", False)])
        self.assertEqual(tipi(TCP, 50000, 445, testa + b"\x18" + bytes(40)), [])  # la richiesta non basta
        self.assertEqual(tipi(TCP, 445, 50000, b"\x00\x00\x00\x40" + b"\xfeSMB" + bytes(60)), [])  # SMB2

    def test_tls_vecchio_e_nome(self):
        self.assertEqual(tipi(TCP, 50000, 443, saluto(0x0301)), ["tls_vecchio"])
        self.assertEqual(tipi(TCP, 50000, 8443, saluto(0x0300)), ["tls_vecchio"])
        self.assertEqual(tipi(TCP, 50000, 443, saluto(0x0303)), [])
        # TLS 1.3 si presenta come 1.2 e dichiara la versione vera in supported_versions (con un GREASE davanti)
        self.assertEqual(saluto_tls(saluto(0x0303, versioni=[0x1A1A, 0x0304, 0x0303])), (0x0304, "posta.esempio.it"))
        self.assertEqual(nomi(TCP, 50000, 443, saluto(0x0303)), [("sni", "posta.esempio.it")])
        self.assertEqual(nomi(TCP, 50000, 443, saluto(0x0303, nome=b"")), [])
        self.assertIsNone(saluto_tls(b"\x16\x03\x01\x00\x05\x02" + bytes(60)))  # ServerHello

    def test_ntlm1(self):
        def tipo3(lungo_nt):
            return b"\x00" * 30 + b"NTLMSSP\x00\x03\x00\x00\x00" + struct.pack("<HHI", 24, 24, 64) + struct.pack("<HHI", lungo_nt, lungo_nt, 88) + bytes(80)
        self.assertEqual(tipi(TCP, 50000, 445, tipo3(24)), ["ntlm1"])
        self.assertEqual(tipi(TCP, 50000, 445, tipo3(310)), [])  # NTLMv2

    def test_impianto_scrittura(self):
        modbus = lambda funzione: bytes([0, 1, 0, 0, 0, 6, 1, funzione, 0, 0, 0, 2])
        for funzione in (5, 6, 15, 16):
            self.assertEqual(tipi(TCP, 50000, 502, modbus(funzione)), ["impianto_scrittura"])
        self.assertEqual(tipi(TCP, 50000, 502, modbus(3)), [])  # lettura
        self.assertEqual(tipi(TCP, 502, 50000, modbus(6)), [])  # la risposta del PLC
        s7 = lambda funzione: b"\x03\x00\x00\x24\x02\xf0\x80\x32\x01\x00\x00\x00\x01\x00\x0e\x00\x05" + bytes([funzione]) + bytes(18)
        self.assertEqual(tipi(TCP, 50000, 102, s7(0x05)), ["impianto_scrittura"])
        self.assertEqual(tipi(TCP, 50000, 102, s7(0x04)), [])  # lettura

    def test_dns(self):
        self.assertEqual(nomi(UDP, 50000, 53, dns("www.esempio.it")), [("dns", "www.esempio.it")])
        self.assertEqual(tipi(UDP, 50000, 53, dns("www.esempio.it")), [])
        lungo = ".".join(["a" * 50] * 3) + ".esempio.it"
        f = controlla(UDP, 50000, 53, dns(lungo))[0]
        self.assertEqual((f["tipo"], f["dettaglio"]["motivo"]), ("dns_anomalo", "nome_lungo"))
        self.assertEqual(nomi(UDP, 53, 50000, dns("www.esempio.it", risposta=True, risposte=1)), [])

    def test_risposta_nome(self):
        self.assertEqual(risposta_nome(UDP, 5355, dns("wpad", risposta=True, risposte=1)), "wpad")
        self.assertIsNone(risposta_nome(UDP, 5355, dns("wpad")))  # una domanda
        nb = bytes("".join(chr(65 + (b >> 4)) + chr(65 + (b & 15)) for b in b"FILESRV        \x20"), "ascii")
        netbios = struct.pack(">HHHHHH", 1, 0x8500, 0, 1, 0, 0) + b"\x20" + nb + b"\x00\x00\x20\x00\x01"
        self.assertEqual(risposta_nome(UDP, 137, netbios), "filesrv")
        # richiesta di stato («*», nbtstat): risponde chiunque con lo stesso nome, non è conteso. 229 avvisi falsi il 25/11/2026
        stella = b"CK" + b"A" * 30
        stato = struct.pack(">HHHHHH", 1, 0x8400, 0, 1, 0, 0) + b"\x20" + stella + b"\x00\x00\x21\x00\x01"
        self.assertIsNone(risposta_nome(UDP, 137, stato))
        # lo stato chiesto per un nome vero resta fuori anche lui: è il tipo (0x21) che dice «stato»
        self.assertIsNone(risposta_nome(UDP, 137, netbios[:-4] + b"\x00\x21\x00\x01"))

    def test_nessun_valore_esce(self):
        """Il fatto si salva, il valore mai: nessun dettaglio contiene la password o la comunità."""
        casi = [(TCP, 50000, 21, b"PASS " + SEGRETO + b"\r\n"), (TCP, 50000, 110, b"PASS " + SEGRETO + b"\r\n"),
                (TCP, 50000, 143, b"a1 LOGIN mario " + SEGRETO + b"\r\n"), (TCP, 50000, 389, ldap(SEGRETO)),
                (UDP, 50000, 161, snmp(1, SEGRETO)), (TCP, 50000, 23, SEGRETO),
                (TCP, 50000, 80, b"GET / HTTP/1.1\r\nAuthorization: Basic " + SEGRETO + b"\r\n\r\n")]
        for caso in casi:
            fatti = controlla(*caso)
            self.assertEqual(len(fatti), 1, caso)
            self.assertNotIn("ProvaSegreta", repr(fatti))
            self.assertNotIn("mario", repr(fatti))


class AscoltoStato(unittest.TestCase):
    def setUp(self):
        self.fatti, self.nomi = [], []
        self.a = Ascolto(RETI, lambda *f: self.fatti.append(f), lambda visto, c: self.nomi.append((visto, dict(c))))

    def test_spacchetta_con_e_senza_vlan(self):
        atteso = ("192.168.99.88", "192.168.99.222", TCP, 50000, 21, b"PASS x\r\n")
        self.assertEqual(spacchetta(pacchetto("192.168.99.88", "192.168.99.222", TCP, 50000, 21, b"PASS x\r\n")), atteso)
        self.assertEqual(spacchetta(pacchetto("192.168.99.88", "192.168.99.222", TCP, 50000, 21, b"PASS x\r\n", vlan=77)), atteso)
        self.assertIsNone(spacchetta(bytes(12) + b"\x08\x06" + bytes(28)))  # ARP
        self.assertIn("vlan and", FILTRO)

    def test_fatto_una_volta_l_ora_e_senza_valore(self):
        p = pacchetto("192.168.99.88", "192.168.99.222", TCP, 50000, 21, b"PASS " + SEGRETO + b"\r\n")
        for t in (1000, 1010, 4599):
            self.a.pacchetto(t, p)
        self.assertEqual(len(self.fatti), 1)
        self.a.pacchetto(4601, p)
        self.assertEqual(len(self.fatti), 2)
        self.assertEqual(self.fatti[0][1:5], ("chiaro_ftp", "192.168.99.88", "192.168.99.222", 21))
        self.assertNotIn("ProvaSegreta", repr(self.fatti))

    def test_smb1_client_e_server_dalla_risposta_ed_esterno(self):
        smb = b"\x00\x00\x00\x40\xffSMB\x72" + bytes(4) + b"\x98" + bytes(40)
        self.a.pacchetto(1000, pacchetto("192.168.99.222", "192.168.99.88", TCP, 445, 50000, smb))
        self.assertEqual(self.fatti[0][1:5], ("smb1", "192.168.99.88", "192.168.99.222", 445))
        self.a.pacchetto(1000, pacchetto("192.168.99.88", "93.184.216.34", TCP, 50000, 443, saluto(0x0301)))
        self.assertEqual(self.fatti[1][1:5], ("tls_vecchio", "192.168.99.88", "esterno", 443))

    def test_nome_conteso(self):
        r = dns("wpad", risposta=True, risposte=1)
        self.a.pacchetto(1000, pacchetto("192.168.99.10", "192.168.99.88", UDP, 5355, 50000, r))
        self.a.pacchetto(1001, pacchetto("192.168.99.10", "192.168.99.88", UDP, 5355, 50001, r))
        self.assertEqual(self.fatti, [])
        self.a.pacchetto(1002, pacchetto("192.168.99.66", "192.168.99.88", UDP, 5355, 50002, r))
        self.assertEqual(self.fatti[0][1:4], ("nome_conteso", "192.168.99.66", "192.168.99.10"))
        self.assertEqual(self.fatti[0][5], {"nome": "wpad"})

    def test_dns_molte_richieste_e_nomi_per_finestra(self):
        for i in range(1001):
            self.a.pacchetto(1200 + i % 200, pacchetto("192.168.99.88", "192.168.99.1", UDP, 40000, 53, dns(f"h{i % 300}.esempio.it")))
        self.assertEqual([f[1] for f in self.fatti], ["dns_anomalo"])
        self.assertEqual(self.fatti[0][5]["motivo"], "molte_richieste")
        self.a.chiudi(1500)
        visto, conteggi = self.nomi[0]
        self.assertEqual(visto, "1970-01-01 00:20:00")
        self.assertEqual(len(conteggi), 200)  # tetto dei nomi diversi per host al giorno
        self.assertEqual(conteggi[("192.168.99.88", "dns", "h0.esempio.it")], 4)

    def test_leggi_pcap(self):
        p = pacchetto("192.168.99.88", "192.168.99.222", UDP, 40000, 53, dns("www.esempio.it"))
        flusso = struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 256, 1) + struct.pack("<IIII", 1700000000, 0, len(p), len(p)) + p + b"\x00\x01"
        self.assertEqual(list(leggi_pcap(io.BytesIO(flusso))), [(1700000000, p)])
        self.assertEqual(len(controlli.TIPI), 15)  # 12 dei controlli, più i 3 della tappa 6 (23/11)


if __name__ == "__main__":
    unittest.main()


class CatturaDelBanco(unittest.TestCase):
    """Pacchetti veri, catturati il 20/11/2026 sul banco (PX-NAS, mirror del contenitore `banco-carico`):
    un client che fa un accesso per ogni controllo verso server finti. La password è finta
    («ProvaSegreta123») e i MAC sono azzerati. Si rigenera con gli script descritti nel README."""

    def test_i_fatti_della_cattura_e_nessun_valore(self):
        import os
        percorso = os.path.join(os.path.dirname(__file__), "dati", "controlli-banco.pcap")
        fatti, nomi_visti = [], {}
        a = Ascolto(RETI, lambda *f: fatti.append(f), lambda visto, c: nomi_visti.update(c))
        with open(percorso, "rb") as f:
            grezzo = f.read()
        self.assertIn(SEGRETO, grezzo)  # nella cattura la password c'è: la prova ha senso
        ultimo = 0
        for t, p in leggi_pcap(io.BytesIO(grezzo)):
            a.pacchetto(t, p)
            ultimo = t
        a.chiudi(ultimo + 600)
        self.assertEqual(sorted({f[1] for f in fatti}), sorted([
            "chiaro_ftp", "chiaro_http_basic", "chiaro_ldap", "chiaro_posta", "chiaro_telnet", "dns_anomalo",
            "impianto_scrittura", "nome_conteso", "ntlm1", "smb1", "snmp_vecchio", "tls_vecchio"]))
        self.assertNotIn("ProvaSegreta", repr(fatti))
        self.assertNotIn("ProvaSegreta", repr(nomi_visti))
        self.assertTrue(all(f[2] in ("192.168.99.1", "192.168.99.88") for f in fatti))
        self.assertIn(("192.168.99.1", "dns", "www.banco.test"), nomi_visti)
        self.assertIn(("192.168.99.1", "sni", "vecchio.banco.test"), nomi_visti)
        self.assertIn(("192.168.99.1", "sni", "moderno.banco.test"), nomi_visti)
        tls = [f for f in fatti if f[1] == "tls_vecchio"]
        self.assertEqual(len(tls), 1)  # il saluto moderno non è un fatto
