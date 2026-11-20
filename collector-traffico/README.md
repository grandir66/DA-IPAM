# Collector di traffico

Una VM leggera che ascolta il traffico in copia (mirror) e conta **chi parla con chi**.
IPAM la legge col cursore e calcola le anomalie. Spec:
`docs/superpowers/specs/2026-11-20-collector-traffico-design.md`.

**Non è** la sonda pesante (l'NDR con Suricata e Zeek): è un servizio a sé, senza codice in
comune con Edge né con l'NDR, e in un punto di ascolto va **o** il collector **o** la sonda
pesante. Non manda mai niente sulla rete ascoltata: la scheda in mirror non ha indirizzo,
ha ARP e IPv6 spenti.

## Com'è fatto

| Pezzo | Cosa fa |
|---|---|
| `pmacctd` (pacchetto Debian) | conta i pacchetti del mirror per sorgente, destinazione, protocollo e porte; ogni 300 secondi scrive un file in `/var/lib/collector-traffico/in/` |
| `collector/piega.py` | da righe per flusso a coppie client-server: la porta effimera si butta, le due direzioni si sommano, gli indirizzi fuori dalle reti interne diventano `esterno` (se ne tiene solo il numero), multicast e broadcast diventano `diffusione` |
| `collector/archivio.py` | SQLite con un numero progressivo per riga; tiene 7 giorni |
| `collector/api.py` | HTTPS sulla 8477, gettone in `Authorization: Bearer` |
| `collector/__main__.py` | ogni 30 secondi prende i file nuovi; legge da `/proc/net/dev` pacchetti visti e scartati |

Solo libreria standard di Python: niente da installare oltre a `pmacct`, `tcpdump`, `python3`, `openssl`.

## Installazione (Debian 12, da root)

```bash
bash /opt/collector-traffico/installa.sh <scheda in mirror> [nome]
```

Stampa l'impronta del certificato e dice dove sta il gettone (`/etc/collector-traffico/gettone`),
senza stamparlo. Configurazione in `/etc/collector-traffico/collector.env`: `MIRROR_IF`, `NOME`,
`RETI_INTERNE` (aggiunte alle private), `MIRROR_DOPPIO=1` se lo switch copia entrata e uscita.

## API

Ogni richiesta vuole il gettone; senza: 401.

- `GET /v1/stato` → `{versione, nome, avviato, ultimo_seq, pacchetti_visti, pacchetti_persi, copertura}`,
  con `copertura = 1 - persi / (visti + persi)`.
- `GET /v1/coppie?dopo=<seq>&limite=<1..1000>` → `{righe, ultimo_seq, altri, buco}`. Ogni riga:
  `seq, inizio, durata_s, client, server, proto, porta, byte, pacchetti, flussi, esterni`.
  `buco: true` vuol dire che chi legge era rimasto indietro di più di 7 giorni e delle righe sono andate perse.

## Prove

```bash
cd /Users/riccardo/Progetti/Domarc/DA-IPAM/collector-traffico && python3 -m unittest discover -s tests -t .
```

Le prove sono `unittest` della libreria standard; girano anche con `python3 -m pytest collector-traffico/tests`
dove pytest è installato.

## Banco e misura

Da scrivere col Task 2 del piano (VM `collector-banco` su PX-NAS, comandi del mirror, tabella della misura).
