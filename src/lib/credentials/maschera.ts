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
  /**
   * Perché i segreti della voce non si sono potuti guardare (da-vault: con OpenBao, oltre la cache); assente = guardati.
   * Se c'è, i sei `ha_…` valgono `false` e NON vogliono dire «assente».
   */
  segreti_non_leggibili?: string | null;
  /** Usi che tengono ferma la voce (`totaleUsi` di `usi.ts`). */
  usi_totale: number;
  created_at: string;
  updated_at: string;
}

const presente = (v: string | null | undefined): boolean => v != null && v !== "";

/**
 * Quali segreti ha la voce. Di serie si guardano le colonne; con OpenBao (da-vault) le colonne sono vuote e chi chiama
 * dà la presenza letta da OpenBao (`presenzaSegretiDb` di `segreti.ts`), o il motivo per cui non si è potuta leggere.
 */
export type SegretiDellaVoce = { ok: true; presenti: Readonly<Record<string, boolean>> } | { ok: false; motivo: string };

export function mascheraCredenziale(c: Credential, usiTotale: number, segreti?: SegretiDellaVoce): CredenzialeVista {
  const ha = (colonna: keyof Credential): boolean => {
    if (!segreti) return presente(c[colonna] as string | null | undefined);
    return segreti.ok ? segreti.presenti[colonna] === true : false;
  };
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
    ha_username: ha("encrypted_username"),
    ha_password: ha("encrypted_password"),
    ha_chiave_privata: ha("encrypted_private_key"),
    ha_passphrase: ha("encrypted_key_passphrase"),
    ha_auth_key: ha("encrypted_auth_key"),
    ha_priv_key: ha("encrypted_priv_key"),
    usi_totale: usiTotale,
    created_at: c.created_at,
    updated_at: c.updated_at,
    // Solo se serve: con l'interruttore spento la vista è quella di sempre, senza una chiave in più.
    ...(segreti && !segreti.ok ? { segreti_non_leggibili: segreti.motivo } : {}),
  };
}
