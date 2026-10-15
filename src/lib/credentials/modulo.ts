/**
 * Il modulo «Nuova / Modifica credenziale» senza la parte visiva (tappa 4
 * credenziali, 15/10): stato iniziale, controlli prima del salvataggio e
 * corpo della richiesta. Modulo puro, senza DB: lo usano il componente
 * condiviso `components/credentials/credential-form-dialog.tsx`, la pagina
 * Credenziali e il wizard.
 *
 * Perché esiste: la logica stava dentro la pagina Credenziali, e il wizard ne
 * aveva una sua con quattro blocchi fissi; la stessa voce si chiedeva due
 * volte e il router finiva con utente e password in linea, fuori archivio.
 * Controlli e corpi sono quelli della pagina prima dell'estrazione (prova in
 * `__tests__/modulo.test.ts`).
 */
import { CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import { DEFAULT_PORTS } from "./porte";
import { etichettaTipo } from "./tipi";

/** Una voce dell'archivio come la restituisce GET /api/credentials (segreti mascherati). */
export interface VoceArchivio {
  id: number;
  name: string;
  credential_type: string;
  encrypted_username: string | null;
  encrypted_password: string | null;
  /** SNMPv3: mai il valore reale, solo l'indicatore di presenza. */
  encrypted_auth_key: string | null;
  auth_protocol: string | null;
  encrypted_priv_key: string | null;
  priv_protocol: string | null;
  security_level: string | null;
  /** Porta propria; null = porta standard del tipo. */
  port: number | null;
  created_at: string;
  updated_at: string;
}

export type LivelloV3 = "" | "noAuthNoPriv" | "authNoPriv" | "authPriv";

export interface ModuloCredenziale {
  name: string;
  credential_type: string;
  username: string;
  /** Password, oppure community per SNMP v2c. */
  password: string;
  /** SNMPv3 (solo tipo `snmp`): "" = nessuna, community v2c. */
  security_level: LivelloV3;
  auth_protocol: string;
  /** Write-only: sempre vuota all'apertura. */
  auth_key: string;
  priv_protocol: string;
  /** Write-only: sempre vuota all'apertura. */
  priv_key: string;
  /** "" = porta standard del tipo. */
  port: string;
}

export interface StatoModulo {
  /** null = voce nuova. */
  editingId: number | null;
  form: ModuloCredenziale;
  /** Chiavi SNMPv3 già impostate: in modifica il campo vuoto vuol dire «non modificare». */
  existingAuthKey: boolean;
  existingPrivKey: boolean;
}

export interface OpzioneTipo {
  value: string;
  label: string;
}

const MODULO_VUOTO: ModuloCredenziale = {
  name: "",
  credential_type: "ssh",
  username: "",
  password: "",
  security_level: "",
  auth_protocol: "",
  auth_key: "",
  priv_protocol: "",
  priv_key: "",
  port: "",
};

/** Porta standard per tipo (gli stessi valori di DEFAULT_PORTS in `porte.ts`). */
const PORTA_STANDARD: Readonly<Record<string, number>> = {
  ssh: DEFAULT_PORTS.ssh,
  linux: DEFAULT_PORTS.ssh,
  snmp: DEFAULT_PORTS.snmp,
  windows: DEFAULT_PORTS.winrm,
  api: DEFAULT_PORTS.api,
};

const TIPI_UTENTE_PASSWORD: ReadonlySet<string> = new Set(["ssh", "api", "windows", "linux"]);

/** Tipi col campo utente e password (gli altri: SNMP a parte, i nuovi li decide il server). */
export function haUtentePassword(tipo: string): boolean {
  return TIPI_UTENTE_PASSWORD.has(tipo);
}

const LIVELLI_V3: ReadonlySet<string> = new Set(["noAuthNoPriv", "authNoPriv", "authPriv"]);

function livelloV3(v: string | null | undefined): LivelloV3 {
  return v && LIVELLI_V3.has(v) ? (v as LivelloV3) : "";
}

export function statoNuovo(tipo = "ssh"): StatoModulo {
  return {
    editingId: null,
    form: { ...MODULO_VUOTO, credential_type: tipo },
    existingAuthKey: false,
    existingPrivKey: false,
  };
}

/** In modifica lo username si chiede al server (`?for_edit=1`) solo dove il modulo lo mostra. */
export function serveUtenteInModifica(voce: Pick<VoceArchivio, "credential_type" | "security_level">): boolean {
  return haUtentePassword(voce.credential_type) || (voce.credential_type === "snmp" && !!voce.security_level);
}

/**
 * Stato del modulo per modificare una voce. Le chiavi SNMPv3 non arrivano mai
 * dalla GET: il modulo parte vuoto e sa solo se ci sono.
 */
export function statoModifica(voce: VoceArchivio, username: string): StatoModulo {
  return {
    editingId: voce.id,
    form: {
      ...MODULO_VUOTO,
      name: voce.name,
      credential_type: voce.credential_type,
      username,
      security_level: livelloV3(voce.security_level),
      auth_protocol: voce.auth_protocol ?? "",
      priv_protocol: voce.priv_protocol ?? "",
      port: voce.port != null ? String(voce.port) : "",
    },
    existingAuthKey: !!voce.encrypted_auth_key,
    existingPrivKey: !!voce.encrypted_priv_key,
  };
}

function portaScritta(form: ModuloCredenziale): number | null {
  const t = form.port.trim();
  return t ? Number(t) : null;
}

/** Il primo errore del modulo, o null se si può salvare. */
export function erroreModulo(stato: StatoModulo): string | null {
  const { form, editingId, existingAuthKey, existingPrivKey } = stato;
  if (!form.name.trim()) return "Nome richiesto";
  // In modifica la password vuota vuol dire «non modificare» (tappa 1).
  if (haUtentePassword(form.credential_type) && (!form.username || (!editingId && !form.password))) {
    return editingId ? "Username richiesto" : "Username e password richiesti";
  }
  if (form.credential_type === "snmp" && !editingId && !form.security_level && !form.password?.trim()) {
    return "Community string richiesta per credenziali SNMP v2c (oppure imposta la sicurezza SNMPv3)";
  }
  const porta = portaScritta(form);
  if (porta !== null && (!Number.isInteger(porta) || porta < 1 || porta > 65535)) {
    return "Porta fra 1 e 65535, oppure vuota per la porta standard";
  }
  if (form.credential_type === "snmp" && form.security_level) {
    const conAuth = form.security_level === "authNoPriv" || form.security_level === "authPriv";
    if (conAuth && !form.auth_protocol) return "Protocollo di autenticazione SNMPv3 richiesto";
    if (conAuth && !form.auth_key.trim() && !existingAuthKey) return "Chiave di autenticazione SNMPv3 richiesta";
    if (form.security_level === "authPriv" && !form.priv_protocol) return "Protocollo di privacy SNMPv3 richiesto";
    if (form.security_level === "authPriv" && !form.priv_key.trim() && !existingPrivKey) {
      return "Chiave di privacy SNMPv3 richiesta";
    }
  }
  return null;
}

export interface RichiestaSalvataggio {
  url: string;
  method: "POST" | "PUT";
  body: Record<string, unknown>;
}

/**
 * Corpo della richiesta. In modifica `port: null` riporta alla porta standard
 * e i segreti vuoti non si mandano; in creazione la porta vuota non si manda.
 * Da chiamare dopo `erroreModulo`.
 */
export function richiestaSalvataggio(stato: StatoModulo): RichiestaSalvataggio {
  const { form, editingId } = stato;
  const porta = portaScritta(form);
  const snmpV3 =
    form.credential_type === "snmp"
      ? {
          security_level: form.security_level || null,
          auth_protocol: form.auth_protocol || null,
          auth_key: form.auth_key || undefined,
          priv_protocol: form.priv_protocol || null,
          priv_key: form.priv_key || undefined,
        }
      : {};
  if (editingId) {
    return {
      url: `/api/credentials/${editingId}`,
      method: "PUT",
      body: {
        name: form.name,
        credential_type: form.credential_type,
        username: form.username || undefined,
        password: form.password || undefined,
        port: porta,
        ...snmpV3,
      },
    };
  }
  return {
    url: "/api/credentials",
    method: "POST",
    body: {
      name: form.name,
      credential_type: form.credential_type,
      username: form.username,
      password: form.password,
      port: porta ?? undefined,
      ...snmpV3,
    },
  };
}

/** Segnaposto del campo porta: lo standard del tipo, se lo si conosce. */
export function segnapostoPorta(tipo: string): string {
  const p = PORTA_STANDARD[tipo];
  return p != null ? `standard (${p})` : "standard";
}

/**
 * Opzioni della tendina del tipo con, in fondo, il tipo della voce aperta se
 * non c'è: una voce «linux» (alias di SSH, non più offerto) resta leggibile in
 * modifica invece di mostrare un valore grezzo.
 */
export function opzioniConTipoAttuale(opzioni: readonly OpzioneTipo[], tipo: string): OpzioneTipo[] {
  if (opzioni.some((o) => o.value === tipo)) return [...opzioni];
  const label = CRED_TYPE_OPTIONS.find((o) => o.value === tipo)?.label ?? etichettaTipo(tipo);
  return [...opzioni, { value: tipo, label }];
}
