/**
 * Campi dei binding credenziale di un apparato (POST/PUT
 * /api/devices/[id]/credentials), tappa 1 credenziali (15/10); tappa 2e (T20,
 * 16/10).
 *
 * SNMP: la community è il segreto e lo username resta vuoto. Prima la tabella
 * la mandava come `inline_username`, in chiaro, e chi legge la community
 * guarda solo il campo cifrato.
 *
 * Dalla 2e utente e password nuovi non si scrivono più dentro il binding
 * (inline): vanno a parte, in chiaro, alla rotta, che crea o aggiorna la voce
 * d'archivio dell'apparato (`credentials/apparato-archivio.ts`). Un binding ha
 * sempre una voce: `credential_id: null` non la stacca più.
 */

export function normalizzaInlineSnmp(
  protocolType: string | undefined,
  inlineUsername: string | null | undefined,
  inlinePassword: string | null | undefined
): { inline_username: string | null | undefined; inline_password: string | null | undefined } {
  if (protocolType !== "snmp") return { inline_username: inlineUsername, inline_password: inlinePassword };
  return { inline_username: null, inline_password: inlinePassword || inlineUsername || null };
}

/** Quello che cambia nel binding: voce, protocollo, porta. Mai campi inline. */
export interface AggiornamentoBinding {
  credential_id?: number;
  protocol_type?: string;
  port?: number;
}

/**
 * Segreto nuovo, in chiaro, per la voce dell'apparato. `undefined` = non
 * cambiare (una password vuota non cancella quella che c'è).
 */
export interface SegretoBinding {
  username?: string | null;
  password?: string;
}

/**
 * «update»: la modifica del binding e, se l'utente ha scritto utente o
 * segreto («Nuova»), il segreto da portare nella voce. Con una voce
 * dell'archivio scelta il segreto non c'è.
 */
export function aggiornamentiBinding(data: {
  credential_id?: number | null;
  protocol_type?: string;
  port?: number;
  inline_username?: string | null;
  inline_password?: string | null;
}): { modifica: AggiornamentoBinding; segreto: SegretoBinding | null } {
  const modifica: AggiornamentoBinding = {};
  if (data.protocol_type !== undefined) modifica.protocol_type = data.protocol_type;
  if (data.port !== undefined) modifica.port = data.port;
  if (data.credential_id != null) {
    modifica.credential_id = data.credential_id;
    return { modifica, segreto: null };
  }
  if (data.inline_username === undefined && data.inline_password === undefined) return { modifica, segreto: null };
  if (data.protocol_type === "snmp") {
    const community = normalizzaInlineSnmp("snmp", data.inline_username, data.inline_password).inline_password;
    // Community vuota = non modificare (come le password).
    return { modifica, segreto: community ? { username: null, password: community } : null };
  }
  return {
    modifica,
    segreto: {
      username: data.inline_username,
      password: data.inline_password ? data.inline_password : undefined,
    },
  };
}
