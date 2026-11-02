/**
 * Un vault remoto finto, in memoria, per le prove di chi usa il vault remoto senza guardare il trasporto: il lettore
 * unico dei segreti, la «mostra password», la pausa delle scansioni, la cancellazione, la migrazione. Fa la parte di
 * `DaLinkStore` (stesso `backend`, stessa interfaccia `SecretStore` + `leggiSync`); le prove del trasporto vero (TLS,
 * gettone, versioni, 409) stanno in `dalink.test.ts` col DA-Link finto di `dalink-finto.ts`.
 *
 * - `giu = true`: ogni chiamata lancia `non_raggiungibile` e lo stato non è pronto (come DA-Link oltre la cache);
 * - `degradato`: lo stato è pronto «con la cache» col motivo;
 * - `guastaAlPut = n`: l'n-esimo `put` (da 1) mette `giu` e lancia (DA-Link che cade a metà);
 * - `chiamate`: ogni chiamata col percorso e, per la «mostra password», chi ha chiesto. Mai valori.
 */
import { ErroreVault, controllaPercorso, type OpzioniGet, type SecretStore, type StatoStore, type ValoreSegreto } from "../../tipi";

export interface ChiamataVista {
  metodo: "leggiSync" | "get" | "put" | "list" | "delete";
  percorso: string;
  perConto?: string;
  perContoId?: string;
}

export class VaultRemotoFinto implements SecretStore {
  readonly backend = "dalink" as const;
  readonly voci = new Map<string, Record<string, string>>();
  readonly chiamate: ChiamataVista[] = [];
  giu = false;
  degradato: string | null = null;
  guastaAlPut: number | null = null;
  private put_ = 0;

  constructor(voci: Record<string, Record<string, string>> = {}) {
    for (const [p, v] of Object.entries(voci)) this.voci.set(p, { ...v });
  }

  private controlla(): void {
    if (this.giu) throw new ErroreVault("non_raggiungibile", "DA-Link non risponde e la cache è scaduta");
  }

  private voce(percorso: string): ValoreSegreto {
    this.controlla();
    const v = this.voci.get(controllaPercorso(percorso));
    if (!v) throw new ErroreVault("non_trovato", `Il segreto «${percorso}» non è in DA-Link`);
    return { ...v };
  }

  leggiSync(percorso: string): ValoreSegreto {
    this.chiamate.push({ metodo: "leggiSync", percorso });
    return this.voce(percorso);
  }

  async get(percorso: string, opzioni?: OpzioniGet): Promise<ValoreSegreto> {
    this.chiamate.push({ metodo: "get", percorso, perConto: opzioni?.perConto, perContoId: opzioni?.perContoId });
    return this.voce(percorso);
  }

  async put(percorso: string, valore: ValoreSegreto): Promise<void> {
    this.chiamate.push({ metodo: "put", percorso });
    this.put_ += 1;
    if (this.guastaAlPut !== null && this.put_ === this.guastaAlPut) this.giu = true;
    this.controlla();
    this.voci.set(controllaPercorso(percorso), { ...valore });
  }

  async list(prefisso: string): Promise<string[]> {
    this.chiamate.push({ metodo: "list", percorso: prefisso });
    this.controlla();
    const pref = prefisso.endsWith("/") ? prefisso : `${prefisso}/`;
    return [...this.voci.keys()].filter((k) => k.startsWith(pref)).sort();
  }

  async delete(percorso: string): Promise<void> {
    this.chiamate.push({ metodo: "delete", percorso });
    this.controlla();
    this.voci.delete(controllaPercorso(percorso));
  }

  stato(): StatoStore {
    if (this.giu) return { pronto: false, motivo: "DA-Link non risponde e la cache è scaduta" };
    return this.degradato ? { pronto: true, aggiornatoAlle: 0, degradato: this.degradato } : { pronto: true, aggiornatoAlle: 0 };
  }
}
