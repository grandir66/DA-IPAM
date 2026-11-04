/**
 * L'account come lo vede il dominio (piano accesso Windows, revisione del 04/11/2026): due voci con lo stesso utente e la
 * stessa password sono un account solo, e il limite di 3 conta i suoi logon errati, non le voci. Puro: niente database.
 *
 * La chiave è utente normalizzato + impronta della password: SHA-256 con un sale casuale di processo, mai la password.
 *
 * `RicordoErrate` tiene fra un giro e l'altro la risposta certa `errata`: senza, ogni giro rifarebbe un bind sbagliato sul
 * DC, e un giro ogni pochi minuti basta a bloccare l'account. Sta in memoria, per tenant, e scade: una password corretta
 * cambia impronta e si verifica subito, una uguale aspetta 30 minuti. Leggere non allunga la scadenza.
 *
 * Il sale e i ricordi stanno su `globalThis`: scheduler e rotte possono caricare due copie di questo modulo (stessa
 * famiglia della regola 14), e due copie vorrebbero dire una verifica in più sul DC.
 */
import { createHash, randomBytes } from "node:crypto";

export const VALIDITA_ERRATA_MS = 30 * 60 * 1000;

/** `DOM\mario`, `mario@dom.local` → `mario@dom`; `mario`, `.\mario`, `localhost\mario` → `mario`. Senza maiuscole. */
export function utenteNormalizzato(username: string): string {
  const pulito = username.trim().toLowerCase();
  const barra = pulito.indexOf("\\");
  const chiocciola = pulito.lastIndexOf("@");
  let utente = pulito;
  let dominio = "";
  if (barra >= 0) {
    dominio = pulito.slice(0, barra);
    utente = pulito.slice(barra + 1);
  } else if (chiocciola >= 0) {
    utente = pulito.slice(0, chiocciola);
    dominio = pulito.slice(chiocciola + 1);
  }
  dominio = dominio.split(".")[0];
  return dominio && dominio !== "localhost" ? `${utente}@${dominio}` : utente;
}

export class RicordoErrate {
  private readonly scadenze = new Map<string, number>();

  constructor(private readonly adesso: () => number = Date.now) {}

  ricorda(chiave: string): boolean {
    const ora = this.adesso();
    for (const [k, scadenza] of this.scadenze) {
      if (scadenza <= ora) this.scadenze.delete(k);
    }
    return this.scadenze.has(chiave);
  }

  segna(chiave: string): void {
    this.scadenze.set(chiave, this.adesso() + VALIDITA_ERRATA_MS);
  }
}

interface StatoDiProcesso {
  sale: Buffer;
  ricordi: Map<string, RicordoErrate>;
}

const CHIAVE_STATO = Symbol.for("da-ipam.scanner.account-windows");

function stato(): StatoDiProcesso {
  const g = globalThis as Record<symbol, unknown>;
  if (!g[CHIAVE_STATO]) g[CHIAVE_STATO] = { sale: randomBytes(32), ricordi: new Map() } satisfies StatoDiProcesso;
  return g[CHIAVE_STATO] as StatoDiProcesso;
}

export function chiaveAccount(username: string, password: string): string {
  const impronta = createHash("sha256").update(stato().sale).update(password, "utf8").digest("hex");
  return `${utenteNormalizzato(username)}|${impronta}`;
}

export function ricordoDelTenant(tenant: string): RicordoErrate {
  const { ricordi } = stato();
  let ricordo = ricordi.get(tenant);
  if (!ricordo) {
    ricordo = new RicordoErrate();
    ricordi.set(tenant, ricordo);
  }
  return ricordo;
}
