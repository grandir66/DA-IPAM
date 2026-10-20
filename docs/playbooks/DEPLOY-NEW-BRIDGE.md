# Playbook — Deploy nuovo bridge cliente da Proxmox template

Procedura per portare una nuova VM bridge presso un cliente, da clone del
template Proxmox a operatività completa (Greenbone + agent DA-IPAM +
NetBird + auto-registrazione DA-Vul-can).

> Il bridge-node vive in **DA-Vul-can** (`infra/bridge-node/`): le domande del
> wizard e le verifiche dell'installatore fanno fede lì, questo elenco può essere
> indietro. L'ingresso in NetBird lo governa **DA-Link** (comando emesso da DA-Link;
> per una macchina già in esercizio `DA-Link/docs/procedure/2026-10-20-sonda-esistente-in-netbird.md`).

**Tempo stimato**: 15-25 minuti, di cui ~5-10 di download feed se non si
parte da template (con feed pre-caricati).
**Prerequisiti**: template Proxmox `bridge-template` già esistente
(creato con `infra/bridge-node/make-template.sh` di DA-Vul-can), oggetto
creato in DA-Link per il cliente, accesso admin DA-IPAM e DA-Vul-can.

---

## 1. Clone template (1 min)

Sul nodo Proxmox:

```bash
# Lista template disponibili
qm list | grep template

# Clone (full clone, NON linked — i bridge clienti restano isolati)
qm clone <template-vmid> <new-vmid> \
  --name bridge-<codice-cliente> \
  --full

qm set <new-vmid> --memory 8192 --cores 4
qm start <new-vmid>
```

## 2. Pre-flight remoto (1 min)

Attendi il boot (~30s), poi SSH al bridge appena clonato (ancora hostname
`bridge-template`, su LAN dell'hypervisor):

```bash
ssh root@<bridge-ip-dhcp>

# Verifica che firstboot.service NON sia ancora partito (parte al primo boot
# tty, ma se hai bootato in headless mode potrebbe essere stato saltato)
systemctl status bridge-firstboot.service
```

## 3. Lanci pre-check installer (1 min)

```bash
cd /home/domarc/bridge-node    # path dello script versionato sul bridge
./bridge-installer.sh --precheck
```

Output atteso: tutti verde (Ubuntu 24.04, sudo, RAM ≥4G, disco ≥30G,
DNS, tool installati dal template). Se rosso, leggi l'errore e risolvi
prima di proseguire.

## 4. Lancio wizard firstboot (5-10 min)

Connettiti alla **console TTY** (qm terminal sul nodo Proxmox o IPMI):

```bash
qm terminal <new-vmid>   # o accesso console virtuale Proxmox
```

Login come `domarc` / password template, lancia il wizard:

```bash
sudo /home/domarc/bridge-node/firstboot/bridge-firstboot.sh
```

Il wizard ti chiederà in ordine:

1. **Hostname** — es. `bridge-acme`
2. **Modalità** — `client` (web UI GVM OFF) o `domarc-owned` (ON, per debug)
3. **Network** — DHCP raccomandato, oppure static con IP/gateway/DNS
4. **Password admin Greenbone** — min 12 char, oppure vuoto per auto-generata
   (apparirà UNA VOLTA — copiala in Keeper)
5. **Auto-registrazione DA-Vul-can** — yes, URL `https://da-vulcan`, token bootstrap
6. **Agent DA-IPAM** — yes (il bridge dev'essere già in NetBird, vedi sotto):
   - HUB_URL: `https://da-invent`
   - TENANT_CODE: codice cliente da DA-IPAM (es. `acme01`)
   - AGENT_TOKEN: dal wizard `/agents` → "Nuovo agente" → step 3
   - AGENT_PORT: 8443

Il wizard applica e termina in ~3-5 minuti.

**NetBird**: il bridge entra in NetBird col comando emesso da DA-Link (chiave
monouso, nodo `<codice>-edge`), incollato sul bridge prima dell'agent DA-IPAM.
Niente rotte pubblicate: le LAN del cliente si raggiungono con le risorse di rete
che DA-Link dichiara.

## 5. Verifica post-install (2 min)

```bash
# Dalla console o via ssh su NetBird
sudo /home/domarc/bridge-node/bridge-installer.sh --verify
```

Output atteso: tutti verde su ssh, ufw, docker, greenbone containers,
da-invent-agent, porta 8443 in listen; `netbird status` con «Management: Connected».

```bash
# Test diretto agent (richiede AGENT_TOKEN plaintext)
curl -fsS http://localhost:8443/healthz
# {"ok":true,"version":"0.3.0",...,"network":{"netbird":true,"netbird_ip":"100.107.x.y"}}
```

## 6. Verifica hub-side (2 min)

**Da DA-IPAM** (`https://da-invent/agents`):
- Refresh la pagina
- Il nuovo agent deve apparire come riga con `last_seen_at` recente
- Click "Test" → deve mostrare `online · Xms` verde

**Da DA-Vul-can** (`https://da-vulcan`):
- Sezione "Server OpenVAS" → deve apparire il nuovo bridge
- Test connessione GMP → verde

## 7. Aggiorna documentazione cliente

Compila il documento cliente con:
- VMID Proxmox
- Nome e IP NetBird (`netbird status` sul bridge, righe FQDN e NetBird IP)
- LAN cliente raggiungibili
- Password GVM (in Keeper sotto `Domarc / Bridge / <cliente>`)
- Token agent DA-IPAM (in Keeper, accanto a password GVM)

## Troubleshooting

### `netbird up` rifiuta la chiave
La chiave d'ingresso è monouso e scade: se ne emette un'altra da DA-Link.

### Greenbone containers non si avviano
```bash
# Sul bridge
sudo docker compose -p greenbone-community-edition --project-directory /opt/domarc/greenbone logs --tail 50
sudo docker compose -p greenbone-community-edition --project-directory /opt/domarc/greenbone ps
```
Cause comuni: feed NVT non scaricato (richiede 30-60 min al primo boot
se NON parti da template con feed cached); disco esaurito; OOM.

### Agent DA-IPAM 401 da hub
Token rigenerato hub-side ma agent ha ancora il vecchio in
`/etc/da-invent-agent/config.yml`. Rigenera token in UI hub, copia
plaintext, sostituisci `token_hash` in config:

```bash
# Sul bridge
sudo systemctl stop da-invent-agent
# Edita /etc/da-invent-agent/config.yml e aggiorna bcrypt hash del token
sudo systemctl start da-invent-agent
```

Più semplice: rigenera l'one-liner dalla UI hub e ri-esegui — fa upsert.

### Bridge non visibile in NetBird
Verifica `netbird status` sul bridge: deve dire «Management: Connected». Se
dice «NeedsLogin» la chiave è stata rifiutata (scaduta o già usata): se ne
emette un'altra da DA-Link.

## Checklist finale

- [ ] Clone Proxmox completato, VM running con risorse adeguate
- [ ] Pre-check installer verde
- [ ] Wizard firstboot completato senza errori
- [ ] Verify installer verde
- [ ] Greenbone web UI accessibile (se domarc-owned) o solo via gvm-tools (client)
- [ ] Bridge in NetBird con i gruppi giusti (DA-Link)
- [ ] Auto-registrazione DA-Vul-can riuscita
- [ ] Agent DA-IPAM visibile in `/agents` con last_seen recente
- [ ] Test connessione DA-IPAM verde
- [ ] Password GVM + token agent salvati in Keeper
- [ ] Documento cliente aggiornato
