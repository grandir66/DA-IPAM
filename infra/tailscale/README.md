# Tailscale policy — Domarc infrastructure

Questa cartella contiene la **policy ACL Tailscale** versionata per
l'infrastruttura Domarc (hub DA-IPAM, hub DA-Vul-can, bridge VM presso
cliente, workstation operatori).

## File

| File | Contenuto |
|---|---|
| [`policy.json`](policy.json) | ACL HuJSON da copiare 1:1 nel pannello admin Tailscale |

## Strategia tag

| Tag | Su quali nodi |
|---|---|
| `tag:da-hub` | Hub Next.js (DA-IPAM hub VM 533, DA-Vul-can hub, futuri hub) |
| `tag:da-bridge` | VM bridge presso cliente (Greenbone + agent Python) |
| `tag:da-admin` | Workstation operatori Domarc (Mac/Linux personali) |
| `tag:da-monitor` | Riservato — LibreNMS / Graylog / future osservabilità |

I **tag sono stabili** tra tailnet: la migrazione da personale ad aziendale
NON richiede di rinominarli. Cambiano solo `group:admins` (email account
operatori) e il subdomain MagicDNS `*.ts.net` — entrambi sono indipendenti dai
tag.

## Applicazione iniziale

1. **Apri il pannello admin Tailscale**:
   <https://login.tailscale.com/admin/acls>
2. **Sostituisci il contenuto** del policy file con quello di [`policy.json`](policy.json).
3. Tailscale eseguirà i test ACL inline; il deploy fallisce se uno fallisce.
4. **Salva**. Le ACL sono attive immediatamente.

## Tag dei nodi esistenti

Una volta che la policy è in vigore, i nodi devono dichiararsi col tag
corretto. Su ogni nodo da taggare:

```bash
# Hub DA-IPAM (VM 533) — eseguire come root
sudo tailscale up --reset \
  --advertise-tags=tag:da-hub \
  --ssh \
  --hostname=da-invent       # nome MagicDNS stabile

# Bridge presso cliente (es. bridge-domarc-ovh)
sudo tailscale up --reset \
  --advertise-tags=tag:da-bridge \
  --ssh \
  --hostname=bridge-domarc-ovh \
  --advertise-routes=192.168.51.0/24   # subnet del cliente

# Workstation operatore (Mac/Linux personale)
sudo tailscale up --reset \
  --advertise-tags=tag:da-admin \
  --ssh
```

⚠️ `--reset` forza Tailscale a riconnettersi e ri-asserire l'identità.
Se il nodo era già autenticato, la sua chiave macchina precedente resta
valida (non è una re-registration completa).

## Verifica

Dopo il deploy del policy + tagging:

```bash
# Dall'hub: deve poter raggiungere il bridge sulla porta agent
curl -fsS http://bridge-domarc-ovh:8443/healthz
# (richiede token per /whoami, ma /healthz è pubblico via Tailscale)

# Dal bridge: deve poter raggiungere l'hub sull'UI/API
curl -fsS https://da-invent
# (404 atteso dal Next.js — non l'errore, ma una risposta significa connettività ok)

# Dal Mac admin: deve poter ssh-are a entrambi
ssh root@da-invent
ssh root@bridge-domarc-ovh

# Tra bridge: DEVE fallire (ACL denied)
# (lanciato dall'host bridge-A verso bridge-B)
curl -fsS --max-time 5 http://bridge-altro-cliente:8443/healthz
# atteso: timeout o connection refused
```

## Modifica futura del policy

1. **Modifica `policy.json` qui nel repo** (versionato in git).
2. **Commit + push**: `git commit -m "tailscale(policy): <cosa>"`.
3. **Applica dal pannello admin Tailscale** (UI manuale).
4. **Verifica tutto funzioni** con i test sopra.

Il file qui è la **fonte di verità**: l'UI Tailscale ne è la copia operativa.
Discrepanze fra repo e UI = bug operativo da riconciliare subito.

## Cambio tailnet (personale → aziendale)

Vedi [`docs/playbooks/CHANGE-TAILNET.md`](../../docs/playbooks/CHANGE-TAILNET.md)
(da scrivere — playbook completo della migrazione).

In sintesi: i tag sopravvivono al cambio, il policy.json sopravvive al cambio.
Cambiano solo (a) gli account in `group:admins`, (b) il subdomain MagicDNS
(che NON è referenziato in policy.json), (c) gli IP CGNAT dei nodi (che NON
sono referenziati in policy.json), (d) le auth-key (rigenerare sulle nuove
tailnet credentials).
