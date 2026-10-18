// L'API di lettura di DA-Zabbix, finta (§3 del design): le quattro rotte, la
// paginazione degli host, gli errori nel formato {errore, codice}. Registra ogni
// chiamata, così le prove contano anche le richieste che NON devono partire.
// Indirizzi solo di documentazione (192.0.2.x), nomi inventati.
import { ErroreLettura, type RispostaGrezza, type Trasporto } from "../../trasporto";

export const CODCLI = "12345";

export interface HostFinto {
  hostid: string;
  nome?: string;
  host?: string;
  ip?: string[];
  ip_condiviso?: boolean;
  proxy?: string | null;
  disponibilita?: { complessiva: string; interfacce?: Array<{ tipo: string; stato: string }> };
  dati_affidabili?: boolean;
}

export interface StatoCentro {
  codcli: string;
  /** Il codcli scritto nelle risposte (di norma = codcli): per simulare il cliente errato. */
  codcliRisposta?: string;
  cliente: string;
  vecchio: boolean;
  eta_s: number;
  proxy: Array<{ nome: string; in_linea: boolean; ultimo_contatto: string | null }>;
  host: HostFinto[];
  problemi: Array<{ eventid: string; hostid: string; nome: string; gravita: number; dal: string; preso_in_carico: boolean }>;
  troncati: number;
  valori: Array<{ hostid: string; chiave: string; valore: number | string | null; unita: string; clock: string; vecchio: boolean }>;
  /** Pagina degli host forzata più piccola, per provare `dopo`/`successivo`. */
  limitePagina?: number;
  /** Guasto da simulare: HTTP con codice, oppure rete/tempo (eccezione del trasporto). */
  guasto?: { status: number; codice: string; retryAfter?: string } | "rete" | "tempo" | null;
}

export function hostFinto(id: number, ip: string, extra: Partial<HostFinto> = {}): HostFinto {
  return {
    hostid: String(id),
    nome: `Apparato ${id}`,
    host: `apparato-${id}`,
    ip: [ip],
    ip_condiviso: false,
    proxy: `${CODCLI}-zbx`,
    disponibilita: { complessiva: "si", interfacce: [{ tipo: "SNMP", stato: "si" }] },
    dati_affidabili: true,
    ...extra,
  };
}

export function statoBase(): StatoCentro {
  return {
    codcli: CODCLI,
    cliente: "ESEMPIO",
    vecchio: false,
    eta_s: 5,
    proxy: [{ nome: `${CODCLI}-zbx`, in_linea: true, ultimo_contatto: "2026-10-16T10:00:00Z" }],
    host: [hostFinto(10001, "192.0.2.10"), hostFinto(10002, "192.0.2.11")],
    problemi: [],
    troncati: 0,
    valori: [
      { hostid: "10001", chiave: "icmppingsec", valore: 0.0021, unita: "s", clock: "2026-10-16T09:59:30Z", vecchio: false },
    ],
    guasto: null,
  };
}

function json(status: number, corpo: unknown, retryAfter: string | null = null): RispostaGrezza {
  return { status, body: JSON.stringify(corpo), retryAfter };
}

/** Risposta del centro finto a un percorso (con query). */
export function rispondi(s: StatoCentro, percorso: string): RispostaGrezza {
  const u = new URL(percorso, "https://centro.invalid");
  const m = /\/api\/lettura\/v1\/([a-z]+)$/.exec(u.pathname);
  if (!m) return json(404, { errore: "rotta sconosciuta", codice: "parametri" });
  if (s.guasto && typeof s.guasto === "object") {
    return json(s.guasto.status, { errore: "guasto finto", codice: s.guasto.codice }, s.guasto.retryAfter ?? null);
  }
  const testa = {
    codcli: s.codcliRisposta ?? s.codcli,
    cliente: s.cliente,
    letto_alle: "2026-10-16T10:00:00Z",
    eta_s: s.eta_s,
    vecchio: s.vecchio,
  };
  switch (m[1]) {
    case "cliente":
      return json(200, { ...testa, proxy: s.proxy, host: s.host.length });
    case "host": {
      const limite = Math.min(Number(u.searchParams.get("limite") ?? "200"), s.limitePagina ?? 500);
      const dopo = u.searchParams.get("dopo");
      const ordinati = [...s.host].sort((a, b) => Number(a.hostid) - Number(b.hostid));
      const da = dopo ? ordinati.filter((h) => Number(h.hostid) > Number(dopo)) : ordinati;
      const pagina = da.slice(0, limite);
      const successivo = da.length > limite ? pagina[pagina.length - 1]!.hostid : null;
      return json(200, { ...testa, host: pagina, successivo });
    }
    case "problemi":
      return json(200, { ...testa, problemi: s.problemi, troncati: s.troncati });
    case "valori": {
      const ids = (u.searchParams.get("hostid") ?? "").split(",").filter(Boolean);
      const propri = new Set(s.host.map((h) => h.hostid));
      return json(200, {
        ...testa,
        valori: s.valori.filter((v) => ids.includes(v.hostid)),
        sconosciuti: ids.filter((i) => !propri.has(i)),
      });
    }
    default:
      return json(404, { errore: "rotta sconosciuta", codice: "parametri" });
  }
}

/** Il centro finto come trasporto: conta le chiamate, simula rete e tempo. */
export function centroFinto(stato: StatoCentro = statoBase()): {
  stato: StatoCentro;
  chiamate: string[];
  trasporto: Trasporto;
} {
  const chiamate: string[] = [];
  const trasporto: Trasporto = async (percorso) => {
    chiamate.push(percorso);
    if (stato.guasto === "rete") throw new ErroreLettura("rete", "centro non raggiungibile: connessione rifiutata");
    if (stato.guasto === "tempo") throw new ErroreLettura("tempo", "il centro non ha risposto entro 15 s");
    return rispondi(stato, percorso);
  };
  return { stato, chiamate, trasporto };
}
