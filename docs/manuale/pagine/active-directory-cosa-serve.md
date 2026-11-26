---
percorso: /active-directory/cosa-serve
titolo: Cosa serve per le analisi — account, diritti e script da preparare nel dominio
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in una pagina **tutto quello che l'IT del cliente deve preparare** perché DA-IPAM possa leggere PC, server e
domain controller: quali account creare, in quali gruppi metterli, cosa abilitare (WinRM, WMI, regole del firewall,
audit degli eventi) e i comandi pronti da copiare. È una pagina da leggere e da girare all'IT: non cambia niente nel
dominio da sola, e la vede uguale chi è in sola lettura e chi è amministratore.

Si arriva da [Active Directory](pagine/active-directory.md) con **Guide › Cosa serve**; il pulsante
`tasto:arrow-left` **Active Directory** in alto a destra torna indietro. Il menu funziona come in tutte le pagine: vedi
le [parti comuni dell'interfaccia](../INTERFACCIA.md).

## Le regole

Il primo riquadro, **Regole**, elenca i principi da rispettare:

- nessun account deve stare in Domain Admins: nessuna funzione di DA-IPAM lo richiede;
- l'account delle scansioni (amministratore locale su PC e server) è separato da quello di sola lettura sui domain
  controller;
- sui domain controller non serve essere amministratori;
- per l'inventario basta una strada fra WMI e WinRM: DA-IPAM le prova da sola, host per host.

## Preparare il dominio in un colpo solo

![Lo script per preparare il dominio](/manuale/active-directory-cosa-serve/script.png)

1. `tasto:download` **Configura-Dominio-DA-IPAM.ps1**: scarica lo script. Sotto, cosa fa: crea (o riusa) i due
   account e i gruppi, crea la GPO che accende WinRM sulle unità organizzative indicate e apre il firewall solo verso
   l'indirizzo di DA-IPAM. Rifiuta la radice del dominio e l'OU dei domain controller e non aggiunge mai nessuno a
   Domain Admins.
2. `tasto:clipboard-copy` **Copia**: copia il comando del riquadro accanto. Il primo lancia lo script prima in prova
   (`-Prova`, dice cosa farebbe) e poi per davvero; il secondo sblocca il file se PowerShell dice che non è firmato.

## Le tabelle dei diritti

![La tabella dei diritti di un account](/manuale/active-directory-cosa-serve/tabella.png)

Due riquadri, uno per account:

- **Utente delle scansioni · svc-ipam**: l'account con cui DA-IPAM entra su PC e server per inventario, software e
  patch;
- **Sicurezza del dominio · svc-ipam-dc**: ciò che si abilita sui domain controller e nel dominio perché DA-IPAM legga
  utenti, eventi e DHCP.

Il numero accanto al titolo dice quante righe ha. Le colonne:

1. **Cosa ottieni**: la funzione che si sblocca (per esempio «Inventario via WMI»). **necessario** sotto il nome vuol
   dire che senza quella riga la funzione principale non va.
2. **Cosa abilitare**: il gruppo o il servizio da accendere.
3. **Dove**: PC e server, domain controller, dominio.
4. **Comando per l'IT**: il comando PowerShell pronto, con `tasto:clipboard-copy` **Copia** sotto.

## Gli eventi

- **Leggere i fallimenti e controllare l'audit**: comandi di sola lettura da dare all'IT, da lanciare su un domain
  controller: **Accessi falliti e account bloccati, ultime 24 ore** e **Voci di audit accese e dimensione del
  registro**, ognuno con il suo **Copia**.
- **Configurazione per l'analisi degli eventi**: le impostazioni di audit da attivare perché gli accessi falliti e i
  blocchi degli account arrivino a DA-IPAM.

## Come si fa

- **Preparare un dominio nuovo con una GPO**: scarica lo script, **Copia** il primo comando, fallo lanciare all'IT su
  un domain controller con `-Prova`, leggi cosa farebbe, poi senza `-Prova`.
- **Senza GPO, una macchina per volta**: segui la tabella **Utente delle scansioni** riga per riga, copiando i
  comandi.
- **Abilitare la lettura degli eventi di accesso**: tabella **Sicurezza del dominio**, poi **Configurazione per
  l'analisi degli eventi**; controlla con i comandi di **Leggere i fallimenti**.
- **Verificare che sia andato bene**: torna in [Active Directory](pagine/active-directory.md) e prova la connessione;
  per gli account Windows, in [Credenziali](pagine/credentials.md) il pulsante **Diritti** mostra quali mancano.

## Da dove arrivano i dati

La pagina è fissa: i comandi sono scritti con l'indirizzo di questa installazione di DA-IPAM e con nomi d'esempio
(`svc-ipam`, `svc-ipam-dc`, `DOMINIO`, OU d'esempio) da adattare al dominio del cliente.
