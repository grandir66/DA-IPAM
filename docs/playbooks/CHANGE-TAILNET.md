# Playbook — Cambio tailnet Tailscale (personale → aziendale o equivalente)

Migrazione di tutta l'infrastruttura Domarc (hub DA-IPAM, hub DA-Vul-can,
bridge VM clienti, workstation operatori) da un tailnet a un altro **senza
re-installazione** dei sistemi.

**Tempo stimato**: 45-90 minuti per ~5-10 nodi, principalmente attesa.
**Downtime atteso**: 5-15 minuti per nodo durante la re-registrazione.
**Rollback**: i nodi del vecchio tailnet restano registrati finché non si fa
`tailscale logout` esplicito, quindi cambio retro-compatibile finché l'admin
non rimuove i nodi dal vecchio tailnet.

---

## Pre-flight — cosa preparare prima

1. **Accesso admin** al **nuovo** tailnet (es. console
   <https://login.tailscale.com> con account `@domarc.it`).
2. **Accesso SSH** (via tailnet **vecchio** o via IP LAN se applicabile) a:
   - Hub DA-IPAM (es. `ssh -J root@192.168.40.4 root@192.168.4.8`)
   - Hub DA-Vul-can (TBD)
   - Ogni bridge VM cliente (via tailnet vecchio: `ssh root@bridge-<cliente>`)
3. **Backup** di `data/hub.db`, `data/vuln.db`, `data/tenants/*.db` (rsync su
   storage locale Mac). Anche se la migrazione è non-distruttiva sul DB, in
   caso di necessità di rollback è la fonte di verità.
4. **Lista nodi** da migrare. Estrai dal vecchio admin Tailscale:
   `https://login.tailscale.com/admin/machines` → screenshot o copy.
5. **Verifica che il policy `infra/tailscale/policy.json` sia aggiornato** nel
   repo DA-IPAM. È la fonte canonica delle ACL; lo applicherai sul nuovo
   tailnet identico.
6. **Auth-key reusable** sul **nuovo** tailnet, taggata coerentemente:
   - Una per `tag:da-hub` (riusabile, scadenza 90gg)
   - Una per `tag:da-bridge` (riusabile, scadenza 90gg)
   - Una per `tag:da-admin` (one-shot, per workstation operatori)
   Generale da: <https://login.tailscale.com/admin/settings/keys>

---

## Sequenza

### Fase 1 — Setup del nuovo tailnet (~10 min)

1. Login al pannello admin del **nuovo** tailnet.
2. **Importa la policy** ACL:
   - Vai a <https://login.tailscale.com/admin/acls>
   - Sostituisci interamente con il contenuto di
     [`infra/tailscale/policy.json`](../../infra/tailscale/policy.json)
   - Aggiorna `groups.group:admins` con gli account del nuovo tailnet
     (es. account aziendali `@domarc.it`)
   - **Save**. Tailscale esegue i test ACL inline e rifiuta deploy se uno
     fallisce.
3. **Genera le auth-key**:
   - Settings → Keys → Generate auth key
   - Per ognuna (hub, bridge, admin): reusable=yes, ephemeral=no, expiry=90
     days, tag=tag:da-hub / tag:da-bridge / tag:da-admin
   - Salva i 3 valori in Keeper (cartella "Domarc / Tailscale / new-tailnet").
4. **Abilita MagicDNS** (Settings → DNS → MagicDNS = ON).
5. **Decidi i nuovi nomi hostname** Tailscale (es. `da-invent`,
   `da-vulcan`, `bridge-<codcliente>`). Se i nomi precedenti erano già
   sensati, riusali — i tag e ACL sono indipendenti dai nomi.

### Fase 2 — Migrazione hub (DA-IPAM + DA-Vul-can) (~15 min)

Per ogni hub VM (DA-IPAM su 192.168.4.8, DA-Vul-can su <TBD>):

```bash
# 1. SSH all'hub (via tailnet vecchio o via LAN)
ssh -J root@192.168.40.4 root@192.168.4.8

# 2. Logout dal vecchio tailnet
sudo tailscale down
sudo tailscale logout

# 3. Pulizia state (NON obbligatorio ma raccomandato, evita machine-key vecchia)
sudo systemctl stop tailscaled
sudo rm -rf /var/lib/tailscale/*
sudo systemctl start tailscaled

# 4. Join al NUOVO tailnet con auth-key tag:da-hub
sudo tailscale up --reset \
  --authkey=tskey-auth-NEW_KEY_HERE \
  --advertise-tags=tag:da-hub \
  --hostname=da-invent \
  --ssh \
  --accept-dns=true

# 5. Verifica
sudo tailscale status
sudo tailscale ip -4
```

### Fase 3 — Migrazione bridge VM clienti (~10 min per bridge)

⚠️ **Importante**: durante questa fase, l'hub NON può raggiungere il bridge
in corso di migrazione, quindi le scansioni schedulate falliscono per
quei minuti. Programma in finestra a basso traffico.

Per ogni bridge VM cliente:

```bash
# 1. SSH al bridge (via tailnet vecchio finché c'è)
ssh root@bridge-<cliente>

# 2. Stop temporaneo dei servizi che usano Tailscale (per cleanup pulito)
sudo systemctl stop da-invent-agent       # se installato
sudo systemctl stop greenbone.service     # se applicabile

# 3. Logout + cleanup
sudo tailscale down
sudo tailscale logout
sudo systemctl stop tailscaled
sudo rm -rf /var/lib/tailscale/*
sudo systemctl start tailscaled

# 4. Join al NUOVO tailnet con auth-key tag:da-bridge
sudo tailscale up --reset \
  --authkey=tskey-auth-NEW_KEY_BRIDGE \
  --advertise-tags=tag:da-bridge \
  --hostname=bridge-<cliente> \
  --ssh \
  --accept-dns=true \
  --advertise-routes=<subnet-cliente>/24    # se applicabile

# 5. Restart servizi
sudo systemctl start da-invent-agent
sudo systemctl start greenbone.service

# 6. Verifica connettività verso hub
curl -fsS https://da-invent              # nuovo MagicDNS hostname dell'hub
```

### Fase 4 — Aggiornamento configurazione hub-side (~5 min)

L'hub DA-IPAM ha **due punti** che potrebbero contenere riferimenti al
vecchio tailnet:

1. **Setting `public_hub_url` / `hub_tailnet_hostname`** (vedi `/settings`):
   - Se `public_hub_url` era `https://da-invent.<old-tailnet>.ts.net`, va
     aggiornato.
   - **Meglio ancora**: lascia `public_hub_url` vuoto e setta solo
     `hub_tailnet_hostname=da-invent` (short MagicDNS). Sopravvive a
     cambi futuri del subdomain `*.ts.net`.

2. **`tenant_agents.hostname`** — i bridge registrati in `tenant_agents`:
   - Il MagicDNS short (es. `bridge-domarc-ovh`) sopravvive al cambio tailnet
     IF il nodo viene re-registrato con lo stesso `--hostname=`.
   - Se i nomi cambiano, aggiorna i record:
     ```sql
     UPDATE tenant_agents SET hostname = 'bridge-domarc-ovh' WHERE id = N;
     ```
   - Da UI: `/agents` → "Configura" → modifica hostname.

3. **Token agent**: i token bearer sono **indipendenti** dal trasporto
   Tailscale. NON serve rigenerarli. L'hub li ha cifrati in
   `tenant_agents.token_encrypted` e li userà al primo `Test` post-migrazione.

### Fase 5 — Migrazione workstation operatori (~5 min ognuna)

Su ogni Mac/Linux operatore:

```bash
# 1. Logout dal vecchio
tailscale down
tailscale logout

# 2. Reset state (opzionale, raccomandato)
sudo rm -rf /Library/Tailscale/state    # macOS
# OR
sudo rm -rf /var/lib/tailscale/*        # Linux

# 3. Re-login al nuovo (auth-key tag:da-admin o login interattivo browser)
tailscale up --reset --advertise-tags=tag:da-admin

# 4. Verifica
tailscale status
```

### Fase 6 — Verifica end-to-end (~10 min)

1. **Hub UI raggiungibile dal Mac**:
   `https://da-invent` (browser) → login funzionante.
2. **Bridge agent raggiungibile dall'hub**:
   In `/agents`, bottone "Testa tutti" → tutti gli agent devono mostrare
   "online · Xms".
3. **Scansione end-to-end**:
   Trigger manuale di una scan da `/scans` → verifica risultati corretti.
4. **Bridge ↔ Bridge bloccato** (sicurezza ACL):
   SSH al bridge A, prova `curl http://bridge-B:8443/healthz` → deve
   fallire (connection refused o timeout).

### Fase 7 — Decommissioning vecchio tailnet (dopo 1 settimana di stabilità)

Mantieni il vecchio tailnet attivo per **1 settimana** come rollback safety.
Poi:

1. Sul **vecchio** admin Tailscale: rimuovi tutti i nodi (Settings →
   Machines → Remove).
2. Revoca tutte le auth-key del vecchio tailnet.
3. Cancella i file di backup `data/*.db` se non più necessari.
4. Aggiorna in Keeper: cartella "Domarc / Tailscale / OLD-tailnet"
   marcata come `decommissioned <data>`.

---

## Troubleshooting

### Sintomo: `tailscale up` resta in attesa di approval su nuovo tailnet

L'auth-key non è autenticata come `pre-approved`, oppure il tag
non è in `autoApprovers`. Soluzione:
- Genera l'auth-key con `--pre-authorized` (CLI) o flag "Pre-approve" nell'UI.
- Verifica che `tag:da-bridge` (o tag del nodo) sia in `autoApprovers.routes`
  del policy se advertise-routes.

### Sintomo: hub vede l'agent ma il test `/whoami` ritorna 401 o decrypt_failed

- **401 auth_invalid**: il token è valido ma la copia hub è disallineata
  (es. ENCRYPTION_KEY cambiata). Rigenera il token dalla UI `/agents` →
  Configura → "Genera nuovo token", e ri-deploya l'agent con la nuova
  one-liner (o aggiorna `/etc/da-invent-agent/config.yml` manualmente).
- **decrypt_failed**: idem.

### Sintomo: bridge A può raggiungere bridge B

Bug ACL. Verifica nel pannello admin Tailscale che il policy applicato sia
identico a `infra/tailscale/policy.json` del repo. Test esegue:

```text
{
  "src":    "tag:da-bridge",
  "deny":   ["tag:da-bridge:8443"]
}
```

### Sintomo: scansioni schedulate non partono

Il cron in `server.ts` (hub) tenta di chiamare l'agent al vecchio hostname
o IP CGNAT in cache da Next.js. Restart il servizio:

```bash
sudo systemctl restart da-invent
```

Su DA-Vul-can: equivalente.

### Sintomo: MagicDNS non risolve `da-invent`

`tailscale up` senza `--accept-dns=true` salta MagicDNS. Re-up:

```bash
sudo tailscale up --reset --accept-dns=true \
  --advertise-tags=tag:da-hub ...   # stessi flag di prima + accept-dns
```

---

## Checklist finale

- [ ] Policy applicata sul nuovo tailnet, test ACL passano
- [ ] 3 auth-key generate e salvate in Keeper
- [ ] Hub DA-IPAM joinato al nuovo tailnet, hostname `da-invent`, tag `da-hub`
- [ ] Hub DA-Vul-can joinato al nuovo tailnet
- [ ] Tutti i bridge cliente joinati al nuovo tailnet, tag `da-bridge`
- [ ] Workstation operatori joinato, tag `da-admin`
- [ ] Setting `hub_tailnet_hostname` aggiornato in `/settings`
- [ ] `tenant_agents.hostname` aggiornato se i nomi sono cambiati
- [ ] Test E2E: hub → bridge → scansione → bridge → hub
- [ ] Test sicurezza: bridge A → bridge B bloccato
- [ ] Vecchio tailnet attivo per 1 settimana come safety net
- [ ] Dopo 1 settimana: decommissioning vecchio tailnet
