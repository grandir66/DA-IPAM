# Installazione su Proxmox VE

Procedura ufficiale descritta anche nel [README principale](../README.md#installazione-proxmox-una-riga).

## Comando rapido (nodo Proxmox, utente root)

Scarica lo script di bootstrap su disco ed eseguilo (evita `curl | bash` per non bloccare le domande interattive):

```bash
curl -fsSL https://raw.githubusercontent.com/grandir66/DA-IPAM/main/scripts/bootstrap-proxmox.sh -o /tmp/da-invent-bootstrap.sh \
  && bash /tmp/da-invent-bootstrap.sh
```

Lo script:

1. Installa `git` e `curl` con `apt` se mancanti  
2. Clona il repository (branch `main`, URL configurabile con `DA_INVENT_GIT_URL`)  
3. Avvia `scripts/proxmox-lxc-install.sh` (wizard LXC): storage **vztmpl** e **rootdir** da elenco numerato `pvesm`, template da `pveam list` o da catalogo numerato se serve il download, **bridge** da menu numerato (opzione 0 = nome manuale)

## Solo wizard (repository già presente)

```bash
cd /percorso/DA-IPAM
chmod +x scripts/proxmox-lxc-install.sh
./scripts/proxmox-lxc-install.sh
```

## Variabili d’ambiente

| Variabile | Effetto |
|-----------|---------|
| `DA_INVENT_GIT_URL` | URL del repository da clonare nel bootstrap / default nel wizard |
| `DA_INVENT_BRANCH` | Branch Git (default `main`) |
| `DA_INVENT_BOOTSTRAP_DIR` | Directory clone bootstrap (default `/root/da-invent-install`) |

Dopo la creazione del container, vedi il README per accesso web (`http://<ip-ct>:3001`) e setup iniziale.

## Aggiornamento CT di test / produzione (dal nodo Proxmox)

Esegui come **root sul nodo Proxmox** (non dentro il CT). Lo script usa `pct exec` e la directory predefinita **`/opt/da-invent`** nel container (come da wizard).

```bash
cd /percorso/del/clone/DA-IPAM
chmod +x scripts/pct-update.sh
./scripts/pct-update.sh <VMID>
```

Esempio: `./scripts/pct-update.sh 150` per il CT con ID 150.

Equivalente manuale:

```bash
pct exec <VMID> -- bash -ce 'cd /opt/da-invent && ./scripts/update.sh --restart'
```

Se l’app è installata altrove nel CT: `DA_INVENT_DIR=/percorso ./scripts/pct-update.sh <VMID>`.

In alternativa, da **dentro** il CT: `cd /opt/da-invent && ./scripts/update.sh --restart`.

## Opzionale: snapshot database CT → Mac

La **copia di riferimento** del progetto è la **cartella sul Mac** (clone Git). Il CT è deploy; **non** si usa per «ricostruire» il progetto al posto del Mac.

Questo script serve **solo** se vuoi **sostituire** i file `data/ipam.db*` sul Mac con quelli attuali del container (debug, confronto). **Sovrascrive** i dati locali (ma fa un backup in `data/.backup-before-pull-<timestamp>/`).

Sul **Mac**, dalla root del repo, con SSH al nodo Proxmox già configurato:

```bash
cd /percorso/DA-IPAM
chmod +x scripts/pull-db-from-pct.sh
./scripts/pull-db-from-pct.sh
```

Default: `root@192.168.99.10`, CT **150**, dati in `/opt/da-invent/data` nel CT. Personalizza:

```bash
DA_INVENT_SSH=root@tuo-pve DA_INVENT_PCT=150 ./scripts/pull-db-from-pct.sh
```

Chiudi i processi che tengono aperto il DB (`npm run dev`, ecc.) prima di eseguirlo; poi riavvia l’app locale.
