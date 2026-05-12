# Playbook operativi Domarc

Procedure step-by-step per le operazioni ricorrenti su DA-IPAM, DA-Vul-can
e infrastruttura condivisa (bridge VM clienti, Tailscale, segreti).

Ogni playbook è pensato per essere **autosufficiente**: scarica + segui
senza dover conoscere il resto. Tempi e prerequisiti documentati in
testa a ogni file.

## Indice

### Setup nuovi nodi
- [DEPLOY-NEW-HUB.md](DEPLOY-NEW-HUB.md) — VM Ubuntu vuota → hub Domarc produzione
- [DEPLOY-NEW-BRIDGE.md](DEPLOY-NEW-BRIDGE.md) — Proxmox template → bridge cliente
- [DEPLOY-NEW-AGENT.md](DEPLOY-NEW-AGENT.md) — host esistente → agent DA-IPAM

### Manutenzione
- [CHANGE-TAILNET.md](CHANGE-TAILNET.md) — migrazione tailnet (personale → aziendale)
- [CHANGE-ENCRYPTION-KEY.md](CHANGE-ENCRYPTION-KEY.md) — rotazione chiave cifratura
- [DR.md](DR.md) — disaster recovery (3 scenari)

## Convenzioni

- Tempi e RTO target in testa a ogni playbook
- Prerequisiti listati esplicitamente
- Checklist finale per ogni procedura
- Sezione **Troubleshooting** con sintomi/cause/fix dei problemi più comuni

## Come aggiornare un playbook

Quando esegui per la prima volta una procedura nel mondo reale:

1. Segui il playbook
2. **Annota tutto** ciò che non è chiaro o che non funziona
3. Alla fine, fai una PR che aggiorna il playbook con:
   - Comando che mancava
   - Step che si è dovuto inserire
   - Gotcha che si è scoperto
4. Inseriscilo nella sezione **Troubleshooting** del playbook

Un playbook che non si aggiorna è un playbook che sta morendo.

## Quando creare un nuovo playbook

Una procedura merita un playbook se:
- È stata fatta o sarà fatta **≥3 volte** nello stesso modo
- Coinvolge **≥5 step** in sequenza specifica
- Ha gotchas operative non ovvie dal codice

Procedure one-shot da CLAUDE.md o commit history non vanno qui:
inquinano l'indice.
