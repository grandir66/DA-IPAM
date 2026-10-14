# NetBird a stella — Fase 0: preparazione (piano dettagliato)

> **Per gli agenti:** REQUIRED SUB-SKILL: superpowers:executing-plans (in questa fase non c'è
> codice di prodotto: si eseguono i compiti in ordine, nella sessione principale, e ci si
> ferma dove è scritto **CONFERMA**). Passi con le caselle (`- [ ]`).
>
> **Eseguito il 2026-10-14**: esito nel piano generale, «Avanzamento». La VM del Task 3 è stata
> fatta sul PX-NAS di casa (`192.168.99.1`) invece che su DA-PX-04, per scelta di Riccardo.

**Obiettivo:** sapere esattamente cosa c'è oggi, provare che Tailscale e NetBird convivono,
togliere `All` dalle policy dei colleghi e mettere in NetBird i centrali. Il tutto senza
toccare nessun cliente.

**Architettura:** solo operazioni. Il censimento è in sola lettura; le scritture su NetBird e
su da-vulcan sono poche, ognuna con fotografia prima e modo di tornare indietro.

**Spec:** [`docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md`](../specs/2026-10-14-netbird-rete-a-stella-design.md)
§6.2, §10 «Fase 0», §11 rischi 1–3. Piano generale:
[`2026-10-14-netbird-dalink-programma.md`](2026-10-14-netbird-dalink-programma.md).

## Vincoli globali

- **Nessun segreto a schermo.**
  - Il token NetBird si legge da `~/Documents/da-appliance-credentials/zabbix.env`
    (`NETBIRD_TOKEN`) dentro lo script: mai stampato, mai passato come argomento.
  - Le setup key emesse in questa fase si passano alla macchina da stdin (`| ssh host 'read -r K; …'`).
- **Verifica TLS accesa** verso `https://netbird.domarc.it`, che ha il certificato wildcard
  valido. Non si copia il `CERT_NONE` del client di DA-Zabbix.
- **`SCRATCH`** è lo scratchpad della sessione che esegue (`export SCRATCH=<percorso dello
  scratchpad>` all'inizio); script usa e getta e output stanno lì.
- **I log stanno nello scratchpad della sessione**, mai in `/tmp` con un nome fisso, e
  l'esito di un comando si legge dal suo codice di uscita.
- **Orari a Riccardo in ora italiana.**
- **Si scrive su NetBird di produzione, su da-vulcan e sul Proxmox di Domarc solo dopo le
  CONFERME**, chieste tutte insieme all'inizio dell'esecuzione (Task 0).

## Review Focus

1. **Policy dei colleghi che dipendono da `All` in modo non ovvio.** Rotte, nameserver ed
   exit node, non solo le policy: dopo lo spostamento un collega fuori sede deve
   raggiungere tutto come prima. La verifica sta nel Task 4, passo 5.
2. **Un peer che oggi sta solo in `All`** (nessun altro gruppo): dopo lo spostamento perde
   l'accesso. Il Task 4, passo 2 li elenca per nome prima di toccare.
3. **Tailscale che scarta il traffico NetBird** (spec, rischio 1): si prova nel Task 3, prima
   di toccare da-vulcan nel Task 5.
4. **Codici tenant che non sono `codcli`** (es. `70791a`): il Task 1, passo 4 li elenca.
5. **Un censimento parziale.** Un nodo Tailscale spento oggi non compare come attivo, ma va
   censito lo stesso. Il Task 1 legge anche i nodi offline, con la data dell'ultimo
   contatto.

---

### Task 0: Le conferme, tutte insieme

- [x] **Passo 1: chiedere a Riccardo, in un solo messaggio, le conferme per:**
  - **Task 3**: creare una VM di prova su `DA-PX-04`, che si cancella alla fine, e un gruppo
    NetBird `prova-convivenza` con una setup key monouso e una policy
    `admins → prova-convivenza` tcp 22, che si tolgono alla fine;
  - **Task 4**: spostare policy, rotte e nameserver da `All` a `users`/`admins`, poi
    spegnere `Default`;
  - **Task 5**: creare i gruppi `centro-vulcan`, `centro-zabbix`, `centro-link`; installare
    il client NetBird su da-vulcan accanto a Tailscale e aggiungere DA-ZABBIX al suo gruppo.
- [x] **Passo 2:** annotare nel CONTEXT di DA-IPAM (§6) cosa è confermato e cosa no. Un
  task non confermato si salta e si dice.

### Task 1: Censimento in sola lettura

**File:**
- Crea, usa e getta, nello scratchpad: `censimento_netbird.py`
- Modifica: la spec, appendice nuova «A. Censimento fase 0 (data)»

- [x] **Passo 1: Tailscale, una sola chiamata.**

```bash
ssh -o ConnectTimeout=10 domarc@da-vulcan 'tailscale status --json' > "$SCRATCH/ts.json"; echo "exit=$?"
python3 - "$SCRATCH/ts.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
righe = [d["Self"]] + list(d.get("Peer", {}).values())
for p in sorted(righe, key=lambda p: p.get("HostName", "")):
    print(f'{p.get("HostName",""):30} {",".join(p.get("Tags") or []):25} '
          f'{p.get("OS",""):8} online={p.get("Online")} ultimo={p.get("LastSeen","")[:16]} '
          f'ip={(p.get("TailscaleIPs") or [""])[0]}')
EOF
```

Atteso: `exit=0` e una riga per nodo, compresi quelli offline. Se `exit=255` è ssh, non
Tailscale: si prova `ssh domarc@192.168.4.6` una volta, poi ci si ferma e si chiede (REGOLA #0).

- [x] **Passo 2: NetBird, script in sola lettura.**

```python
# censimento_netbird.py — sola lettura, usa e getta (fase 0). Non stampa segreti.
import json, os, ssl, urllib.request

URL = "https://netbird.domarc.it"
ENV = os.path.expanduser("~/Documents/da-appliance-credentials/zabbix.env")

def token():
    for riga in open(ENV):
        if riga.startswith("NETBIRD_TOKEN="):
            return riga.split("=", 1)[1].strip()
    raise SystemExit("NETBIRD_TOKEN assente nel vault: mi fermo")

CTX = ssl.create_default_context()          # verifica TLS ACCESA
TOK = token()

def get(percorso):
    req = urllib.request.Request(URL + percorso, headers={"Authorization": f"Token {TOK}"})
    with urllib.request.urlopen(req, context=CTX, timeout=20) as r:
        return json.load(r)

def nomi(gruppi):
    return sorted((g["name"] if isinstance(g, dict) else g) for g in (gruppi or []))

gruppi = get("/api/groups")
id2nome = {g["id"]: g["name"] for g in gruppi}
def n(gs): return sorted(id2nome.get(g, g) if isinstance(g, str) else g.get("name") for g in (gs or []))

print("== GRUPPI");  [print(f'  {g["name"]:28} peer={g.get("peers_count", len(g.get("peers") or []))}') for g in gruppi]
print("== POLICY")
for p in get("/api/policies"):
    for r in p.get("rules", []):
        print(f'  [{"ON " if p.get("enabled") else "off"}] {p["name"]:28} {n(r.get("sources"))} -> '
              f'{n(r.get("destinations"))} {r.get("protocol")} {r.get("ports") or "tutte"} '
              f'bidir={r.get("bidirectional")}')
print("== ROTTE")
for r in get("/api/routes"):
    print(f'  {r.get("network_id") or r.get("network")}: {r.get("network")} '
          f'distribuita a {n(r.get("groups"))} enabled={r.get("enabled")}')
print("== NAMESERVER")
for ns in get("/api/dns/nameservers"):
    print(f'  {ns.get("name")}: a {n(ns.get("groups"))} enabled={ns.get("enabled")}')
print("== PEER")
peer = get("/api/peers")
for p in sorted(peer, key=lambda p: p.get("name", "")):
    print(f'  {p.get("name",""):30} {nomi(p.get("groups")) } connesso={p.get("connected")} '
          f'ultimo={str(p.get("last_seen",""))[:16]} ver={p.get("version")}')
print("== SOLO IN All (perderebbero l'accesso dopo il Task 4)")
for p in peer:
    if nomi(p.get("groups")) == ["All"]:
        print("  ", p.get("name"))
print("== SETUP KEY (solo nomi e stato, mai il valore)")
for k in get("/api/setup-keys"):
    print(f'  {k.get("name"):28} valida={k.get("valid")} usi={k.get("used_times")} gruppi={nomi(k.get("auto_groups"))}')
```

Esecuzione:
```bash
python3 -I "$SCRATCH/censimento_netbird.py" > "$SCRATCH/netbird.txt"; echo "exit=$?"; wc -l "$SCRATCH/netbird.txt"
```
Atteso: `exit=0`. Prima di mettere l'output in contesto si controlla che non contenga
stringhe lunghe simili a chiavi: `grep -E '[A-Za-z0-9]{32,}' "$SCRATCH/netbird.txt" | wc -l` → `0`.

- [x] **Passo 3: edge noti all'hub e tenant di DA-IPAM, una chiamata per macchina.**

```bash
ssh domarc@da-vulcan "sqlite3 -readonly ~/da-vul-can/data/vuln.db \"SELECT id,label,codcli,public_hostname,scanner_edge_version,substr(last_seen_at,1,16),state FROM edge_bridges ORDER BY codcli;\"" > "$SCRATCH/edge.txt"; echo "exit=$?"
ssh root@192.168.4.8 "sqlite3 -readonly /opt/da-invent/data/hub.db \"SELECT codice_cliente, ragione_sociale FROM tenants ORDER BY codice_cliente;\"" > "$SCRATCH/tenant-hub.txt"; echo "exit=$?"
ssh root@172.16.0.2 "sqlite3 -readonly /opt/da-ipam/data/hub.db \"SELECT codice_cliente, ragione_sociale FROM tenants;\"" > "$SCRATCH/tenant-dts.txt"; echo "exit=$?"
```
Se `sqlite3` manca su una macchina, lo si dice e si legge con `python3 -c` (sqlite3 della
libreria standard): niente installazioni.

- [x] **Passo 4: confronto dei codici.** Per ogni `codice_cliente` dei tenant e ogni `codcli`
  degli edge si controlla la ragione sociale sulla scheda del CRM (`crm.domarc.it`, ricerca
  per codice). Si elencano **per nome** i codici che non corrispondono a un `codcli` (atteso
  almeno `70791a`) e i `DEFAULT`.

- [x] **Passo 5: porte reali.** Per ogni edge attivo, la porta dell'interfaccia (6443 o
  8443) dalla colonna `public_hostname` o dalla configurazione del ponte in da-vulcan. Si
  chiudono le porte «da misurare» rimaste nella spec (§4.2) e si scrivono nella tabella P.

- [x] **Passo 6: l'appendice della spec.** Si aggiunge in fondo alla spec «Appendice A —
  Censimento fase 0 (AAAA-MM-GG, fonti)»:
  - tabella dei nodi Tailscale (nome, tipo di oggetto dedotto, cliente, online, ultimo
    contatto);
  - policy, rotte e nameserver NetBird con `All`;
  - peer solo in `All`;
  - codici da correggere;
  - porte misurate.

  **Nessun IP pubblico di clienti, nessun segreto.**

- [x] **Passo 7: commit** (solo documentazione, su `dev` da un worktree di `origin/dev`):
```bash
git add docs/superpowers/specs/2026-10-14-netbird-rete-a-stella-design.md
git commit -m "docs(netbird): censimento fase 0 — Tailscale, NetBird, edge, tenant"
```

### Task 2: Decisioni con Riccardo sul censimento

- [x] **Passo 1: un solo messaggio a Riccardo con:**
  - **il nome stabile di da-vulcan**: `da-vulcan.netbird.selfhosted` oppure un nome nel DNS
    interno (spec, rischio 3), con il numero di riferimenti da cambiare
    (`grep -rIl --exclude-dir={node_modules,.git,.next,.venv} -w da-vulcan ~/Progetti | wc -l`);
  - **l'ordine dei clienti per la fase 3**, dalla tabella del Task 1;
  - **l'agente Python remoto di DA-IPAM**: quanti `tenant-agents` esistono davvero; se zero,
    proposta di toglierlo nella tappa C1;
  - **i codici da correggere** del Task 1, passo 4.
- [x] **Passo 2:** le risposte nella spec, §2 (decisioni nuove numerate) e §15 (voci chiuse).
  Commit come nel Task 1, passo 7.

### Task 3: Prova di convivenza Tailscale + NetBird (**CONFERMA**)

Risponde al rischio 1 della spec: con Tailscale acceso, il traffico NetBird passa?

- [x] **Passo 1: VM di prova** su `DA-PX-04` (`192.168.40.4`): Ubuntu 24.04 da template,
  nome `prova-convivenza`. Tailscale installato e collegato alla tailnet attuale con un
  login interattivo che fa Riccardo. Niente auth-key in chiaro.
- [x] **Passo 2: NetBird.**
  - Con lo script del Task 1, esteso con una sola funzione di scrittura, si creano il gruppo
    `prova-convivenza`, una setup key monouso valida 1 giorno con quel gruppo, e la policy
    `admins → prova-convivenza` tcp 22.
  - Lo script, nello scratchpad, stampa **solo** la chiave su stdout, che va dritta alla VM.
    `<vm>` è l'IP LAN della VM creata al passo 1:

```python
# emetti.py — usa e getta (fase 0): gruppo, chiave monouso e policy per la prova.
import json, os, ssl, sys, urllib.request
URL = "https://netbird.domarc.it"
ENV = os.path.expanduser("~/Documents/da-appliance-credentials/zabbix.env")
TOK = next(r.split("=", 1)[1].strip() for r in open(ENV) if r.startswith("NETBIRD_TOKEN="))
CTX = ssl.create_default_context()          # verifica TLS ACCESA

def chiama(metodo, percorso, corpo=None):
    dati = json.dumps(corpo).encode() if corpo is not None else None
    req = urllib.request.Request(URL + percorso, data=dati, method=metodo, headers={
        "Authorization": f"Token {TOK}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, context=CTX, timeout=20) as r:
        return json.load(r)

gruppi = {g["name"]: g["id"] for g in chiama("GET", "/api/groups")}
gid = gruppi.get("prova-convivenza") or chiama("POST", "/api/groups", {"name": "prova-convivenza"})["id"]
chiama("POST", "/api/policies", {"name": "prova-convivenza-ssh", "enabled": True, "rules": [{
    "name": "admins-ssh", "enabled": True, "action": "accept", "bidirectional": False,
    "protocol": "tcp", "ports": ["22"], "sources": [gruppi["admins"]], "destinations": [gid]}]})
k = chiama("POST", "/api/setup-keys", {"name": "prova-convivenza", "type": "one-off",
    "expires_in": 86400, "auto_groups": [gid], "usage_limit": 1, "ephemeral": False})
print("creati gruppo, policy e chiave 'prova-convivenza'", file=sys.stderr)
print(k["key"])                              # solo su stdout, verso ssh
```

```bash
python3 -I "$SCRATCH/emetti.py" | ssh root@<vm> 'read -r K; netbird up --management-url https://netbird.domarc.it --setup-key "$K" --hostname prova-convivenza'; echo "exit=$?"
```
  Atteso: `exit=0` e, sulla VM, `netbird status` con `Management: Connected`.
- [x] **Passo 3: misura, in un solo comando sulla VM.**
```bash
ssh root@<vm> 'iptables -S | grep -E "ts-input|100.64" ; ip rule ; ip route show table all | grep -E "wt0|tailscale0" | head; netbird status | head -20; tailscale status | head -5'
```
  e dal Mac di un admin collegato a NetBird: `ssh -o ConnectTimeout=5 root@prova-convivenza.netbird.selfhosted true; echo exit=$?`.
- [x] **Passo 4: esito.**
  - Se `exit=0`, la convivenza regge: si annota e si va avanti.
  - Se fallisce, una sola prova del rimedio `tailscale set --netfilter-mode=off` e si
    ripete il passo 3.
  - Se fallisce ancora, ci si ferma e si porta a Riccardo la seconda via: una fascia NetBird
    diversa, impostazione dell'account, che è una scrittura sul NetBird di tutti.
- [x] **Passo 5: pulizia.** Cancellati il peer, la chiave se non usata, la policy, il gruppo
  e la VM. Lo script di censimento rilanciato non deve più mostrare `prova-convivenza`.
- [x] **Passo 6:** l'esito e il rimedio scelto nella spec (§11, rischio 1, «misurato il …»).
  Commit.

### Task 4: `All` fuori dalle policy dei colleghi, poi `Default` spenta (**CONFERMA**)

- [x] **Passo 1: fotografia.** Export JSON completo di gruppi, policy, rotte e nameserver,
  scritto con `chmod 600` nel vault:
  `~/Documents/da-appliance-credentials/netbird-fotografia-AAAAMMGG-HHMM.json`.
  Si verifica che il file si rilegga (`python3 -c 'import json;json.load(open(...))'`).
- [x] **Passo 2: prova a vuoto.** Lo script stampa, per nome, ogni policy, rotta e
  nameserver che usa `All`, e cosa diventerebbe (`users`, `admins` o entrambi, secondo la
  tabella di DA-Infra `docs/servizi/netbird.md`). Stampa anche i peer solo in `All` e cosa
  succederebbe loro. **Riccardo legge i nomi e dice sì.**
- [x] **Passo 3: `users` gruppo automatico di ogni persona**, con `assegna_gruppo_automatico`
  del client DA-Zabbix, solo per gli utenti senza gruppi. Poi si verifica che ogni persona
  abbia `users`.
- [x] **Passo 4: applicare** le sostituzioni del passo 2, una per una, e rileggere dopo ognuna.
- [ ] **Passo 5: verifica dal di fuori**, fatta da Riccardo dal telefono in hotspot o da un
  collega fuori sede:
  - Manager e INTEGRA si aprono;
  - RDP verso RDH funziona;
  - `dig +short manager.domarc.it` risponde `192.168.4.42`;
  - un servizio in DMZ si apre;
  - l'exit node c'è per chi lo usava.
- [x] **Passo 6: spegnere `Default`** con `spegni_regola_aperta()`, e ripetere la verifica
  del passo 5.
- [x] **Passo 7: indietro, se qualcosa non va.** Si rimettono policy, rotte e nameserver
  dalla fotografia del passo 1, voce per voce, e si riaccende `Default`.
- [x] **Passo 8:** in DA-Infra `docs/servizi/netbird.md` la regola «`All` mai in policy,
  rotte e nameserver», con la data. Commit in DA-Infra.

### Task 5: I centrali in NetBird, senza lasciare Tailscale (**CONFERMA**)

- [x] **Passo 1:** gruppi `centro-vulcan`, `centro-zabbix`, `centro-link`, vuoti. Nessuna
  policy nuova: le scriverà DA-Link (tappa A), che ne è il proprietario.
- [x] **Passo 2: DA-ZABBIX.** Dal censimento: se è già un peer (lo usano i proxy), lo si
  aggiunge a `centro-zabbix` con `metti_nel_gruppo`. P4 e P4b di DA-Zabbix restano come sono.
- [x] **Passo 3: da-vulcan.**
  - Client NetBird installato da repo ufficiale; setup key monouso con gruppo
    `centro-vulcan`, passata da stdin.
  - **Tailscale resta acceso.**
  - Prima e dopo, in un solo comando:
    `systemctl is-active da-vul-can; curl -sk -o /dev/null -w "%{http_code}" https://localhost/api/health`.
  - Dopo, in più: `netbird status | head`.
  - Atteso: servizio attivo e 200 sia prima sia dopo.
- [x] **Passo 4: gli edge non cambiano niente.** Si controlla in `edge_bridges` che
  `last_seen_at` continui ad avanzare nell'ora successiva.
- [x] **Passo 5:** lo script di censimento rilanciato mostra i due centrali nei gruppi giusti.
  R1–R4 a mano:
  - nessuna policy fra remoti;
  - `Default` spenta;
  - nessun `All`;
  - nessuna rotta da remoti.

### Task 6: YubiKey (Riccardo)

- [ ] **Passo 1:** ordinare **due YubiKey 5 con firmware 5.7 o superiore**. Serve per avere
  chiavi Ed25519 dentro la chiavetta (PIV), per la chiave di emergenza e le radici; con un
  firmware più vecchio si ripiegherebbe su P-256, e si annota.
- [ ] **Passo 2:** la cerimonia **non** si fa qui: si fa nella tappa B, quando ci sono gli
  strumenti (`step-ca`, `age-plugin-yubikey`) e la procedura scritta.

### Uscita dalla fase 0

- [ ] I centrali sono connessi in NetBird nei loro gruppi; R1–R4 verdi a mano; i colleghi
  raggiungono ciò che raggiungevano prima (Task 4, passo 5, fatto due volte).
- [x] La spec ha l'appendice A, il rischio 1 misurato e le decisioni del Task 2.
- [x] Nel piano generale, «Avanzamento»: una riga con data e cosa è fatto. CONTEXT di DA-IPAM
  aggiornato.
