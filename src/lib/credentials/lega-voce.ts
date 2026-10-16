/**
 * Chi lega una voce d'archivio a un protocollo: binding dell'apparato, righe
 * dell'host, modifica in blocco degli host, WinRM e account LDAP dell'AD
 * (tappa 2 credenziali, T13 e T24; revisione della 2c, 16/10).
 *
 * Il controllo del tipo sta qui, insieme alla scrittura, per poterlo provare
 * eseguendolo: le rotte passano dalla sessione di NextAuth, che in una prova
 * non c'è. Prima il controllo stava nelle rotte, e la prova ne leggeva il
 * sorgente: guardava solo che il testo del controllo venisse prima della
 * scrittura, e un protocollo fisso o un 400 nel ramo sbagliato passavano lo
 * stesso. Alle rotte resta la traduzione di `VoceNonValePerProtocollo` in 400.
 *
 * Modello: `networks/salva-rete.ts` (usa il facade `db.ts`, come le rotte).
 */
import {
  getDb,
  getCredentialById,
  getAdIntegrationById,
  addDeviceCredentialBinding,
  updateDeviceCredentialBinding,
  getDeviceCredentialBindings,
  addHostCredential,
  getHostCredentials,
  getHostById,
  getNetworkDeviceByHost,
  createAdIntegration,
  updateAdIntegration,
  type DeviceCredentialBinding,
  type AdIntegration,
} from "@/lib/db";
import type { AggiornamentoBinding } from "@/lib/devices/aggiornamenti-binding";
import { stessoDc, type AccountLdap } from "@/lib/ad/account-ldap";
import { controllaVoceAdDb, creaVoceAdDb } from "@/lib/ad/credenziale-ldap";
import { erroreVocePerProtocollo } from "./tipi";

/** La voce non vale per il protocollo, o non c'è: le rotte rispondono 400 col messaggio. */
export class VoceNonValePerProtocollo extends Error {
  constructor(messaggio: string) {
    super(messaggio);
    this.name = "VoceNonValePerProtocollo";
  }
}

export type ProtocolloLegame = "ssh" | "snmp" | "winrm" | "api" | "redfish" | "onvif";

function controlla(credentialId: number, protocollo: string): void {
  const errore = erroreVocePerProtocollo(credentialId, getCredentialById(credentialId), protocollo);
  if (errore) throw new VoceNonValePerProtocollo(errore);
}

/** Aggiunge un binding all'apparato. Un binding inline (senza voce) non ha niente da controllare. */
export function aggiungiBindingApparato(input: Parameters<typeof addDeviceCredentialBinding>[0]): DeviceCredentialBinding {
  if (input.credential_id) controlla(input.credential_id, input.protocol_type);
  return addDeviceCredentialBinding(input);
}

/**
 * Modifica un binding dell'apparato. Si controlla la voce che il binding avrà
 * dopo la modifica, sul protocollo che avrà dopo: quelli mandati, altrimenti
 * quelli di adesso. Dalla 2e (T20) la modifica non porta campi inline: un
 * segreto nuovo va nella voce (`credentials/apparato-archivio.ts`).
 * False = il binding non c'è su quell'apparato.
 */
export function aggiornaBindingApparato(deviceId: number, bindingId: number, modifica: AggiornamentoBinding): boolean {
  const attuale = getDeviceCredentialBindings(deviceId).find((b) => b.id === bindingId);
  if (!attuale) return false;
  const voceDopo = modifica.credential_id ?? attuale.credential_id;
  if (voceDopo) controlla(voceDopo, modifica.protocol_type ?? attuale.protocol_type);
  updateDeviceCredentialBinding(bindingId, modifica);
  return true;
}

/** Aggiunge una riga all'host (finestra delle credenziali dell'host). */
export function aggiungiRigaHost(
  hostId: number,
  credentialId: number,
  protocollo: ProtocolloLegame,
  porta: number,
  opzioni?: { validated?: boolean },
): void {
  controlla(credentialId, protocollo);
  addHostCredential(hostId, credentialId, protocollo, porta, opzioni);
}

export interface EsitoAssegnazione {
  /** Righe host aggiunte (una riga già presente per voce e protocollo non si conta). */
  aggiunte: number;
  /** Host su cui la scrittura è fallita, per id: la rotta lo dice. */
  falliti: number[];
}

/**
 * Modifica in blocco degli host: la voce va su ogni host come riga validata
 * (scelta esplicita: deve comparire subito nella discovery) e, se l'host ha un
 * apparato con lo stesso IP, come binding dell'apparato. Il tipo si controlla
 * una volta, prima di toccare qualunque host. Prima un errore su un host si
 * ingoiava («skip»): ora l'host finisce in `falliti` e nel journal.
 */
export function assegnaCredenzialeAgliHost(
  hostIds: readonly number[],
  credentialId: number,
  protocollo: ProtocolloLegame,
  porta: number,
): EsitoAssegnazione {
  controlla(credentialId, protocollo);
  const esito: EsitoAssegnazione = { aggiunte: 0, falliti: [] };
  for (const hostId of hostIds) {
    try {
      const giaLegata = getHostCredentials(hostId).some((hc) => hc.credential_id === credentialId && hc.protocol_type === protocollo);
      if (!giaLegata) {
        addHostCredential(hostId, credentialId, protocollo, porta, { validated: true });
        esito.aggiunte++;
      }
      const host = getHostById(hostId);
      const apparato = host ? getNetworkDeviceByHost(host.ip) : undefined;
      if (apparato) {
        const presente = getDeviceCredentialBindings(apparato.id).some(
          (b) => b.credential_id === credentialId && b.protocol_type === protocollo && b.port === porta,
        );
        if (!presente) {
          addDeviceCredentialBinding({ device_id: apparato.id, credential_id: credentialId, protocol_type: protocollo, port: porta, auto_detected: false });
        }
      }
    } catch (e) {
      esito.falliti.push(hostId);
      console.error(`[credenziali] modifica in blocco: credenziale #${credentialId} non assegnata all'host #${hostId}:`, e);
    }
  }
  return esito;
}

/** I campi dell'integrazione che il modulo manda: l'account va a parte, come voce. */
type CampiAccount = "encrypted_username" | "encrypted_password" | "credential_id";
export type DatiIntegrazioneAd = Omit<Parameters<typeof createAdIntegration>[0], CampiAccount>;
export type ModificaIntegrazioneAd = Omit<NonNullable<Parameters<typeof updateAdIntegration>[1]>, CampiAccount>;

/**
 * Crea un'integrazione AD. La voce WinRM/DHCP vale solo se è Windows (D7 =
 * (a)); l'account LDAP (T24) è una voce «Active Directory»: quella scelta,
 * oppure una «AD · <nome>» creata dall'account scritto, nella stessa
 * transazione della riga (il nome della voce, se è già preso, porta l'id
 * dell'integrazione). Le colonne vecchie dell'account restano vuote. Un
 * account che non vale lancia `AccountLdapNonValido` e non scrive niente.
 */
export function creaIntegrazioneAd(input: DatiIntegrazioneAd, account: AccountLdap): AdIntegration {
  if (input.winrm_credential_id) controlla(input.winrm_credential_id, "winrm");
  const dbh = getDb();
  if ("credential_id" in account) controllaVoceAdDb(dbh, account.credential_id);
  const id = dbh.transaction(() => {
    const ad = createAdIntegration({
      ...input,
      encrypted_username: "",
      encrypted_password: "",
      credential_id: "credential_id" in account ? account.credential_id : null,
    });
    if ("nuovo" in account) updateAdIntegration(ad.id, { credential_id: creaVoceAdDb(dbh, ad, account.nuovo).id });
    return ad.id;
  })();
  return getAdIntegrationById(id) as AdIntegration;
}

/**
 * Modifica un'integrazione AD. Null toglie la voce WinRM; una voce nuova vale
 * solo se è Windows. L'account (T24): la voce scelta, o una voce nuova
 * dall'account scritto; null = resta quello di adesso.
 *
 * D12 = (a): un Domain Controller diverso scollega la voce (`credential_id`
 * NULL) e svuota le colonne vecchie dell'account, a meno che la stessa
 * richiesta non scelga di nuovo la voce o porti un account nuovo. È la difesa
 * che impedisce di mandare l'account di dominio, col bind LDAP, a un
 * indirizzo che nessuno ha scelto (un errore di battitura, una sessione
 * rubata): con le colonne piene il ripiego delle righe mai convertite le
 * leggerebbe. Finché non si sceglie, l'AD dice «Credenziale mancante».
 */
export function aggiornaIntegrazioneAd(id: number, modifica: ModificaIntegrazioneAd, account: AccountLdap | null = null): AdIntegration | undefined {
  if (modifica.winrm_credential_id) controlla(modifica.winrm_credential_id, "winrm");
  const dbh = getDb();
  if (account && "credential_id" in account) controllaVoceAdDb(dbh, account.credential_id);
  const attuale = getAdIntegrationById(id);
  if (!attuale) return undefined;
  const spostato = modifica.dc_host !== undefined && !stessoDc(modifica.dc_host, attuale.dc_host);
  return dbh.transaction(() => {
    const campi: NonNullable<Parameters<typeof updateAdIntegration>[1]> = { ...modifica };
    if (spostato) {
      campi.credential_id = null;
      campi.encrypted_username = "";
      campi.encrypted_password = "";
    }
    if (account && "credential_id" in account) campi.credential_id = account.credential_id;
    else if (account) campi.credential_id = creaVoceAdDb(dbh, { id, name: modifica.name ?? attuale.name }, account.nuovo).id;
    return updateAdIntegration(id, campi);
  })();
}
