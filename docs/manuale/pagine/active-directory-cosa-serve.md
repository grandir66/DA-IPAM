---
percorso: /active-directory/cosa-serve
titolo: Cosa serve per le analisi — account, diritti e script da preparare nel dominio
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in una pagina **tutto quello che l'IT del cliente deve preparare** perché DA-IPAM possa leggere PC, server e
domain controller: quali account creare, in quali gruppi metterli, cosa abilitare (WinRM, WMI, regole del firewall,
audit degli eventi) e i comandi pronti da copiare. È una pagina da leggere e da girare all'IT: non cambia niente nel
dominio da sola. Si arriva da [Active Directory](pagine/active-directory.md) con **Guide › Cosa serve**; il pulsante
**← Active Directory** in alto a destra torna indietro.

![La pagina Cosa serve per le analisi](/manuale/active-directory-cosa-serve/pagina.png)

## Le parti della pagina

- **Regole**: i quattro principi da rispettare. Nessun account deve stare in Domain Admins, perché nessuna funzione di
  DA-IPAM lo richiede. L'account delle scansioni (amministratore locale su PC e server) è separato da quello di sola
  lettura sui domain controller. Sui domain controller non serve essere amministratori. Per l'inventario basta una
  strada fra WMI e WinRM: DA-IPAM le prova da sola, host per host.
- **Preparare il dominio in un colpo solo**: lo script **Configura-Dominio-DA-IPAM.ps1** (il pulsante lo scarica) che
  crea o riusa i due account e i gruppi, crea la GPO che accende WinRM sulle unità organizzative indicate e apre il
  firewall solo verso l'indirizzo di DA-IPAM. Si lancia prima in prova (dice cosa farebbe) e poi per davvero; i
  comandi d'esempio sono a destra, con **Copia**. Lo script rifiuta la radice del dominio e l'OU dei domain controller
  e non aggiunge mai nessuno a Domain Admins. Sotto c'è il comando per sbloccare il file se PowerShell dice che non è
  firmato.
- **Utente delle scansioni · svc-ipam**: l'account con cui DA-IPAM entra su PC e server per inventario, software e
  patch. Una riga per ogni cosa che si ottiene: **Cosa ottieni**, **Cosa abilitare**, **Dove** e il **Comando per
  l'IT** da copiare.
- **Sicurezza del dominio · svc-ipam-dc**: ciò che si abilita sui domain controller e nel dominio perché DA-IPAM legga
  utenti, eventi e DHCP, con la stessa tabella.
- **Leggere i fallimenti e controllare l'audit**: comandi di sola lettura da dare all'IT, da lanciare su un domain
  controller, per verificare che gli eventi di accesso siano registrati.
- **Configurazione per l'analisi degli eventi**: le impostazioni di audit da attivare perché gli accessi falliti e i
  blocchi degli account arrivino a DA-IPAM.

Ogni riquadro di comandi ha il suo pulsante **Copia**.

## Come si usa

1. Leggi le **Regole** con l'IT del cliente.
2. Se si può usare una GPO, scarica lo script, lancialo in prova e poi per davvero su un domain controller.
3. Altrimenti segui le tabelle una riga alla volta, copiando i comandi.
4. Torna in [Active Directory](pagine/active-directory.md) e prova la connessione. Per gli account Windows,
   [Credenziali](pagine/credentials.md) mostra quali diritti risultano mancanti.

## Da dove arrivano i dati

La pagina è fissa: i comandi sono scritti con l'indirizzo di questa installazione di DA-IPAM e con nomi d'esempio
(`svc-ipam`, `svc-ipam-dc`, OU d'esempio) da adattare al dominio del cliente.
