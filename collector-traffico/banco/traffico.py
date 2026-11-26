"""Traffico di prova dal CT 110 per la cattura di Zeek (cattura-zeek.sh). Valori inventati e riconoscibili."""
import base64
import ftplib
import socket

UTENTE, SEGRETO, COMUNITA = "prova-utente", "Prova-Segreto-7731", "comunita-di-prova-7731"
SIM, FINTI = "192.168.99.222", "192.168.99.223"


def fai(nome, f):
    try:
        f()
        print(nome, "fatto")
    except Exception as e:  # il banco va avanti: si annota e basta
        print(nome, "errore", type(e).__name__, e)


def http_basic():
    s = socket.create_connection((SIM, 80), 3)
    cred = base64.b64encode(f"{UTENTE}:{SEGRETO}".encode()).decode()
    s.sendall(f"GET /privato HTTP/1.1\r\nHost: {SIM}\r\nAuthorization: Basic {cred}\r\nConnection: close\r\n\r\n".encode())
    while s.recv(4096):
        pass
    s.close()


def ftp():
    f = ftplib.FTP()
    f.connect(FINTI, 21, timeout=3)
    f.login(UTENTE, SEGRETO)
    f.quit()


def _tlv(tag, corpo):
    return bytes([tag, len(corpo)]) + corpo


def snmp(comunita, versione=1):
    oid = _tlv(0x06, bytes([0x2B, 6, 1, 2, 1, 1, 1, 0]))
    vb = _tlv(0x30, _tlv(0x30, oid + b"\x05\x00"))
    pdu = _tlv(0xA0, _tlv(0x02, b"\x2a") + _tlv(0x02, b"\x00") + _tlv(0x02, b"\x00") + vb)
    msg = _tlv(0x30, _tlv(0x02, bytes([versione])) + _tlv(0x04, comunita.encode()) + pdu)
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    for _ in range(2):
        s.sendto(msg, (FINTI, 161))
    s.close()


def modbus_scrittura():
    s = socket.create_connection(("192.168.99.221", 502), 3)
    s.sendall(bytes([0, 1, 0, 0, 0, 6, 1, 6, 0, 1, 0, 7]))  # funzione 6: scrive il registro 1 = 7
    s.recv(256)
    s.close()


def ldap_bind():
    dn = f"cn={UTENTE},dc=banco,dc=test".encode()
    bind = _tlv(0x60, _tlv(0x02, b"\x03") + _tlv(0x04, dn) + _tlv(0x80, SEGRETO.encode()))
    s = socket.create_connection((FINTI, 389), 3)
    s.sendall(_tlv(0x30, _tlv(0x02, b"\x01") + bind))
    s.recv(256)
    s.sendall(_tlv(0x30, _tlv(0x02, b"\x02") + b"\x42\x00"))  # unbind
    s.close()


def rifiutata():
    try:
        socket.create_connection((SIM, 81), 3)
    except ConnectionRefusedError:
        return


def senza_risposta():
    try:
        socket.create_connection(("192.0.2.1", 9), 3)
    except OSError:
        return


fai("http_basic", http_basic)
fai("ftp", ftp)
fai("snmp_prova", lambda: snmp(COMUNITA))
fai("snmp_public", lambda: snmp("public"))
fai("modbus", modbus_scrittura)
fai("ldap", ldap_bind)
fai("rifiutata", rifiutata)
fai("senza_risposta", senza_risposta)
