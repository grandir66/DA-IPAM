# Eventi di sicurezza dai domain controller, senza Wazuh

Dal 29/10/2026 DA-IPAM legge da solo il registro **Sicurezza** dei domain controller via WinRM e
riempie la pagina **Sicurezza › Sicurezza del dominio**. Sui DC non si installa niente: servono un
account con i permessi giusti e una GPO di audit fatta bene. Questo documento dice quali.

## Cosa si legge

| Evento | Cosa vuol dire | Dove si vede |
|---|---|---|
| 4768 riuscito | login al dominio da una postazione (ticket Kerberos iniziale) | Login |
| 4624 / 4634 / 4647 (solo console e desktop remoto) | qualcuno entra o esce **sul DC stesso** | Login, Logout |
| 4625, 4771, 4776 non riuscito, 4768 rifiutato | accesso fallito, con il motivo (password errata, utente inesistente, account scaduto…) | Accessi falliti |
| 4740 | account bloccato, con la postazione da cui arrivavano i tentativi | Account bloccati |
| 4720, 4722, 4725, 4726, 4724, 4767 | utente creato, abilitato, disabilitato, eliminato, password reimpostata, account sbloccato | Account, gruppi e diritti |
| 4728, 4732, 4756 / 4729, 4733, 4757 | membro aggiunto o tolto da un gruppo (aggiunte a Domain Admins & co. = livello 12, notifica subito) | Account, gruppi e diritti |
| 4704, 4705 | diritto utente assegnato o tolto | Account, gruppi e diritti |
| 1102 | registro di controllo cancellato (notifica subito) | Registro cancellato |

I login e i logout dei **PC** non stanno sul DC: il DC vede il login (4768), il logout lo registra
solo la postazione. Per quello serve l'agente sul PC o la lettura WinRM del PC.

Gli account dei computer (quelli che finiscono con `$`) si scartano già sul DC. Le nostre sonde
(account di servizio di DA-IPAM, IP dell'appliance) restano contate ma fuori dalle classifiche.

## Quali DC si leggono

**Tutti.** Ogni DC registra solo gli accessi che ha servito lui: con due DC, metà dei login sta
sull'altro. DA-IPAM prende l'elenco dei DC dalla sincronizzazione LDAP (computer nell'OU
«Domain Controllers») e li legge uno alla volta, ogni 5 minuti, ripartendo dall'ultimo record
letto. Non serve registrarli a mano: basta che l'integrazione Active Directory abbia la
**credenziale WinRM del DC**. Se la sincronizzazione non li ha ancora portati, si legge il DC
scritto nell'integrazione.

## Account da usare (permessi minimi)

Un account di dominio dedicato, **non** amministratore di dominio, nei gruppi:

- **Event Log Readers** (Lettori registri eventi): legge il registro Sicurezza;
- **Remote Management Users** (Utenti gestione remota): apre la sessione WinRM.

Sui DC questi gruppi sono gruppi locali di dominio predefiniti (contenitore `Builtin`): basta
aggiungervi l'account in Active Directory. La credenziale va in **Credenziali** come voce Windows
e si sceglie come «Credenziale WinRM del DC» nell'integrazione AD.

Se il DC risponde «accesso negato» al registro, la pagina lo dice sul DC interessato: di solito
manca Event Log Readers.

## La GPO di audit dei DC

Si modifica la **Default Domain Controllers Policy** (o una GPO collegata all'OU Domain
Controllers), in *Configurazione computer › Criteri › Impostazioni di Windows › Impostazioni
sicurezza › Configurazione avanzata dei criteri di controllo › Criteri di controllo*.

| Categoria | Sottocategoria | Impostazione | Per vedere |
|---|---|---|---|
| Accesso account | Convalida credenziali | Operazione riuscita e non riuscita | 4776 |
| Accesso account | Servizio di autenticazione Kerberos | Operazione riuscita e non riuscita | 4768, 4771 |
| Gestione account | Gestione account utente | Operazione riuscita e non riuscita | 4720, 4722, 4724, 4725, 4726, 4740, 4767 |
| Gestione account | Gestione gruppi di sicurezza | Operazione riuscita | 4728, 4729, 4732, 4733, 4756, 4757 |
| Accesso/fine sessione | Accesso | Operazione riuscita e non riuscita | 4624, 4625 |
| Accesso/fine sessione | Fine sessione | Operazione riuscita | 4634, 4647 |
| Accesso/fine sessione | Blocco account | Operazione non riuscita | 4625 per account bloccato |
| Modifica criteri | Modifica criteri di autorizzazione | Operazione riuscita | 4704, 4705 |
| Modifica criteri | Modifica criteri di controllo | Operazione riuscita | modifiche all'audit stesso |
| Accesso DS | Accesso al servizio directory | Operazione riuscita e non riuscita | 4662 (DCSync), per AD Health |
| Accesso DS | Modifiche al servizio directory | Operazione riuscita | 5136, per AD Health |

E inoltre, in *Impostazioni sicurezza › Criteri locali › Opzioni di sicurezza*:

- **Controllo: imponi impostazioni di sottocategoria dei criteri di controllo** = Abilitato
  (senza, la vecchia policy a 9 categorie può sovrascrivere quella avanzata).

E in *Impostazioni sicurezza › Registro eventi*:

- **Dimensione massima registro di protezione** = almeno **1 GB** (1048576 KB); su un dominio con
  centinaia di utenti 2–4 GB. La pagina segnala «eventi persi» quando il registro gira prima che
  DA-IPAM lo legga: è il segnale che va ingrandito.
- **Metodo di mantenimento del registro di protezione** = Sovrascrivi eventi se necessario.

Dopo `gpupdate /force` sui DC, si verifica con:

```powershell
auditpol /get /category:*
```

La pagina **Active Directory › Health** legge la stessa cosa via WinRM e segnala le sottocategorie
spente che servono alla sicurezza.

## Carico sui DC

Ogni 5 minuti una sessione WinRM per DC, uno alla volta. Il filtro (XPath) gira sul DC: tornano
solo gli eventi dell'elenco sopra, al massimo 2000 per giro (il resto al giro dopo). I 4776
riusciti, che sono la gran parte del traffico NTLM, non lasciano nemmeno il DC.

## Con Wazuh

Di serie («auto») DA-IPAM legge i DC solo dove Wazuh non legge già gli allarmi: i due insieme
conterebbero due volte. In **Opzioni › Eventi di sicurezza dai DC** si sceglie per cliente:
«solo dove Wazuh non li legge», «sempre», «mai». Gli allarmi (accessi falliti, blocchi, modifiche,
registro cancellato) entrano anche nella coda della pagina **Alert sicurezza**, con presa in carico
e notifiche; login e logout restano solo nella pagina del dominio.

## Conservazione

Gli eventi restano 31 giorni sull'appliance, nel database del cliente (tabella `dc_evento`).
