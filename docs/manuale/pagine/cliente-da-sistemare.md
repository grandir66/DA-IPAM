---
percorso: /cliente/da-sistemare
titolo: Da sistemare — vista cliente
versione: 0.9.1367
aggiornata: 2026-11-26
---

## A cosa serve

Ti dice **cosa c'è da aggiornare e da correggere** sui tuoi apparati, in parole semplici: quali programmi vanno
aggiornati e su quanti apparati, e quali impostazioni vanno cambiate. È il riassunto dei problemi di sicurezza trovati
dai controlli, senza i codici tecnici. È una pagina della [vista cliente](pagine/cliente.md), in sola lettura. Si apre
dal riquadro **Da sistemare** della pagina iniziale; c'è solo se hai attivo un servizio di controllo delle
vulnerabilità o di raccolta dei log di sicurezza.

In cima, **← La tua rete** torna alla [pagina iniziale](pagine/cliente.md); accanto al titolo, la data dell'ultimo
controllo («ultimo controllo: …»).

Nessuna schermata: la pagina elenca problemi di sicurezza ancora aperti, che non si pubblicano nel manuale.

## Cosa aggiornare

Il titolo dice quanti programmi ci sono («12 programmi»). Ogni riga è un programma (per esempio un browser o un sistema
operativo) con «da aggiornare su N apparati».

- Il segno a sinistra dice quanto è urgente: `icona:triangle-alert` rosso è grave, `icona:circle-alert` giallo è meno
  urgente.
- **già usato negli attacchi** vuol dire che quel difetto è sfruttato davvero da chi attacca: va aggiornato per primo.
- Se i programmi sono molti, in fondo c'è «e altri N programmi».

## Da correggere

Le cose che non si sistemano con un aggiornamento ma cambiando un'impostazione («Non serve un aggiornamento: va
cambiata un'impostazione»), con quante sono e su quanti apparati. In fondo, se sono molte, «e altre N».

In fondo alla pagina, una riga con gli **altri problemi tecnici** e su quanti apparati.

## Come si fa

- **Decidere da dove partire**: i programmi con `icona:triangle-alert` rosso e **già usato negli attacchi**.
- **Pianificare gli aggiornamenti con il tuo referente**: stampa la pagina e porta l'elenco **Cosa aggiornare**.
- **Capire quanto è diffuso un problema**: leggi «da aggiornare su N apparati».
- **Avere i dettagli tecnici di una voce**: chiedili al tuo referente tecnico, che li vede nella parte completa di
  DA-IPAM.
- **Controllare che un aggiornamento sia stato fatto**: guarda la data dell'**ultimo controllo** e se il programma è
  sparito dall'elenco.

## Cosa vogliono dire i segni

- `icona:triangle-alert` **rosso**: grave, da aggiornare subito.
- `icona:circle-alert` **giallo**: da aggiornare, meno urgente.

## Da dove arrivano i dati

Dai controlli delle vulnerabilità sui tuoi apparati e dai programmi installati letti dagli agenti.

## Se la pagina è vuota

«Nessun programma da aggiornare» è la buona notizia. «Dato non disponibile» vuol dire che il dato non si è potuto
leggere: riprova più tardi.
