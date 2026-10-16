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
 *
 * Tappa 2 (T13, 16/10): gli otto tipi d'archivio. Il «Metodo» si sceglie per i
 * tipi che ne hanno due, i campi sono quelli del metodo (`campiDelMetodo` di
 * `tipi.ts`, gli stessi che il server richiede), SNMP v3 è un tipo a sé. La
 * voce arriva dalla GET già mascherata (`CredenzialeVista`): dei segreti si sa
 * solo se ci sono. Prove in `__tests__/modulo.test.ts`.
 */
import { CRED_TYPE_OPTIONS } from "@/lib/credential-protocol-map";
import type { CredenzialeVista } from "./maschera";
import { DEFAULT_PORTS } from "./porte";
import {
  METODI_PER_TIPO,
  campiDelMetodo,
  campiRichiesti,
  etichettaMetodo,
  etichettaTipo,
  formaSegreto,
  normalizzaTipo,
  valePerAccesso,
  type CampoVoce,
  type MetodoAccesso,
  type TipoCredenziale,
} from "./tipi";

/** Una voce dell'archivio come la restituisce GET /api/credentials: la vista mascherata. */
export type VoceArchivio = CredenzialeVista;

export type LivelloV3 = "" | "noAuthNoPriv" | "authNoPriv" | "authPriv";

export interface ModuloCredenziale {
  name: string;
  credential_type: string;
  /** "" = il primo metodo del tipo. */
  auth_method: string;
  /** Utente, client id o id del token, secondo il metodo. */
  username: string;
  /** Password, community, token, chiave API o client secret, secondo il metodo. Write-only. */
  password: string;
  /** Chiave SSH privata. Write-only. */
  private_key: string;
  passphrase: string;
  /** Solo per SNMP v3. */
  security_level: LivelloV3;
  auth_protocol: string;
  auth_key: string;
  priv_protocol: string;
  priv_key: string;
  /** "" = porta standard del tipo. */
  port: string;
}

export type CampoSegreto = "password" | "private_key" | "passphrase" | "auth_key" | "priv_key";

export interface StatoModulo {
  /** null = voce nuova. */
  editingId: number | null;
  form: ModuloCredenziale;
  /** In modifica: tipo, metodo e segreti già salvati. Null per una voce nuova. */
  salvata: { credential_type: string; auth_method: string | null; segreti: Record<CampoSegreto, boolean> } | null;
}

export interface OpzioneTipo {
  value: string;
  label: string;
}

const MODULO_VUOTO: ModuloCredenziale = {
  name: "",
  credential_type: "ssh",
  auth_method: "",
  username: "",
  password: "",
  private_key: "",
  passphrase: "",
  security_level: "",
  auth_protocol: "",
  auth_key: "",
  priv_protocol: "",
  priv_key: "",
  port: "",
};

/** Porta standard per tipo (gli stessi valori di DEFAULT_PORTS in `porte.ts`). */
const PORTA_STANDARD: Readonly<Partial<Record<TipoCredenziale, number>>> = {
  ssh: DEFAULT_PORTS.ssh,
  snmp: DEFAULT_PORTS.snmp,
  snmp_v3: DEFAULT_PORTS.snmp,
  windows: DEFAULT_PORTS.winrm,
  api: DEFAULT_PORTS.api,
};

const LIVELLI_V3: ReadonlySet<string> = new Set(["noAuthNoPriv", "authNoPriv", "authPriv"]);

function livelloV3(v: string | null | undefined): LivelloV3 {
  return v && LIVELLI_V3.has(v) ? (v as LivelloV3) : "";
}

/** Tipo e metodo del modulo; null se il tipo è sconosciuto o il metodo non è del tipo. */
function accesso(form: ModuloCredenziale): { tipo: TipoCredenziale; metodo: MetodoAccesso } | null {
  const tipo = normalizzaTipo(form.credential_type);
  if (!tipo) return null;
  const metodi = METODI_PER_TIPO[tipo];
  const metodo = (form.auth_method || metodi[0]) as MetodoAccesso;
  return metodi.includes(metodo) ? { tipo, metodo } : null;
}

/** Metodi da scegliere nella tendina «Metodo»: vuoto per i tipi che ne hanno uno solo. */
export function metodiDelTipo(tipo: string): OpzioneTipo[] {
  const t = normalizzaTipo(tipo);
  if (!t || METODI_PER_TIPO[t].length < 2) return [];
  return METODI_PER_TIPO[t].map((m) => ({ value: m, label: etichettaMetodo(t, m) }));
}

/** Campi del modulo per il tipo e il metodo scelti (vuoto se il tipo è sconosciuto). */
export function campiDelModulo(stato: StatoModulo): CampoVoce[] {
  const a = accesso(stato.form);
  return a ? campiDelMetodo(a.tipo, a.metodo) : [];
}

/** Etichette dei due campi che cambiano significato col metodo. */
export function etichetteCampi(tipo: string, metodo: string): { username: string; password: string } {
  const username = metodo === "client" ? "Client ID" : metodo === "token" ? "ID del token (facoltativo)" : "Username";
  let password = "Password";
  if (metodo === "community") password = "Community";
  else if (metodo === "token") password = "Token";
  else if (metodo === "chiave" && normalizzaTipo(tipo) !== "ssh") password = "Chiave API";
  else if (metodo === "client") password = "Client secret";
  return { username, password };
}

/**
 * Un segreto è già salvato e il campo vuoto vuol dire «non modificare»: solo
 * in modifica, e solo se tipo e metodo hanno la stessa forma della voce
 * salvata (`formaSegreto`): altrimenti il server lo svuota e va riscritto.
 */
export function segretoGiaImpostato(stato: StatoModulo, campo: CampoSegreto): boolean {
  const s = stato.salvata;
  if (!s || !s.segreti[campo]) return false;
  const ora = accesso(stato.form);
  const tipoPrima = normalizzaTipo(s.credential_type);
  if (!ora || !tipoPrima) return false;
  const metodoPrima = (s.auth_method || METODI_PER_TIPO[tipoPrima][0]) as MetodoAccesso;
  return formaSegreto(ora.tipo, ora.metodo) === formaSegreto(tipoPrima, metodoPrima);
}

export function statoNuovo(tipo = "ssh"): StatoModulo {
  return {
    editingId: null,
    form: { ...MODULO_VUOTO, credential_type: tipo, security_level: normalizzaTipo(tipo) === "snmp_v3" ? "authPriv" : "" },
    salvata: null,
  };
}

/** In modifica lo username si chiede al server (`?for_edit=1`) solo se la voce ne ha uno. */
export function serveUtenteInModifica(voce: Pick<VoceArchivio, "ha_username">): boolean {
  return voce.ha_username;
}

/** Stato del modulo per modificare una voce: i segreti non arrivano mai, si sa solo se ci sono. */
export function statoModifica(voce: VoceArchivio, username: string): StatoModulo {
  return {
    editingId: voce.id,
    form: {
      ...MODULO_VUOTO,
      name: voce.name,
      credential_type: voce.credential_type,
      auth_method: voce.auth_method ?? "",
      username,
      security_level: livelloV3(voce.security_level),
      auth_protocol: voce.auth_protocol ?? "",
      priv_protocol: voce.priv_protocol ?? "",
      port: voce.port != null ? String(voce.port) : "",
    },
    salvata: {
      credential_type: voce.credential_type,
      auth_method: voce.auth_method,
      segreti: {
        password: voce.ha_password,
        private_key: voce.ha_chiave_privata,
        passphrase: voce.ha_passphrase,
        auth_key: voce.ha_auth_key,
        priv_key: voce.ha_priv_key,
      },
    },
  };
}

function portaScritta(form: ModuloCredenziale): number | null {
  const t = form.port.trim();
  return t ? Number(t) : null;
}

/** Il messaggio di un campo obbligatorio vuoto. */
function manca(tipo: TipoCredenziale, metodo: MetodoAccesso, campo: "username" | "password" | "private_key"): string {
  if (campo === "private_key") return "Chiave privata richiesta";
  if (campo === "username") {
    if (metodo === "client") return "Client ID richiesto";
    if (metodo === "utente_v3") return "Username SNMPv3 richiesto";
    return "Username richiesto";
  }
  if (metodo === "community") return "Community string richiesta";
  if (metodo === "token") return "Token richiesto";
  if (metodo === "client") return "Client secret richiesto";
  if (metodo === "chiave" && tipo !== "ssh") return "Chiave API richiesta";
  return "Password richiesta";
}

/** Il primo errore del modulo, o null se si può salvare. */
export function erroreModulo(stato: StatoModulo): string | null {
  const { form } = stato;
  if (!form.name.trim()) return "Nome richiesto";
  const a = accesso(form);
  if (!normalizzaTipo(form.credential_type)) return "Scegli il tipo della credenziale";
  if (!a) return "Scegli il metodo d'accesso";
  const { tipo, metodo } = a;
  const porta = portaScritta(form);
  if (valePerAccesso(tipo) && porta !== null && (!Number.isInteger(porta) || porta < 1 || porta > 65535)) {
    return "Porta fra 1 e 65535, oppure vuota per la porta standard";
  }
  if (tipo === "snmp_v3") {
    if (!form.username.trim()) return manca(tipo, metodo, "username");
    if (!form.security_level) return "Livello di sicurezza SNMPv3 richiesto";
    const conAuth = form.security_level === "authNoPriv" || form.security_level === "authPriv";
    if (conAuth && !form.auth_protocol) return "Protocollo di autenticazione SNMPv3 richiesto";
    if (conAuth && !form.auth_key.trim() && !segretoGiaImpostato(stato, "auth_key")) return "Chiave di autenticazione SNMPv3 richiesta";
    if (form.security_level === "authPriv" && !form.priv_protocol) return "Protocollo di privacy SNMPv3 richiesto";
    if (form.security_level === "authPriv" && !form.priv_key.trim() && !segretoGiaImpostato(stato, "priv_key")) {
      return "Chiave di privacy SNMPv3 richiesta";
    }
    return null;
  }
  for (const campo of campiRichiesti(tipo, metodo)) {
    if (campo === "username") {
      if (!form.username.trim()) return manca(tipo, metodo, "username");
    } else if (campo === "password" || campo === "private_key") {
      if (!form[campo].trim() && !segretoGiaImpostato(stato, campo)) return manca(tipo, metodo, campo);
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
 * Corpo della richiesta: solo i campi del metodo scelto. I segreti vuoti non
 * si mandano (in modifica vuol dire «non modificare»). La porta solo per i
 * tipi d'accesso: in modifica `null` riporta alla standard, in creazione la
 * porta vuota non si manda. Da chiamare dopo `erroreModulo`.
 */
export function richiestaSalvataggio(stato: StatoModulo): RichiestaSalvataggio {
  const { form, editingId } = stato;
  const a = accesso(form);
  const campi = campiDelModulo(stato);
  const body: Record<string, unknown> = { name: form.name, credential_type: form.credential_type };
  if (a && METODI_PER_TIPO[a.tipo].length > 1) body.auth_method = a.metodo;
  if (campi.includes("username")) body.username = form.username;
  for (const campo of ["password", "private_key", "passphrase"] as const) {
    if (campi.includes(campo) && form[campo]) body[campo] = form[campo];
  }
  if (campi.includes("v3")) {
    body.security_level = form.security_level || null;
    body.auth_protocol = form.auth_protocol || null;
    if (form.auth_key) body.auth_key = form.auth_key;
    body.priv_protocol = form.priv_protocol || null;
    if (form.priv_key) body.priv_key = form.priv_key;
  }
  const porta = portaScritta(form);
  if (a && valePerAccesso(a.tipo)) {
    if (editingId) body.port = porta;
    else if (porta !== null) body.port = porta;
  }
  return editingId
    ? { url: `/api/credentials/${editingId}`, method: "PUT", body }
    : { url: "/api/credentials", method: "POST", body };
}

/** Il campo porta si mostra solo per i tipi d'accesso (non per controller e AD). */
export function haPorta(tipo: string): boolean {
  return valePerAccesso(tipo);
}

/** Segnaposto del campo porta: lo standard del tipo, se lo si conosce. */
export function segnapostoPorta(tipo: string): string {
  const t = normalizzaTipo(tipo);
  const p = t ? PORTA_STANDARD[t] : undefined;
  return p != null ? `standard (${p})` : "standard";
}

/**
 * Opzioni della tendina del tipo con, in fondo, il tipo della voce aperta se
 * non c'è: una voce di un tipo che la tendina non offre resta leggibile in
 * modifica invece di mostrare un valore grezzo.
 */
export function opzioniConTipoAttuale(opzioni: readonly OpzioneTipo[], tipo: string): OpzioneTipo[] {
  if (opzioni.some((o) => o.value === tipo)) return [...opzioni];
  const label = CRED_TYPE_OPTIONS.find((o) => o.value === tipo)?.label ?? etichettaTipo(tipo);
  return [...opzioni, { value: tipo, label }];
}
