# Playbook — Disaster Recovery Domarc

Procedure di ripristino per 3 scenari di disastro su DA-IPAM + DA-Vul-can.
Da rivedere e testare ogni 6 mesi.

**RTO target**: ~2 ore per scenario A, ~4 ore per scenario B+C.
**RPO**: nightly = 24h max di dati persi tra il backup e il guasto.

---

## Scenario A — VM hub brucia / disco corrotto

### Sintomo
- Hub non risponde
- SSH timeout o "unable to mount root fs"
- `qm list` su Proxmox mostra VM in stato error o stopped

### Procedura

1. **Verifica backup disponibili** (sul nodo Proxmox o su NAS Domarc):
   ```bash
   ls -lt /var/backups/da-invent/      # backup nightly hub.db + tenants/
   ls -lt /var/lib/vz/dump/             # vzdump completi VM
   ```

2. **Nuova VM da template Ubuntu 24.04**:
   ```bash
   qm clone <ubuntu-template-vmid> <new-vmid> --name da-invent-restore
   qm set <new-vmid> --memory 8192 --cores 4
   qm start <new-vmid>
   ```

3. **Bootstrap hub** seguendo [DEPLOY-NEW-HUB.md](DEPLOY-NEW-HUB.md)
   fino allo step 5 (npm ci + build, prima del start systemd).

4. **Restore DB**:
   ```bash
   # Sul nuovo hub
   systemctl stop da-invent 2>/dev/null
   
   # Recupera ultimo backup
   LATEST=$(ls -t /var/backups/da-invent/ | head -1)
   cp /var/backups/da-invent/$LATEST/hub.db.gz /opt/da-invent/data/
   cd /opt/da-invent/data
   gunzip hub.db.gz
   
   # Restore tenant DBs
   mkdir -p tenants
   for t in /var/backups/da-invent/$LATEST/tenants/*.db.gz; do
     cp "$t" tenants/
     gunzip "tenants/$(basename "$t")"
   done
   
   chown -R da-invent:da-invent /opt/da-invent/data
   ```

5. **Restore .env.local** (da Keeper):
   ```bash
   # Recupera ENCRYPTION_KEY, AUTH_SECRET, DOMARC_PASSWORD da Keeper
   # categoria "Domarc / Servers / da-invent"
   nano /opt/da-invent/.env.local
   ```

   ⚠️ **CRITICO**: la `ENCRYPTION_KEY` DEVE essere identica a quella
   del DB che stai ripristinando. Se cambi chiave, tutti i token agent
   cifrati in `tenant_agents.token_encrypted` diventano `decrypt_failed`
   e dovrai rigenerarli a mano dalla UI.

6. **Start service + verifica**:
   ```bash
   systemctl start da-invent
   sleep 5
   curl http://localhost:3001/api/version
   ```

7. **Re-join Tailscale**:
   ```bash
   tailscale up --reset \
     --authkey=<reusable-key> \
     --advertise-tags=tag:da-hub \
     --hostname=da-invent \
     --ssh
   ```
   ⚠️ Sul vecchio admin Tailscale, **rimuovi** il nodo "morto"
   altrimenti i bridge potrebbero ancora puntargli (cache MagicDNS).

8. **Verifica E2E**:
   - `https://da-invent` login funziona
   - `/agents` mostra agent ancora visibili (last_seen sarà vecchio finché
     non li ritesti)
   - "Testa tutti" → tutti verde (gli agent sui bridge continuano a girare)

### Note

- I bridge clienti NON sono toccati da questo scenario.
- I dati persi sono solo quelli tra l'ultimo backup nightly e il guasto.
- Tempo totale: ~90 min.

---

## Scenario B — Account Tailscale compromesso / da revocare

### Sintomo
- Tailscale admin email/password leak sospetto
- Pulsante "panic" Tailscale: tutti i device disconnessi
- Necessità di rotazione completa identità tailnet

### Procedura

1. **Cambia password admin Tailscale** IMMEDIATAMENTE da
   <https://login.tailscale.com/admin/personal-settings>.

2. **Revoca tutte le auth-key esistenti**:
   <https://login.tailscale.com/admin/settings/keys> → Delete su ognuna.

3. **Revoca i nodi compromessi** (se identificabili):
   <https://login.tailscale.com/admin/machines> → Remove per ogni
   nodo sospetto.

4. **Se necessario rotazione completa**: segui
   [CHANGE-TAILNET.md](CHANGE-TAILNET.md) — è la procedura di migrazione
   verso un NUOVO tailnet, equivalente al "ripartire da zero" su quello
   esistente.

5. **Genera nuove auth-key** taggate per ogni ruolo
   (`tag:da-hub`, `tag:da-bridge`, `tag:da-admin`).

6. **Re-up tutti i nodi** con le nuove auth-key (vedi
   [infra/tailscale/README.md](../../infra/tailscale/README.md)).

7. **Salva le nuove credenziali in Keeper**.

### Note

- I token agent **non** vengono compromessi (sono ortogonali a Tailscale).
- I DB sui server **non** vanno ripristinati.
- Tempo totale: ~2-3 ore per cluster con 5-10 nodi.

---

## Scenario C — hub.db corrotto / DB rotto / migration fallita

### Sintomo
- Hub avvia ma `/api/health` ritorna 500
- Log: `SQLITE_CORRUPT: database disk image is malformed`
- Oppure: `applyMigrations` fallisce su uno specifico ALTER TABLE

### Procedura

#### Se solo hub.db è corrotto

1. **Stop hub**:
   ```bash
   ssh -J root@192.168.40.4 root@192.168.4.8 \
     "systemctl stop da-invent"
   ```

2. **Backup del DB corrotto** (per analisi forense):
   ```bash
   cp /opt/da-invent/data/hub.db /tmp/hub.db.corrupted-$(date -Iseconds)
   ```

3. **Tenta riparazione SQLite** (best-effort):
   ```bash
   cd /opt/da-invent/data
   sqlite3 hub.db ".recover" > hub.db.recovered.sql
   mv hub.db hub.db.broken
   sqlite3 hub.db.new < hub.db.recovered.sql
   mv hub.db.new hub.db
   chown da-invent:da-invent hub.db
   ```

4. **Se .recover fallisce**: restore da backup nightly
   (vedi Scenario A step 4).

#### Se un tenant DB è corrotto (singolo cliente)

1. Stop hub
2. Mv `tenant.db` corrotto
3. Restore solo quel tenant da backup:
   ```bash
   cd /opt/da-invent/data/tenants
   cp /var/backups/da-invent/$LATEST/tenants/<codice>.db.gz .
   gunzip <codice>.db.gz
   chown da-invent:da-invent <codice>.db
   ```
4. Restart hub.

### Note

- DA-Vul-can ha un solo DB (`vuln.db`). Procedura identica al
  Scenario C "hub.db corrotto" applicata a quel file.

---

## Backup nightly — come verificare che funzioni

Sul hub (DA-IPAM o DA-Vul-can):

```bash
# Ultimo backup esistente
ls -lh /var/backups/da-invent/$(date +%F)/

# Test di restore (NON destructive, scrive in /tmp):
LATEST=$(ls -t /var/backups/da-invent/ | head -1)
gunzip -c /var/backups/da-invent/$LATEST/hub.db.gz > /tmp/hub.db.test
sqlite3 /tmp/hub.db.test "SELECT count(*) FROM users; SELECT count(*) FROM tenants;"
rm /tmp/hub.db.test
```

Test mensile minimo: ottieni un counter sensato (non 0, non errore).

---

## Backup off-site weekly

Una volta a settimana, copia i backup nightly su un secondo sito:

```bash
# Da NAS Domarc o da una VM dedicata:
rsync -az --delete \
  root@192.168.4.8:/var/backups/da-invent/ \
  /mnt/nas-domarc/backups/da-invent/

# O via S3:
aws s3 sync /var/backups/da-invent/ s3://domarc-backups-da-invent/ \
  --storage-class STANDARD_IA
```

Test annuale: ripristina un backup off-site su VM lab e verifica
funzionamento E2E.

---

## Test DR (ogni 6 mesi)

Esecuzione consigliata: ogni gennaio + luglio.

1. Clona VM hub di produzione su VM lab (Proxmox `qm clone`)
2. Spegni la VM lab
3. Su una VM Ubuntu pulita, esegui Scenario A end-to-end usando
   l'ultimo backup nightly
4. Verifica: UI accessibile, agent test verde, scansione test riuscita
5. Documenta il tempo impiegato + eventuali sorprese
6. Aggiorna questo playbook se serve

---

## Checklist precauzioni continuative

- [ ] Backup nightly attivo e visibile in `/var/backups/da-invent/` (Cron Sun nightly 3am)
- [ ] Backup off-site weekly attivo su NAS o S3
- [ ] Test mensile rapido (ls + sqlite3 count) — calendario operatore
- [ ] Test DR semestrale completo — calendario operatore
- [ ] ENCRYPTION_KEY, AUTH_SECRET, DOMARC_PASSWORD salvati in Keeper
- [ ] Tailscale auth-key correnti salvate in Keeper
- [ ] Procedure Tailscale e DB documentate qui — sempre aggiornare se cambia infrastruttura
