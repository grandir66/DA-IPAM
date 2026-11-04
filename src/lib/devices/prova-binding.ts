/**
 * Prova di un binding credenziale di un apparato (tappa 1 credenziali, 15/10):
 * spostata da /api/devices/[id]/credentials per poterla provare.
 *
 * SNMP (tappa 2, T4): il ramo v3 si decide dalla forma del segreto
 * (`leggiSegretoDb(…, "snmp")` dà `v3` oppure `community`), mai dal tipo
 * della voce. Prima una voce v3 rispondeva «Community mancante».
 */
import { apriSessioneCommunity, etichettaVersioneSnmp, type VersioneSnmp } from "@/lib/protocols/snmp-sessione";
import { leggiSegretoDb, type AccessoSsh } from "@/lib/credentials/segreti";
import { provaV3 } from "@/lib/protocols/snmpv3";
import { safeDecrypt } from "@/lib/crypto";
import { eAccountDiDominio, freniDelLogon as freniCondivisi } from "@/lib/credentials/freno-logon-windows";
import type { RicordoErrate } from "@/lib/scanner/account-windows";
import type { EsitoPassword } from "@/lib/scanner/verifica-password-run";
import type { OpzioniWinrm } from "@/lib/devices/winrm-run";

/** Esito della prova: i campi extra (`kind`, `hint`, `methodsOffered`, `methodsTried`)
 *  sono presenti solo per failure SSH e servono al pannello "Diagnostica" in UI.
 *  `nonDisponibile`: per quel protocollo una prova non c'è, e il binding non va
 *  marcato fallito (il motore delle credenziali scarta i binding falliti). */
export interface EsitoProvaBinding {
  success: boolean;
  message: string;
  nonDisponibile?: boolean;
  /** Password verificata giusta e rifiuto vero: mancano i diritti. Il legame e la validazione non si toccano. */
  motivo?: "diritti_mancanti";
  kind?: string;
  hint?: string;
  methodsOffered?: string[];
  methodsTried?: string[];
  /** Il testo grezzo della libreria SSH, per i «dettagli» della diagnostica. */
  raw?: string;
}

/** Le prove si possono sostituire (niente rete). Di serie le prove vere. */
export interface DipendenzeProvaBinding {
  wmiIdentita?: (host: string, username: string, password: string) => Promise<unknown>;
  winrm?: (
    host: string,
    port: number,
    username: string,
    password: string,
    command: string,
    usePowershell: boolean,
    realm: string,
    opzioni?: OpzioniWinrm,
  ) => Promise<unknown>;
  ricordo?: RicordoErrate;
  verificaPassword?: (username: string, password: string) => Promise<EsitoPassword>;
}

/** La prova non è partita: non è un rifiuto, e il legame non si marca (`nonDisponibile`). */
function nonPartita(message: string): EsitoProvaBinding {
  return { success: false, nonDisponibile: true, message };
}

/** I freni sono quelli condivisi con il pulsante Test e la ricerca: `src/lib/credentials/freno-logon-windows.ts`. */
async function freniDelLogon(username: string, password: string, realm: string | null, deps: DipendenzeProvaBinding): Promise<{ fermata: EsitoProvaBinding } | { password: EsitoPassword }> {
  const freno = await freniCondivisi(username, password, deps, { realm });
  if ("fermata" in freno) return { fermata: nonPartita(freno.fermata.messaggio) };
  return freno;
}

/** Il dominio dell'integrazione AD accesa, `null` se non ce n'è una. */
async function realmAd(): Promise<string | null> {
  const { getAdRealm } = await import("@/lib/db");
  return getAdRealm()?.realm ?? null;
}

/** Con la password verificata giusta, un rifiuto dichiarato dice che mancano i diritti. */
async function negatoConPasswordGiusta(err: unknown, password: EsitoPassword | null): Promise<boolean> {
  if (password !== "valida") return false;
  const { leggiErrore } = await import("@/lib/scanner/accesso-windows");
  return leggiErrore(err).codice === "AUTH_REJECTED";
}

/** Prova una singola credenziale binding su un host. */
export async function provaBinding(
  host: string,
  binding: { protocol_type: string; port: number; credential_id: number | null; inline_username: string | null; inline_encrypted_password: string | null; credential_type?: string | null },
  versioneSnmp: VersioneSnmp,
  deps: DipendenzeProvaBinding = {}
): Promise<EsitoProvaBinding> {
  try {
    if (binding.protocol_type === "ssh") {
      // Voce d'archivio: utente con password o con chiave (tappa 2 credenziali, T14); il rifiuto dice perché.
      // Binding inline: utente e password, com'era.
      let accesso: AccessoSsh;
      if (binding.credential_id) {
        const { accessoSshCredenziale } = await import("@/lib/db");
        const e = accessoSshCredenziale(binding.credential_id);
        if (!e.ok) return { success: false, message: e.motivo };
        accesso = e.accesso;
      } else {
        const password = binding.inline_encrypted_password ? (safeDecrypt(binding.inline_encrypted_password) ?? undefined) : undefined;
        accesso = { username: binding.inline_username ?? "", ...(password ? { password } : {}) };
      }
      if (!accesso.username) return { success: false, message: "Username mancante" };
      if (!accesso.password && !accesso.privateKey) return { success: false, message: "Password mancante" };

      const { sshTryConnect, segretoSsh } = await import("@/lib/devices/ssh-transport");
      const result = await sshTryConnect({
        host,
        port: binding.port,
        username: accesso.username,
        ...segretoSsh(accesso),
        timeout: 10000,
        credentialName: binding.credential_id ? `cred#${binding.credential_id}` : "inline",
      });
      if (result.ok) return { success: true, message: "Connessione SSH riuscita" };
      const err = result.error;
      const detail = err.hint ? `${err.message} ${err.hint}` : err.message;
      return {
        success: false,
        message: `[${err.kind}] ${detail}`,
        kind: err.kind,
        hint: err.hint,
        methodsOffered: err.methodsOffered,
        methodsTried: err.methodsTried,
        raw: err.raw,
      };
    }

    if (binding.protocol_type === "snmp") {
      // Niente «public» di ripiego (tappa 1): una community mancante è un errore
      // da vedere, non una prova riuscita su un apparato che risponde a public.
      let community: string | null;
      if (binding.credential_id) {
        const { getDb } = await import("@/lib/db");
        const esito = leggiSegretoDb(getDb(), binding.credential_id, "snmp");
        if (!esito.ok) return { success: false, message: esito.motivo };
        if (esito.segreto.forma === "v3") {
          // Timer di 8 s come la community; la sessione aspetta il 60% (4,8 s).
          const v3 = await provaV3(host, esito.segreto.record, { port: binding.port, timeoutMs: 8000 });
          return v3.ok
            ? { success: true, message: "SNMP raggiungibile (v3)" }
            : { success: false, message: `SNMPv3: ${v3.error ?? "autenticazione non riuscita"}` };
        }
        community = esito.segreto.forma === "community" ? esito.segreto.community : null;
      } else {
        community = binding.inline_encrypted_password ? safeDecrypt(binding.inline_encrypted_password) : null;
      }
      if (!community?.trim()) return { success: false, message: "Community mancante" };
      const snmp = await import("net-snmp");
      // Versione dell'apparato; NULL = v1, come prima (createSession senza version).
      const session = apriSessioneCommunity(snmp, host, community, { port: binding.port, timeout: 5000, versione: versioneSnmp });
      return new Promise((resolve) => {
        // Il timer e la risposta possono arrivare entrambi: una seconda close() lancia
        // ERR_SOCKET_DGRAM_NOT_RUNNING fuori dalla richiesta (DTS, 2026-10-15).
        let settled = false;
        const finish = (r: { success: boolean; message: string }): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try { session.close(); } catch { /* socket già chiuso */ }
          resolve(r);
        };
        const timer = setTimeout(() => finish({ success: false, message: "Timeout SNMP" }), 8000);
        session.get(["1.3.6.1.2.1.1.1.0"], (error: Error | null) => {
          finish(error
            ? { success: false, message: `SNMP: ${error.message}` }
            : { success: true, message: `SNMP raggiungibile (${etichettaVersioneSnmp(versioneSnmp)})` }
          );
        });
      });
    }

    if (binding.protocol_type === "winrm") {
      let username: string | undefined;
      let password: string | undefined;
      if (binding.credential_id) {
        const { getCredentialLoginPair } = await import("@/lib/db");
        const pair = getCredentialLoginPair(binding.credential_id, "windows");
        username = pair?.username;
        password = pair?.password;
      } else {
        username = binding.inline_username ?? undefined;
        password = binding.inline_encrypted_password ? (safeDecrypt(binding.inline_encrypted_password) ?? undefined) : undefined;
      }
      if (!username) return { success: false, message: "Username mancante" };
      // Solo una voce di dominio può bloccare un account per tutti. Con la password non verificata un trasporto solo: la
      // catena del bridge farebbe fino a quattro logon errati per clic (stessa regola della scansione).
      const realm = await realmAd();
      let opzioni: OpzioniWinrm | undefined;
      let esitoPassword: EsitoPassword | null = null;
      if (eAccountDiDominio(username, realm)) {
        // Una password vuota sarebbe un logon errato per niente, e sul DC un bind anonimo che riesce.
        if (!password) return { success: false, message: "Password mancante" };
        const freno = await freniDelLogon(username, password, realm, deps);
        if ("fermata" in freno) return freno.fermata;
        esitoPassword = freno.password;
        if (freno.password !== "valida") opzioni = { unSoloLogon: true };
      }
      try {
        const runWinrm = deps.winrm ?? (await import("@/lib/devices/winrm-run")).runWinrmCommand;
        const out = await runWinrm(
          host,
          binding.port ?? 5985,
          username,
          password ?? "",
          "echo DA-IPAM-TEST",
          false,
          realm ?? "",
          opzioni
        );
        return String(out).includes("DA-IPAM-TEST")
          ? { success: true, message: "WinRM funzionante" }
          : { success: false, message: "WinRM: risposta inattesa" };
      } catch (err: unknown) {
        const message = `WinRM: ${err instanceof Error ? err.message : "errore"}`;
        return { success: false, message, ...((await negatoConPasswordGiusta(err, esitoPassword)) ? { motivo: "diritti_mancanti" as const } : {}) };
      }
    }

    if (binding.protocol_type === "wmi") {
      // Un legame WMI si prova come la scansione: una query leggera di identità (Task 8, piano accesso Windows).
      let username: string | undefined;
      let password: string | undefined;
      if (binding.credential_id) {
        const { getCredentialLoginPair } = await import("@/lib/db");
        const pair = getCredentialLoginPair(binding.credential_id, "windows");
        username = pair?.username;
        password = pair?.password;
      } else {
        username = binding.inline_username ?? undefined;
        password = binding.inline_encrypted_password ? (safeDecrypt(binding.inline_encrypted_password) ?? undefined) : undefined;
      }
      if (!username) return { success: false, message: "Username mancante" };
      // Una password vuota sarebbe un logon errato per niente.
      if (!password) return { success: false, message: "Password mancante" };
      // Il freno lascia passare un account locale: non blocca il dominio, come nel ramo WinRM.
      const freno = await freniDelLogon(username, password, await realmAd(), deps);
      if ("fermata" in freno) return freno.fermata;
      try {
        const prova = deps.wmiIdentita ?? (await import("@/lib/devices/wmi-run")).runWmiIdentita;
        await prova(host, username, password);
        return { success: true, message: "WMI funzionante" };
      } catch (err: unknown) {
        // Il rifiuto del bridge può citare utente e password: si maschera prima di restituire il messaggio.
        const { maschera } = await import("@/lib/scanner/accesso-windows");
        const { WmiError } = await import("@/lib/devices/wmi-run");
        const testo = err instanceof Error ? err.message : "errore";
        // `kind` è il codice del motore: serve a chi decide se è un rifiuto o una macchina muta (`eErroreDiTrasporto`).
        return {
          success: false,
          message: `WMI: ${maschera(testo, username, password)}`,
          ...(err instanceof WmiError ? { kind: err.code } : {}),
          ...((await negatoConPasswordGiusta(err, freno.password)) ? { motivo: "diritti_mancanti" as const } : {}),
        };
      }
    }

    return { success: false, nonDisponibile: true, message: "Test non disponibile per questo protocollo" };
  } catch (err: unknown) {
    return { success: false, message: err instanceof Error ? err.message : "Errore test" };
  }
}
