/**
 * Backend `locale` di `@domarc/vault` (piano da-vault 2026-10-23, passo 5): l'appliance del cliente.
 *
 * Le credenziali dei device restano nelle tabelle di oggi (lettore unico `credentials/segreti.ts`), cifrate con la
 * chiave dei dati degli slot. Questo store tiene i segreti PROPRI dell'app che non hanno una tabella (il key file
 * dell'esportazione KeePass: «key file in un suo slot»), in `segreti.json` nella cartella dell'archivio.
 *
 * Ogni voce è AES-256-GCM con la chiave dei dati e il percorso come dato autenticato: una voce copiata sotto un altro
 * percorso, o letta con la chiave di un altro archivio, è un errore dichiarato, mai un valore vuoto. Senza chiave
 * (vault bloccato) ogni operazione è `ErroreVault("bloccato")`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { scriviAtomico } from "./archivio";
import { controllaPercorso, ErroreVault, type SecretStore, type StatoStore, type ValoreSegreto } from "./tipi";

const FILE = "segreti.json";

interface FileSegreti {
  formato: 1;
  voci: Record<string, string>;
}

export class LocaleStore implements SecretStore {
  readonly backend = "locale" as const;
  private readonly dir: string;
  private readonly chiave: () => Buffer | null;

  constructor(op: { dir: string; chiave: () => Buffer | null }) {
    this.dir = op.dir;
    this.chiave = op.chiave;
  }

  private chiaveAperta(): Buffer {
    const k = this.chiave();
    if (!k) throw new ErroreVault("bloccato", "Il vault è bloccato: i segreti dell'appliance non si leggono finché non si sblocca");
    return k;
  }

  private leggiFile(): FileSegreti {
    const p = join(this.dir, FILE);
    if (!existsSync(p)) return { formato: 1, voci: {} };
    try {
      const f = JSON.parse(readFileSync(p, "utf8")) as Partial<FileSegreti>;
      if (f.formato !== 1 || !f.voci || typeof f.voci !== "object") throw new Error("forma");
      return { formato: 1, voci: { ...f.voci } };
    } catch {
      throw new ErroreVault("archivio_rotto", "segreti.json del vault non è leggibile");
    }
  }

  private scriviFile(f: FileSegreti): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    scriviAtomico(this.dir, FILE, `${JSON.stringify(f)}\n`);
  }

  private cifra(chiave: Buffer, percorso: string, valore: ValoreSegreto): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", chiave, iv);
    c.setAAD(Buffer.from(percorso, "utf8"));
    const ct = Buffer.concat([c.update(JSON.stringify(valore), "utf8"), c.final()]);
    return `v1:${Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64")}`;
  }

  private decifra(chiave: Buffer, percorso: string, voce: string): ValoreSegreto {
    try {
      if (!voce.startsWith("v1:")) throw new Error("formato");
      const b = Buffer.from(voce.slice(3), "base64");
      const d = createDecipheriv("aes-256-gcm", chiave, b.subarray(0, 12));
      d.setAAD(Buffer.from(percorso, "utf8"));
      d.setAuthTag(b.subarray(12, 28));
      const chiaro = Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
      const v = JSON.parse(chiaro) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
      return Object.freeze(out);
    } catch {
      throw new ErroreVault("slot_estraneo", `Il segreto «${percorso}» non si apre con la chiave di questo archivio`);
    }
  }

  async get(percorso: string): Promise<ValoreSegreto> {
    controllaPercorso(percorso);
    const chiave = this.chiaveAperta();
    const voce = this.leggiFile().voci[percorso];
    if (!voce) throw new ErroreVault("non_trovato", `Il segreto «${percorso}» non c'è nell'archivio`);
    return this.decifra(chiave, percorso, voce);
  }

  async put(percorso: string, valore: ValoreSegreto): Promise<void> {
    controllaPercorso(percorso);
    const chiave = this.chiaveAperta();
    const f = this.leggiFile();
    f.voci[percorso] = this.cifra(chiave, percorso, valore);
    this.scriviFile(f);
  }

  async list(prefisso: string): Promise<string[]> {
    controllaPercorso(prefisso);
    this.chiaveAperta();
    const pref = `${prefisso}/`;
    return Object.keys(this.leggiFile().voci).filter((p) => p.startsWith(pref)).sort();
  }

  async delete(percorso: string): Promise<void> {
    controllaPercorso(percorso);
    this.chiaveAperta();
    const f = this.leggiFile();
    if (!(percorso in f.voci)) return;
    delete f.voci[percorso];
    this.scriviFile(f);
  }

  stato(): StatoStore {
    return this.chiave() ? { pronto: true, aggiornatoAlle: null } : { pronto: false, motivo: "Vault bloccato" };
  }
}
