# Preparare il dominio per DA-IPAM

Cosa serve in Active Directory perché DA-IPAM legga utenti, eventi dei DC e DHCP, e scansioni PC e
server: uno script che fa tutto (`Prepara-Dominio-DA-IPAM.ps1`) e gli stessi passi da fare a mano.
I diritti sono quelli della pagina **Active Directory → Cosa serve** di DA-IPAM (fonte unica:
`src/lib/credentials/diritti.ts`).

## Le regole

- **Due account separati.** `svc-ipam-dc` legge AD, gli eventi dei DC e il DHCP, ed è un utente di
  dominio normale. `svc-ipam` scansiona PC e server ed è amministratore locale solo lì. Chi legge
  gli eventi non deve poter amministrare i computer.
- **Mai Domain Admins.** Nessuna funzione di DA-IPAM lo richiede. Lo script si ferma se uno dei due
  account ci si trova.
- **Sui DC niente Administrators.** Bastano i gruppi non amministrativi elencati sotto.

## Con lo script

**Dove**: su un domain controller, o su un server con gli strumenti RSAT di Active Directory e
Criteri di gruppo. **Chi**: un utente Domain Admins, in PowerShell aperto «come amministratore».

1. Scarica da DA-IPAM, pagina **Active Directory → Cosa serve**, i due script e mettili nella stessa
   cartella:
   - `Prepara-Dominio-DA-IPAM.ps1`;
   - `Configura-Audit-DC.ps1`, che lo script lancia per l'audit dei DC.
2. Trova il DN delle OU con i PC e i server da scansionare. Le OU non devono contenere domain
   controller:
   ```powershell
   Get-ADOrganizationalUnit -Filter * | Select-Object DistinguishedName
   ```
3. **Prova**, senza cambiare niente. Lo script dice cosa farebbe, passo per passo:
   ```powershell
   .\Prepara-Dominio-DA-IPAM.ps1 -OuComputer "OU=Computer,DC=ditta,DC=local" -AllowFromIP 192.168.1.50
   ```
   `-AllowFromIP` è l'IP dell'appliance DA-IPAM: WinRM e WMI si aprono solo a quell'indirizzo.
4. **Applica**, con gli stessi parametri più `-Applica`. Per ogni account nuovo lo script chiede la
   password due volte (almeno 16 caratteri), e la password non resta scritta da nessuna parte:
   ```powershell
   .\Prepara-Dominio-DA-IPAM.ps1 -OuComputer "OU=Computer,DC=ditta,DC=local" -AllowFromIP 192.168.1.50 -Applica
   ```
5. Leggi il riepilogo finale. Le righe «Da guardare» sono le cose rimaste fuori.

Lo script si può rilanciare: trova quello che c'è già e fa solo quello che manca. Le opzioni:
`-AccountDc` e `-AccountScansioni` per nomi diversi da quelli di serie, `-SenzaAudit` per saltare
l'audit dei DC, `-DimensioneRegistroMB` per il registro Security (di serie 1024).

## Cosa fa, passo per passo (e come farlo a mano)

### 1. Account della sicurezza del dominio (`svc-ipam-dc`)

Lo script crea un utente di dominio normale, con una password che non scade e che l'utente non può
cambiare. Se l'account c'è già, lo riusa e lo riattiva se era disattivato.

A mano: **Utenti e computer di Active Directory** → OU degli account di servizio → Nuovo → Utente
`svc-ipam-dc`. Spunta «La password non scade mai» e «L'utente non può cambiare la password».

### 2. I gruppi di `svc-ipam-dc`

| Gruppo | Per cosa |
| --- | --- |
| Event Log Readers (S-1-5-32-573) | leggere il registro Security dei DC |
| Remote Management Users (S-1-5-32-580) | entrare nei DC via WinRM |
| DHCP Administrators, se c'è | leggere ambiti e lease del DHCP Microsoft |

A mano: proprietà di `svc-ipam-dc` → **Membro di** → Aggiungi i tre gruppi. Oppure:
```powershell
Add-ADGroupMember -Identity "Event Log Readers" -Members svc-ipam-dc
Add-ADGroupMember -Identity "Remote Management Users" -Members svc-ipam-dc
Add-ADGroupMember -Identity "DHCP Administrators" -Members svc-ipam-dc   # solo con il DHCP Microsoft
```
Se il gruppo DHCP Administrators manca su un server DHCP appena promosso: `Add-DhcpServerSecurityGroup`,
poi `Restart-Service DHCPServer`.

### 3. Audit dei DC

Lo script lancia `Configura-Audit-DC.ps1 -Account svc-ipam-dc`, che fa quattro cose:
- crea la GPO «DA-IPAM - Audit DC», collegata all'OU Domain Controllers, con le sottocategorie di
  audit che servono a «Sicurezza del dominio»;
- forza le sottocategorie sulle categorie;
- imposta la dimensione del registro Security;
- aggiunge alla radice del dominio il controllo (SACL) per vedere DCSync.

La Default Domain Controllers Policy non viene toccata. Il dettaglio a mano sta in
`docs/MANUALE-EVENTI-DC.md` e nella finestra **Come configurare i DC** di «Sicurezza del dominio».

### 4. Account delle scansioni (`svc-ipam`) e il gruppo «DA-IPAM Scansioni»

Lo script crea un utente di dominio normale e un gruppo globale di sicurezza «DA-IPAM Scansioni»,
poi mette l'account nel gruppo. L'account non diventa amministratore di niente finché non c'è la GPO
del passo 5.

A mano: crea l'utente come al passo 1, poi un gruppo globale di sicurezza «DA-IPAM Scansioni»
con dentro `svc-ipam`.

### 5. GPO «DA-IPAM - Scansioni PC e server»

Va collegata **solo** alle OU dei PC e dei server. Lo script si ferma se gli dai l'OU Domain
Controllers, la radice del dominio o un'OU con dentro un DC. Senza `-OuComputer` questo passo non si
fa: l'account delle scansioni resta senza diritti e lo script lo dice alla fine.

Nella GPO ci sono tre cose.
- **Gruppi con restrizioni**: «DA-IPAM Scansioni» è *membro di* Administrators. Il gruppo si
  aggiunge agli Administrators locali e non toglie nessuno di quelli che ci sono.
  A mano: Configurazione computer → Criteri → Impostazioni di Windows → Impostazioni sicurezza →
  Gruppi con restrizioni → Aggiungi gruppo «DOMINIO\DA-IPAM Scansioni» → «Questo gruppo è membro di»:
  Administrators. Non compilare «Membri di questo gruppo».
- **WinRM**:
  - servizio Gestione remota Windows in avvio automatico;
  - Modelli amministrativi → Componenti di Windows → Gestione remota Windows → Servizio WinRM →
    «Consenti la gestione remota del server tramite WinRM» = Abilitato, filtro IPv4 = IP
    dell'appliance.
  - A mano, per il servizio: Configurazione computer → Criteri → Impostazioni di Windows →
    Impostazioni sicurezza → Servizi di sistema → Gestione remota Windows → Automatico.
- **Firewall**, solo profilo Dominio e solo dall'IP dell'appliance:
  - TCP 5985 (WinRM);
  - mappatore RPC (servizio `rpcss`) e RPC dinamico del servizio `winmgmt` (WMI).
  - A mano: Configurazione computer → Criteri → Impostazioni di Windows → Impostazioni sicurezza →
    Windows Defender Firewall → Regole in ingresso. Le tre regole hanno «Ambito → Indirizzo IP
    remoto» = IP dell'appliance.

Collega la GPO alle OU dei computer, mai a Domain Controllers.

## Dopo

- In DA-IPAM, **Active Directory → Nuova integrazione**: `svc-ipam-dc@dominio`, come voce
  «Active Directory» delle credenziali.
- In DA-IPAM, **Credenziali → Windows**: `svc-ipam@dominio`, per le scansioni di PC e server.
- I PC prendono la GPO al prossimo aggiornamento, entro 90 minuti; prima, con `gpupdate /force`.
  Verifica su un PC: `gpresult /r` (deve comparire la GPO) e `net localgroup Administrators`
  (deve comparire «DA-IPAM Scansioni»).
- Sul DC, per controllare l'audit: `auditpol /get /category:*`.

## Tornare indietro

- Scollega o elimina le GPO «DA-IPAM - Scansioni PC e server» e «DA-IPAM - Audit DC» (Gestione
  Criteri di gruppo).
- Togli `svc-ipam-dc` dai gruppi del passo 2, poi disattiva o elimina i due account e il gruppo
  «DA-IPAM Scansioni».
- La SACL per DCSync sulla radice del dominio si toglie da **Utenti e computer di Active
  Directory** → proprietà del dominio → Sicurezza → Avanzate → Controllo.

## Limiti noti

- Lo script non è ancora stato provato su un dominio vero: prima di usarlo da un cliente va lanciato
  su un dominio di prova, prima in prova e poi con `-Applica`.
- Il gruppo DHCP Administrators si cerca per nome: su un dominio in un'altra lingua può chiamarsi
  diversamente. Allora lo script lo dice, e quel gruppo va aggiunto a mano.
