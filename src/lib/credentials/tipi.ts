/**
 * Tipi d'archivio delle credenziali, metodi d'accesso, etichette e la regola
 * unica tipo ↔ protocollo (tappa 2 credenziali, T2, 15/10).
 *
 * Modulo puro, senza DB e senza dipendenze: lo importano anche i componenti
 * client, come `porte.ts`. Prima la regola tipo ↔ protocollo stava in due
 * posti con valori diversi (`credential-protocol-map.ts` e il livello 5 di
 * `resolve.ts`): per `api` le tendine offrivano le voci `ssh` (Proxmox con
 * root) e il motore no.
 *
 * Fino alla 2c il DB e il validatore accettano solo cinque codici
 * (`ssh`, `snmp`, `api`, `windows`, `linux`): `snmp_v3`, `unifi`, `omada` e `ad`
 * esistono qui ma non ancora nell'archivio. `linux` non è un tipo: è un alias
 * di `ssh` in lettura, e dalla 2c non ci sono più voci `linux`.
 */

export const TIPI_CREDENZIALE = ["ssh", "snmp", "snmp_v3", "windows", "api", "unifi", "omada", "ad"] as const;
export type TipoCredenziale = (typeof TIPI_CREDENZIALE)[number];

export type MetodoAccesso = "password" | "chiave" | "community" | "utente_v3" | "utente" | "token" | "client";

/**
 * Metodi d'accesso di ogni tipo. Il primo è quello di una voce con
 * `auth_method` NULL (le voci scritte prima della tappa 2).
 */
export const METODI_PER_TIPO: Record<TipoCredenziale, readonly MetodoAccesso[]> = {
  ssh: ["password", "chiave"],
  snmp: ["community"],
  snmp_v3: ["utente_v3"],
  windows: ["password"],
  api: ["utente", "token"],
  unifi: ["chiave", "utente"],
  omada: ["client", "utente"],
  ad: ["password"],
};

export const ETICHETTE_TIPO: Record<TipoCredenziale, string> = {
  ssh: "SSH (password o chiave)",
  snmp: "SNMP v1/v2c",
  snmp_v3: "SNMP v3",
  windows: "Windows (WinRM e WMI)",
  api: "API (token o utente)",
  unifi: "Controller UniFi",
  omada: "Controller Omada",
  ad: "Active Directory",
};

const TIPI_NOTI: ReadonlySet<string> = new Set(TIPI_CREDENZIALE);

/** Codice del DB → tipo d'archivio. `linux` → `ssh`; sconosciuto o assente → null. */
export function normalizzaTipo(t: string | null | undefined): TipoCredenziale | null {
  if (t == null) return null;
  const codice = t.trim().toLowerCase();
  if (codice === "linux") return "ssh";
  return TIPI_NOTI.has(codice) ? (codice as TipoCredenziale) : null;
}

/** Etichetta per esteso; un codice sconosciuto si mostra com'è, mai nascosto. */
export function etichettaTipo(t: string | null | undefined): string {
  const tipo = normalizzaTipo(t);
  return tipo ? ETICHETTE_TIPO[tipo] : (t ?? "");
}

/**
 * Regola unica: quali codici di `credentials.credential_type` valgono per un
 * protocollo, di apparato (`network_devices.protocol`) o di binding
 * (`protocol_type`).
 * - SSH: `ssh` e l'alias `linux`;
 * - WinRM: solo `windows`. L'account AD non entra (D7 = (a)): finirebbe nelle
 *   catene e nelle prove in sequenza, cioè in accessi falliti con l'account
 *   più delicato;
 * - SNMP (`snmp`, `snmp_v2`, `snmp_v3`): `snmp` e `snmp_v3`, la versione la
 *   decide la credenziale;
 * - API: `api` e `ssh` (Proxmox con utente root, regola della tappa 1);
 * - Redfish, ONVIF: solo `api`;
 * - protocollo sconosciuto o assente: i tipi d'accesso, senza SNMP.
 * UniFi, Omada e AD non valgono per nessun protocollo: li sceglie chi
 * configura il controller o l'integrazione.
 * Ogni chiamata restituisce un elenco nuovo.
 */
export function tipiPerProtocollo(protocollo: string | null | undefined): string[] {
  switch (protocollo) {
    case "ssh":
      return ["ssh", "linux"];
    case "winrm":
      return ["windows"];
    case "snmp":
    case "snmp_v2":
    case "snmp_v3":
      return ["snmp", "snmp_v3"];
    case "api":
      return ["api", "ssh"];
    case "redfish":
    case "onvif":
      return ["api"];
    default:
      return ["ssh", "windows", "api", "linux"];
  }
}

/**
 * Campi logici di una voce. Colonne: `username` → `encrypted_username`,
 * `password` → `encrypted_password` (anche community, token, chiave API e
 * client secret), `private_key` → `encrypted_private_key`, `auth_key` →
 * `encrypted_auth_key`, `priv_key` → `encrypted_priv_key`.
 */
export type CampoCredenziale = "username" | "password" | "private_key" | "auth_key" | "priv_key";

const LIVELLI_V3 = ["noAuthNoPriv", "authNoPriv", "authPriv"] as const;

/**
 * Campi obbligatori di una voce per tipo e metodo. Facoltativi, quindi assenti
 * qui: la passphrase della chiave SSH e l'id del token API.
 * SNMP v3 dipende dal livello; senza livello si chiedono tutti i campi
 * (authPriv), mai di meno. Un metodo che il tipo non ha, o un livello SNMPv3
 * sconosciuto, è un errore: un elenco vuoto vorrebbe dire «nessun campo
 * obbligatorio» e farebbe passare una voce vuota.
 */
export function campiRichiesti(tipo: TipoCredenziale, metodo: MetodoAccesso, livelloV3?: string | null): CampoCredenziale[] {
  if (!METODI_PER_TIPO[tipo].includes(metodo)) {
    throw new Error(`Il metodo «${metodo}» non vale per il tipo «${ETICHETTE_TIPO[tipo]}»`);
  }
  switch (metodo) {
    case "password":
    case "utente":
    case "client":
      return ["username", "password"];
    case "chiave":
      return tipo === "ssh" ? ["username", "private_key"] : ["password"];
    case "community":
    case "token":
      return ["password"];
    case "utente_v3": {
      const livello = livelloV3 ?? "authPriv";
      if (!(LIVELLI_V3 as readonly string[]).includes(livello)) {
        throw new Error(`Il livello SNMPv3 «${livello}» non è riconosciuto (ammessi: ${LIVELLI_V3.join(", ")})`);
      }
      if (livello === "noAuthNoPriv") return ["username"];
      if (livello === "authNoPriv") return ["username", "auth_key"];
      return ["username", "auth_key", "priv_key"];
    }
  }
}
