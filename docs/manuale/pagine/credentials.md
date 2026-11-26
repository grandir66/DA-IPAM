---
percorso: /credentials
titolo: Credenziali — l'archivio degli accessi agli apparati
versione: 0.9.1363
aggiornata: 2026-11-26
---

## A cosa serve

È l'**archivio delle credenziali** che DA-IPAM usa per entrare negli apparati e leggerli: SSH per router, switch e
Linux, community SNMP, account Windows per WinRM e WMI, chiavi API, controller UniFi e Omada, Active Directory. Una
credenziale si scrive una volta qui e poi si assegna a quante reti e apparati si vuole. Le password non si vedono mai:
nell'elenco compaiono solo i pallini. Si arriva da **Network › Credenziali**. In cima ci sono due schede:
**Credenziali** (questa pagina) e [Controller di rete](pagine/controllers.md).

![La pagina Credenziali](/manuale/credentials/pagina.png)

## Le voci della pagina

1. **Nuova credenziale**: apre la finestra per aggiungerne una. Si sceglie il **Tipo** e si compilano i campi che
   servono a quel tipo: nome, utente, password o chiave, porta. Per gli account Windows l'utente si scrive come
   `DOMINIO\nomeutente` o `utente@dominio`; per SNMP v3 si sceglie il **Livello di sicurezza** (senza autenticazione,
   con autenticazione, con autenticazione e cifratura) e i protocolli.
2. **Tipo**: che cosa è: **SNMP v1/v2c**, **SSH (password o chiave)**, **Windows (WinRM e WMI)**, **Active
   Directory**, **Controller UniFi**, API e gli altri.
3. **Usata da**: quante reti, apparati, host, controller o domini la usano. Un clic sul numero apre l'elenco **Dove è
   usata**, diviso in **Apparati**, **Reti**, **Host**, **Controller**, **Active Directory**. Una credenziale in uso
   **non si elimina e non cambia tipo**: prima va tolta da lì. Un trattino vuol dire che non la usa nessuno e si può
   eliminare.
4. **Test**: prova la credenziale su un apparato. Si scrive l'**IP o hostname** (e la porta, se non è quella
   standard) e DA-IPAM tenta l'accesso, dicendo se è riuscito.

Le altre colonne: **Nome**, **Username** (sempre nascosto dai pallini), **Porta** («standard» vuol dire quella del
protocollo: 22 per SSH, 161 per SNMP…). Nelle **Azioni** ci sono anche la **matita** (modifica: la password si
riscrive solo se la si vuole cambiare) e il **cestino** (elimina, solo se non è in uso). Per gli account Windows e
Active Directory un pulsante apre **Cosa può fare questo account e cosa va abilitato**: dice quali diritti ha e quali
mancano.

Aggiungere, modificare, provare ed eliminare credenziali spetta a chi ha il ruolo di amministratore.

## Come si usa

1. Premi **Nuova credenziale**, scegli il tipo, compila e salva.
2. Premi **Test** su quella riga e prova un apparato: se l'accesso riesce, la credenziale è giusta.
3. Assegnala alle reti dalla pagina [Subnet](pagine/networks.md) (spunta le reti, **Assegna credenziali**) o agli
   apparati dalla loro scheda.
4. Per togliere una credenziale vecchia guarda **Usata da**: se c'è un numero, toglila prima da quelle reti o apparati.

## Da dove arrivano i dati

Le credenziali le scrive una persona. Le password restano cifrate nel database dell'istanza e non tornano mai al
browser.

## Se la pagina è vuota

«Nessuna credenziale»: premi **Nuova credenziale**. Senza credenziali DA-IPAM vede gli apparati in rete ma non può
leggerne modello, porte, software e collegamenti.
