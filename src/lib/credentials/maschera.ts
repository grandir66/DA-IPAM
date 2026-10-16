/**
 * La voce dell'archivio come la restituiscono le API (tappa 2 credenziali,
 * T13, 16/10).
 *
 * Prima le rotte restituivano la riga del DB con le colonne cifrate
 * sovrascritte una per una (`{ ...riga, encrypted_x: "●●●●●●●●" }`): una
 * colonna cifrata nuova, dimenticata nella maschera, passava dallo spread. Qui
 * la vista si costruisce campo per campo, e dei segreti dice solo se ci sono.
 *
 * Modulo puro (solo tipi e `tipi.ts`): lo importano anche i componenti client.
 */
import type { Credential } from "@/types";
import { etichettaTipo, normalizzaTipo } from "./tipi";

export interface CredenzialeVista {
  id: number;
  name: string;
  /** Codice d'archivio; una voce `linux` rimasta si mostra come `ssh`. */
  credential_type: string;
  etichetta: string;
  auth_method: string | null;
  port: number | null;
  security_level: string | null;
  auth_protocol: string | null;
  priv_protocol: string | null;
  /** Utente, client id o id del token, secondo il metodo. */
  ha_username: boolean;
  /** Password, community, token, chiave API o client secret, secondo il metodo. */
  ha_password: boolean;
  ha_chiave_privata: boolean;
  ha_passphrase: boolean;
  ha_auth_key: boolean;
  ha_priv_key: boolean;
  /** Usi che tengono ferma la voce (`totaleUsi` di `usi.ts`). */
  usi_totale: number;
  created_at: string;
  updated_at: string;
}

const presente = (v: string | null | undefined): boolean => v != null && v !== "";

export function mascheraCredenziale(c: Credential, usiTotale: number): CredenzialeVista {
  return {
    id: c.id,
    name: c.name,
    credential_type: normalizzaTipo(c.credential_type) ?? c.credential_type,
    etichetta: etichettaTipo(c.credential_type),
    auth_method: c.auth_method ?? null,
    port: c.port ?? null,
    security_level: c.security_level ?? null,
    auth_protocol: c.auth_protocol ?? null,
    priv_protocol: c.priv_protocol ?? null,
    ha_username: presente(c.encrypted_username),
    ha_password: presente(c.encrypted_password),
    ha_chiave_privata: presente(c.encrypted_private_key),
    ha_passphrase: presente(c.encrypted_key_passphrase),
    ha_auth_key: presente(c.encrypted_auth_key),
    ha_priv_key: presente(c.encrypted_priv_key),
    usi_totale: usiTotale,
    created_at: c.created_at,
    updated_at: c.updated_at,
  };
}
