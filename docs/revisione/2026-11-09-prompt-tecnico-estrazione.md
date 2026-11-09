# Prompt per il Claude Code del tecnico: estrazione di switch e router in JSON per DA-IPAM

> **Decisioni di Riccardo (09/11/2026):**
> - «mi basta un prompt da dare al claude code con le modalità con cui scrivere i json, poi verrà inserito nel pacchetto
>   completo di da-ipam»;
> - «il sistema dovrà usare internet per capire come accedere ad un apparato, chiedere le credenziali, testare l'accesso e
>   verificare come esportare i dati nel formato comune»;
> - «il prompt dovrebbe essere visibile nella UI dell'installazione del tecnico».

**Il testo del prompt sta in un posto solo:** [`src/lib/estrazione/prompt-tecnico.md`](../../src/lib/estrazione/prompt-tecnico.md).
Sull'installazione «tecnico» lo mostra la pagina «Estrazione apparati» (`/estrazione-apparati`), col pulsante «Copia». Si
modifica solo quel file: questa pagina non ne tiene una copia.

**Prompt per lo sviluppo** (Riccardo, 09/11: «servirebbe un prompt per inghiottire sia il json che inserire il collector
centralizzato delle installazioni dei tecnici»): [`src/lib/estrazione/prompt-sviluppo.md`](../../src/lib/estrazione/prompt-sviluppo.md).
Si usa nel repo DA-IPAM a ogni pacchetto di consegna di un tecnico. La parte A, da fare una volta sola, scrive l'import del
JSON; la parte B trasforma lo script del tecnico in un collector del catalogo.

L'analisi completa resta come riferimento in [`2026-11-09-estrazione-device-tecnico.md`](2026-11-09-estrazione-device-tecnico.md).
