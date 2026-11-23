"""Server finti sul banco (CT 103) per la cattura di Zeek: FTP su 21 e LDAP su 389. Accettano tutto.
Solo per il banco del PX-NAS; si tolgono a fine cattura (cattura-zeek.sh)."""
import socket
import sys
import threading

IP = sys.argv[1]


def ftp(c):
    c.sendall(b"220 banco\r\n")
    f = c.makefile("rb")
    for riga in f:
        cmd = riga[:4].upper()
        if cmd == b"USER":
            c.sendall(b"331 password\r\n")
        elif cmd == b"PASS":
            c.sendall(b"230 dentro\r\n")
        elif cmd == b"QUIT":
            c.sendall(b"221 ciao\r\n")
            break
        else:
            c.sendall(b"502 no\r\n")
    c.close()


def ldap(c):
    dati = c.recv(4096)
    mid = dati[4] if len(dati) > 4 else 1
    # bindResponse: success, matchedDN e diagnosticMessage vuoti
    c.sendall(bytes([0x30, 0x0C, 0x02, 0x01, mid, 0x61, 0x07, 0x0A, 0x01, 0x00, 0x04, 0x00, 0x04, 0x00]))
    c.recv(4096)
    c.close()


def ascolta(porta, gestore):
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((IP, porta))
    s.listen(5)
    while True:
        c, _ = s.accept()
        threading.Thread(target=gestore, args=(c,), daemon=True).start()


threading.Thread(target=ascolta, args=(21, ftp), daemon=True).start()
ascolta(389, ldap)
