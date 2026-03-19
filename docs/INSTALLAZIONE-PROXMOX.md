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
3. Avvia `scripts/proxmox-lxc-install.sh` (wizard LXC interattivo)

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
