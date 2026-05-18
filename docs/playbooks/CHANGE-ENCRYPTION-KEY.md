# Playbook — Rotazione `ENCRYPTION_KEY`

Procedura per cambiare la `ENCRYPTION_KEY` di un hub Domarc (DA-IPAM
o DA-Vul-can) **senza perdere accesso ai dati cifrati**.

⚠️ **Importante**: cambiare la chiave SENZA seguire questa procedura
rende illeggibili tutti i ciphertext nel DB — tipicamente:
- `tenant_agents.token_encrypted` (DA-IPAM)
- `credentials.encrypted_password` / `encrypted_username` (DA-IPAM)
- `openvas_servers.gmp_password_enc` / `ssh_password_enc` (DA-Vul-can)
- `cri_reports.password_encrypted` (DA-Vul-can)
- ogni altro ciphertext AES-GCM cifrato con la chiave corrente

---

## Quando rotare la chiave

- **Sospetto compromissione** (chiave leaked in repo, screenshot, log)
- **Off-boarding** di un dipendente che aveva accesso a `.env.local`
- **Compliance** che richiede rotazione periodica (es. ogni 12-24 mesi)
- **Migrazione** a HSM o key vault esterno (raro)

Nessuno di questi è "urgente": preparati con calma.

---

## Procedura A — Rotazione senza re-cifratura dati esistenti (semplice, sconsigliata)

Cambi la chiave, ma **rigeneri / re-inserisci a mano** tutti i ciphertext.

1. Backup del DB:
   ```bash
   cp /opt/da-invent/data/hub.db /tmp/hub.db.before-key-rotation-$(date -Iseconds)
   ```

2. Genera nuova chiave:
   ```bash
   openssl rand -hex 32
   ```

3. Aggiorna `.env.local`:
   ```bash
   sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=<new-key>/" /opt/da-invent/.env.local
   ```

4. Restart service:
   ```bash
   systemctl restart da-invent
   ```

5. **Rigenera ciphertext**:
   - Per ogni agent: UI `/agents` → riga → Configura → **Genera nuovo token**
   - Per ogni credenziale: UI Credenziali → Modifica → reinserisci password
   - Per ogni server OpenVAS: UI server → Modifica → reinserisci GMP password
   - Per ogni CRI report cifrato: UI → reinserisci password CRI

**Costo**: tempo manuale proporzionale al numero di ciphertext. Per 5
agent + 10 credential + 3 server è ~30 min. Per >50 entità diventa
inaccettabile, vai a Procedura B.

**Vantaggio**: zero rischio di rovinare dati. Se sbagli, hai sempre
il DB pre-rotazione.

---

## Procedura B — Rotazione con re-cifratura batch (richiede script)

Implementare uno script `scripts/rotate-encryption-key.ts` che:

1. Legge `OLD_ENCRYPTION_KEY` (la corrente) e `NEW_ENCRYPTION_KEY` da env
2. Per ogni colonna ciphertext (lista hardcoded delle tabelle):
   - SELECT tutti i record
   - `decrypt(old_key, ciphertext)` → plaintext
   - `encrypt(new_key, plaintext)` → new_ciphertext
   - UPDATE record SET ciphertext = new_ciphertext
3. Tutto in una **singola transazione** (rollback se anche un record fallisce)
4. Log dettagliato di quanti record sono stati ri-cifrati per tabella

Esecuzione:

```bash
cd /opt/da-invent
systemctl stop da-invent
OLD_ENCRYPTION_KEY=$(grep ENCRYPTION_KEY .env.local | cut -d= -f2) \
NEW_ENCRYPTION_KEY=$(openssl rand -hex 32) \
npx tsx scripts/rotate-encryption-key.ts

# Se il rotate ha avuto successo, aggiorna .env.local
sed -i "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=<new-key-letto-dal-log>/" .env.local

systemctl start da-invent
```

⚠️ **Questo script NON è ancora implementato**. Va creato seguendo le
liste di colonne ciphertext per ogni progetto (vedi sezioni sotto).

### Colonne ciphertext DA-IPAM (da decifrare/ri-cifrare)

- `tenant_agents.token_encrypted`
- `credentials.encrypted_password`
- `credentials.encrypted_username` (se valorizzata)
- `credentials.encrypted_private_key` (se valorizzata)
- `network_devices.snmp_credential_encrypted` (se applicabile)
- `host_credentials.password_encrypted`

### Colonne ciphertext DA-Vul-can (da decifrare/ri-cifrare)

- `openvas_servers.gmp_password_enc`
- `openvas_servers.ssh_password_enc`
- `openvas_servers.ssh_private_key_enc`
- `cri_reports.password_encrypted`
- `network_routers.snmp_community_encrypted`

---

## Procedura C — Multi-key con periodo di transizione (best practice)

Per uscire dalla logica "una sola chiave a vita", implementare:

1. **`ENCRYPTION_KEYS`** env: lista di chiavi nominate, es:
   ```
   ENCRYPTION_KEYS={"v1":"abc...","v2":"def..."}
   ENCRYPTION_KEY_CURRENT=v2
   ```

2. Ogni ciphertext memorizza il **key_id** usato per cifrare (prefix
   `v1:` o `v2:` davanti al base64 del ciphertext).

3. `decrypt(blob)` cerca il key_id, prende la chiave dalla lista,
   decifra. Tutte le chiavi storiche restano valide.

4. `encrypt(plaintext)` usa sempre `ENCRYPTION_KEY_CURRENT`.

5. **Rotazione**: aggiungi `v3`, setta `current=v3`. Job background
   ri-cifra in batch durante manutenzione. Quando tutti i record usano
   `v3`, rimuovi `v1` e `v2`.

Costo: refactor del modulo crypto (~1 giornata). Beneficio: rotazioni
future non-distruttive, conformità compliance, audit log per chiave.

**Da fare se rotazioni > 1 volta l'anno o se Domarc cresce in
compliance footprint.**

---

## Aggiornamento Keeper

Dopo ogni rotazione:

1. Sostituisci la chiave vecchia in Keeper con la nuova
2. Annota nel campo "note" della voce: `Rotated <data>, previous key
   stored in backup <yyyy-mm-dd>` (per audit/forensics se serve)
3. Conserva la chiave vecchia in una sotto-cartella `Domarc / Archive /
   <yyyy>` per 1 anno (per recovery di backup pre-rotazione)
4. Dopo 1 anno cancella la vecchia chiave dall'archivio Keeper

---

## Checklist rotazione

- [ ] Backup `hub.db` (o `vuln.db`) prima di toccare
- [ ] Nuova chiave generata con `openssl rand -hex 32`
- [ ] Procedura scelta in base al numero di ciphertext (A vs B vs C)
- [ ] Service stoppato durante rotazione (no scritture concorrenti)
- [ ] `.env.local` aggiornato con la nuova chiave
- [ ] Verifica: login UI funziona, agent test verde, credenziali leggibili
- [ ] Keeper aggiornato con nuova chiave + archivio vecchia
- [ ] Note nel changelog progetto se cambio è material
