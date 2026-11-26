---
percorso: /protezione/tentativi
titolo: Tentativi e blocchi — chi ha provato a entrare senza riuscirci
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Raccoglie in un elenco solo **chi ha provato a entrare senza riuscirci**: dalla pagina di accesso di DA-IPAM, da SSH,
dal filtro degli accessi e dalle [Esche](pagine/protezione-esche.md). Da qui si blocca un indirizzo per un periodo o
lo si dichiara come nostro, da non bloccare mai.

Si arriva dalla scheda **Tentativi e blocchi** di **Sicurezza › Protezione** (le schede sono descritte in
[Stato della protezione](pagine/protezione.md)). Solo amministratori. Nessuna schermata nel manuale.

## I numeri

**Tentativi (7 giorni)**, **Oggi**, **Bloccati adesso**, **Sopra soglia adesso** (chi di recente ha superato la soglia
di avviso).

## Bloccati adesso e Mai bloccati

- **Bloccati adesso**: gli indirizzi bloccati, con quanto manca alla scadenza. Tutto ciò che arriva da loro viene
  scartato fino ad allora; un riavvio della macchina li libera. **Sblocca** li libera subito. «Nessuno.» se non ce ne
  sono.
- **Mai bloccati**: gli indirizzi dichiarati come nostri (scanner, monitoraggio), oltre al collegamento di gestione,
  alla macchina stessa e agli indirizzi sempre ammessi dal filtro. **Togli da «mai bloccati»** li rimette fra quelli
  che si possono bloccare.

## Chi ha provato a entrare

Una riga per strada e indirizzo, negli ultimi 7 giorni. Mai una password: solo il nome provato. Accanto al titolo si
legge se gli avvisi sono accesi o spenti (si accendono in **Impostazioni › Notifiche**).

| Colonna | Che cosa dice |
|---|---|
| **Indirizzo** | Da dove è arrivato il tentativo. |
| **In inventario** | Il nome, «sì, senza nome», «questa macchina» o «sconosciuto». |
| **Strada** | Da dove è passato: **Pagina web**, **SSH**, **Filtro di rete** o **Esca**. |
| **Tentativi** | Quanti. |
| **Nomi provati** | I nomi utente usati, mai le password. |
| **Porte** | Le porte toccate. |
| **Primo**, **Ultimo** | Il primo e l'ultimo tentativo. |
| **Stato** | ■ **bloccato**, ▲ **sopra soglia**, ○ **sotto soglia**, ● **nostro, non conta**. |
| **Azioni** | Vedi sotto. |

Le azioni della riga:

- **Blocca** con la prima durata, oppure uno degli altri pulsanti con una durata diversa: blocca l'indirizzo per quel
  tempo;
- **Sblocca**, se è già bloccato;
- **Non bloccare mai**: per i nostri sistemi che provano le porte per mestiere; diventa **Togli da «mai bloccati»**.

## Come si fa

- **Fermare chi prova le password**: guarda le righe con più tentativi e **In inventario** «sconosciuto»; premi
  **Blocca** con la durata che serve.
- **Liberare un indirizzo bloccato per errore**: **Sblocca** nella riga, oppure in **Bloccati adesso**.
- **Smettere di vedere lo scanner di monitoraggio**: **Non bloccare mai** sulla sua riga: da lì in poi è ●
  **nostro, non conta** e non fa scattare avvisi.
- **Ricevere un avviso quando qualcuno supera la soglia**: accendi le notifiche in **Impostazioni › Notifiche**.
- **Sapere chi ha toccato un'esca**: guarda le righe con **Strada** **Esca**.

## Cosa vogliono dire i segni

- ■ **bloccato**.
- ▲ **sopra soglia**: ha superato la soglia di avviso.
- ○ **sotto soglia**.
- ● **nostro, non conta**: la macchina stessa o un nostro sistema.

## Da dove arrivano i dati

I login falliti della pagina, il registro di SSH, gli indirizzi scartati dal filtro e i contatti con le esche, raccolti
ogni pochi minuti. Mai una password.

## Se la pagina è vuota

**Nessun tentativo negli ultimi 7 giorni**: è il caso migliore. Gli avvisi partono solo se le notifiche sono accese
in Impostazioni › Notifiche.
