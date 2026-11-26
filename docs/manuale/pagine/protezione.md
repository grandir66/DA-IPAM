---
percorso: /protezione
titolo: Stato della protezione — cosa protegge questa installazione
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Dice in una pagina sola **come è difesa questa installazione di DA-IPAM**: una riga per strato (rete, accessi,
utenti, servizi, chiavi), con lo stato, cosa vuol dire, la gravità e il rimedio. Serve a vedere a colpo d'occhio cosa
è a posto e cosa resta da sistemare, e ad andare dritti alla pagina dove si rimedia.

Si arriva da **Sicurezza › Protezione**. La pagina e le sue schede le vedono solo gli amministratori. In cima ci
sono le schede **Stato della protezione** (questa), [Porte presentate](pagine/protezione-porte.md),
[Chi può collegarsi](pagine/protezione-accessi.md), [Utenti](pagine/protezione-utenti.md),
[Sistemi remoti](pagine/protezione-sistemi.md), [Moduli e container](pagine/protezione-moduli.md),
[Esche](pagine/protezione-esche.md) e [Tentativi e blocchi](pagine/protezione-tentativi.md).

Il manuale non mostra schermate di queste pagine: descrivono come è difesa l'installazione.

## Le voci della pagina

In cima tre numeri:

- **Da sistemare**: quante righe chiedono un intervento, e quante sono gravi.
- **Non letti**: i controlli che su questa macchina non si sono potuti fare.
- **Porte aperte a tutti**: quante porte rispondono a chiunque arrivi alla macchina.

Sotto, il pannello **Cosa è chiuso e cosa resta debole**. Ogni riga è calcolata su questa macchina nel momento in cui
si apre la pagina, e non mostra mai un valore segreto. Colonne:

- **Strato**: la parte della difesa (per esempio le porte, il filtro degli accessi, gli utenti, la chiave di
  cifratura).
- **Stato**: com'è adesso, col suo segno.
- **Cosa vuol dire**: la spiegazione in parole semplici.
- **Gravità**: quanto conta.
- **Rimedio**: cosa fare. Dove c'è un pulsante, porta alla pagina in cui si rimedia.

In fondo un elenco dice cosa la pagina **non controlla ancora**.

## Come si usa

1. Leggi dall'alto: le righe gravi stanno in cima.
2. Dove c'è un pulsante nel **Rimedio**, seguilo: porta alla scheda giusta.
3. Dopo aver sistemato, ricarica la pagina per rifare i controlli.

## Cosa vogliono dire i segni

- ■ grave.
- ▲ da sistemare.
- ○ a posto.
- ? non letto su questa macchina: il controllo non si è potuto fare. Non vuol dire che va bene.

## Da dove arrivano i dati

Controlli fatti in quel momento sulla macchina che ospita DA-IPAM. Nessun valore segreto viene letto a schermo.

## Se la pagina è vuota

La pagina non è mai vuota. Molte righe «non letto» di solito vogliono dire che DA-IPAM non gira su un'appliance
completa, dove quei controlli si possono fare.
