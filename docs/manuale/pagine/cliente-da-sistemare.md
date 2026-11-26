---
percorso: /cliente/da-sistemare
titolo: Da sistemare — vista cliente
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

Dice al cliente **cosa c'è da aggiornare e da correggere** sui suoi apparati, in parole semplici: quali programmi vanno
aggiornati e su quanti apparati, e quali impostazioni vanno cambiate. È il riassunto delle vulnerabilità trovate dalle
scansioni, senza i codici tecnici. È una pagina della [vista cliente](pagine/cliente.md), in sola lettura; la vedono gli
utenti con il ruolo Cliente e gli amministratori. Si apre dal riquadro **Da sistemare** della pagina iniziale. C'è solo
se per il cliente è attivo un modulo di scansione delle vulnerabilità o di raccolta dei log di sicurezza.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, la data dell'ultimo
controllo.

Nessuna schermata: la pagina elenca problemi di sicurezza ancora aperti, che non si pubblicano nel manuale.

## Le voci della pagina

- **Cosa aggiornare**, con il numero di programmi: ogni riga è un programma (per esempio un browser o un sistema
  operativo) con «da aggiornare su N apparati». Il segno a sinistra dice la gravità. **già usato negli attacchi** vuol
  dire che quel difetto è sfruttato davvero da chi attacca: va aggiornato per primo. Se i programmi sono molti, in fondo
  c'è «e altri N programmi».
- **Da correggere**: le cose che non si sistemano con un aggiornamento ma cambiando un'impostazione, con quante sono e su
  quanti apparati.
- In fondo, una riga con gli **altri problemi tecnici** e su quanti apparati.

## Come si usa

1. Parti dai programmi con il segno rosso e **già usato negli attacchi**.
2. Poi guarda **Da correggere**.
3. Per i dettagli tecnici chiedi a Domarc: nella parte completa di DA-IPAM ogni voce ha la sua scheda.

## Cosa vogliono dire i segni

- Triangolo **rosso**: grave, da aggiornare subito.
- Cerchio con il punto esclamativo **giallo**: da aggiornare, meno urgente.

## Da dove arrivano i dati

Dalle scansioni delle vulnerabilità sugli apparati del cliente e dai programmi installati letti dagli agenti.

## Se la pagina è vuota

«Nessun programma da aggiornare» è la buona notizia. «Dato non disponibile» vuol dire che il dato non si è potuto leggere:
riprova più tardi.
