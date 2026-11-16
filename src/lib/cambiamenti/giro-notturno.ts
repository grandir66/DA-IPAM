/**
 * Il giro notturno delle porte che popola «Porte nuove» (Riccardo, 14/11/2026: «ragionare con il giro di scansioni
 * sulle reti per popolare i cambiamenti, verificando di non fare scansioni troppo aggressive»).
 *
 * È il giro rapido di Discovery (le stesse porte), ma col freno: il giro lanciato a mano va a `-T5 --min-rate 400`
 * con 12 host insieme, questo ha un tetto di pacchetti al secondo e due host alla volta. Una subnet per notte, a
 * rotazione: ogni rete si confronta con se stessa una volta ogni N notti e non si scansiona mai tutto insieme.
 * Gli impianti restano al solo ping, come in ogni giro (`eImpianto` in `discovery.ts`).
 *
 * Non ha un tipo di job suo: è un `nmap_scan` con `config.cosa = "cambiamenti"`, come i client UniFi su
 * `unifi_sync`. Un tipo nuovo vorrebbe la ricostruzione della tabella dei job su ogni installazione.
 *
 * Modulo puro: lo importano anche le etichette dei job.
 */
export const COSA_GIRO_CAMBIAMENTI = "cambiamenti";
/** Marca il controllo delle anomalie acceso insieme al giro, per poterlo togliere quando il giro si spegne. */
export const CONFIG_ANOMALIE_DEL_GIRO = JSON.stringify({ da: COSA_GIRO_CAMBIAMENTI });
export const CONFIG_GIRO_CAMBIAMENTI = JSON.stringify({ cosa: COSA_GIRO_CAMBIAMENTI });

/** Il freno. Il perimetro del confronto include gli argomenti di nmap: cambiarli azzera il confronto per un giro. */
export const FRENO_GIRO_CAMBIAMENTI = { ratePps: 100, concorrenza: 2, retries: 1 } as const;

/** Oltre, la rete non entra nella rotazione: da decidere con Riccardo come trattarle (TASKS 14/11). */
export const INDIRIZZI_MASSIMI_GIRO_CAMBIAMENTI = 1024;

export function eGiroCambiamenti(configStr: string | null | undefined): boolean {
  try {
    return (JSON.parse(configStr || "{}") as { cosa?: unknown }).cosa === COSA_GIRO_CAMBIAMENTI;
  } catch {
    return false;
  }
}

/** Quanti indirizzi ha un CIDR IPv4; Infinity se non si legge (così la rete resta fuori). */
export function indirizziDelCidr(cidr: string): number {
  const m = /^\d{1,3}(?:\.\d{1,3}){3}\/(\d{1,2})$/.exec(cidr.trim());
  if (!m || Number(m[1]) > 32) return Infinity;
  return 2 ** (32 - Number(m[1]));
}

/**
 * La rete di stanotte: le reti ammesse in ordine di id, una per notte. Senza stato: il numero del giorno (ora
 * italiana, così il giro delle 03:00 non cambia rete a cavallo della mezzanotte UTC) modulo le reti.
 */
export function reteDellaNotte<R extends { id: number; cidr: string }>(
  reti: readonly R[],
  adessoMs: number = Date.now(),
): { rete: R | null; ammesse: number; troppoGrandi: number } {
  const ammesse = reti.filter((r) => indirizziDelCidr(r.cidr) <= INDIRIZZI_MASSIMI_GIRO_CAMBIAMENTI).sort((a, b) => a.id - b.id);
  const troppoGrandi = reti.length - ammesse.length;
  if (ammesse.length === 0) return { rete: null, ammesse: 0, troppoGrandi };
  const giorno = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" }).format(adessoMs);
  const numero = Math.floor(Date.parse(`${giorno}T00:00:00Z`) / 86_400_000);
  return { rete: ammesse[numero % ammesse.length], ammesse: ammesse.length, troppoGrandi };
}

/**
 * La rete del prossimo giro, per la scritta «Stanotte» della pagina: dopo le 03:00 italiane il prossimo giro è quello
 * di domani. Visto sull'hub il 14/11: alle 17:30 la pagina diceva «LAN Base», alle 03:00 è toccato a «LAN Client».
 */
export function reteDelProssimoGiro<R extends { id: number; cidr: string }>(reti: readonly R[], adessoMs: number = Date.now()): R | null {
  const ora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(adessoMs));
  return reteDellaNotte(reti, ora >= 3 ? adessoMs + 86_400_000 : adessoMs).rete;
}
