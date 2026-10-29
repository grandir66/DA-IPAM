/**
 * Un DA-Link finto per le prove del backend `dalink` (piano DA-Link `2026-10-29-vault-passo6-app.md`): le quattro rotte
 * del vault di `dalink/api/vault_app.py` su 127.0.0.1, col TLS vero e un certificato autofirmato generato in memoria
 * (la sua impronta SPKI vera è in `impronta`). Nessun mock del TLS.
 *
 * Contratto riprodotto: gettone in `Authorization: Bearer` controllato per primo (401); `giu` = 503 «vault non
 * disponibile»; ambito `app/<app>/…` e `clienti/<x>/<app>/…`, fuori ambito = 404 come una voce che non c'è; versioni
 * per voce (la prima scrittura dà 1), `versione_attesa` (0 = nuova) → 409 se non torna. I corpi d'errore portano
 * `MARCA_CORPO`: le prove controllano che non finiscano nei messaggi.
 */
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { normalizzaImpronta } from "@/lib/dalink/config";
import { certificatoDiProva } from "@/lib/dalink/__tests__/support/certificato";

export const MARCA_CORPO = "corpo-della-risposta-7f3a";

export interface RichiestaVista {
  metodo: string;
  url: string;
  auth: string;
  corpo: string;
}

export interface DaLinkFinto {
  url: string;
  impronta: string;
  gettone: string;
  app: string;
  /** percorso → { valori, versione } */
  voci: Map<string, { valori: Record<string, string>; versione: number }>;
  richieste: RichiestaVista[];
  /** true = 503 a ogni chiamata (archivio chiuso). */
  giu: boolean;
  /** Risposta forzata (stato e corpo grezzo) al posto di quella delle rotte; null = le rotte. */
  forza: ((r: RichiestaVista) => { status: number; body: string } | null) | null;
  /** Mette una voce come se l'avesse scritta qualcun altro (versione +1). */
  scriviDaFuori(percorso: string, valori: Record<string, string>): void;
  chiudi(): Promise<void>;
}

function nelAmbito(app: string, p: string): boolean {
  const s = p.split("/");
  return (s[0] === "app" && s[1] === app && s.length >= 3) || (s[0] === "clienti" && s.length >= 4 && s[2] === app);
}

export async function creaDaLinkFinto(op: { gettone?: string; app?: string } = {}): Promise<DaLinkFinto> {
  const c = certificatoDiProva("da-link");
  const gettone = op.gettone ?? "dlv_" + "g".repeat(43);
  const app = op.app ?? "da-ipam";
  const voci = new Map<string, { valori: Record<string, string>; versione: number }>();
  const richieste: RichiestaVista[] = [];

  const finto: DaLinkFinto = {
    url: "",
    impronta: normalizzaImpronta(c.impronta) ?? "",
    gettone,
    app,
    voci,
    richieste,
    giu: false,
    forza: null,
    scriviDaFuori(percorso, valori) {
      voci.set(percorso, { valori: { ...valori }, versione: (voci.get(percorso)?.versione ?? 0) + 1 });
    },
    chiudi: async () => undefined,
  };

  const srv: Server = createServer({ key: c.key, cert: c.cert }, (req, res) => {
    let corpo = "";
    req.on("data", (d: Buffer) => (corpo += d.toString("utf8")));
    req.on("end", () => {
      const vista: RichiestaVista = { metodo: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization ?? ""), corpo };
      richieste.push(vista);
      const rispondi = (status: number, dati?: unknown) => {
        res.statusCode = status;
        res.setHeader("Cache-Control", "no-store");
        if (dati === undefined) {
          res.end();
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify(dati));
      };
      const forzata = finto.forza?.(vista) ?? null;
      if (forzata) {
        res.statusCode = forzata.status;
        res.setHeader("Content-Type", "application/json");
        res.end(forzata.body);
        return;
      }
      if (vista.auth !== `Bearer ${gettone}`) return rispondi(401, { detail: `gettone mancante o non valido ${MARCA_CORPO}` });
      if (finto.giu) return rispondi(503, { detail: `vault non disponibile ${MARCA_CORPO}` });
      const u = new URL(vista.url, "https://x");
      if (vista.metodo === "GET" && u.pathname === "/api/v1/vault/ambito") {
        const out: Record<string, { valori: Record<string, string>; versione: number }> = {};
        for (const [p, v] of voci) if (nelAmbito(app, p)) out[p] = v;
        return rispondi(200, { voci: out, letto_il: "2026-10-29 08:00:00" });
      }
      if (u.pathname !== "/api/v1/vault/voce") return rispondi(404, { detail: "Not Found" });
      if (vista.metodo === "PUT") {
        let s: { percorso?: unknown; valori?: unknown; versione_attesa?: unknown };
        try {
          s = JSON.parse(corpo) as typeof s;
        } catch {
          return rispondi(422, { detail: `richiesta non valida ${MARCA_CORPO}` });
        }
        const p = typeof s.percorso === "string" ? s.percorso : "";
        if (!nelAmbito(app, p)) return rispondi(404, { detail: `voce non trovata ${MARCA_CORPO}` });
        const attuale = voci.get(p)?.versione ?? 0;
        if (s.versione_attesa !== null && s.versione_attesa !== undefined && s.versione_attesa !== attuale) {
          return rispondi(409, { detail: `conflitto di versione ${MARCA_CORPO}` });
        }
        voci.set(p, { valori: { ...(s.valori as Record<string, string>) }, versione: attuale + 1 });
        return rispondi(200, { versione: attuale + 1 });
      }
      const percorsi = u.searchParams.getAll("percorso");
      if (percorsi.length !== 1) return rispondi(400, { detail: `serve un solo parametro «percorso» ${MARCA_CORPO}` });
      const p = percorsi[0];
      const voce = nelAmbito(app, p) ? voci.get(p) : undefined;
      if (vista.metodo === "GET") {
        if (!voce) return rispondi(404, { detail: `voce non trovata ${MARCA_CORPO}` });
        return rispondi(200, voce);
      }
      if (vista.metodo === "DELETE") {
        if (!voce) return rispondi(404, { detail: `voce non trovata ${MARCA_CORPO}` });
        const attesa = u.searchParams.get("versione_attesa");
        if (attesa !== null && Number(attesa) !== voce.versione) return rispondi(409, { detail: `conflitto di versione ${MARCA_CORPO}` });
        voci.delete(p);
        return rispondi(204);
      }
      return rispondi(405, { detail: "metodo" });
    });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  finto.url = `https://127.0.0.1:${port}`;
  finto.chiudi = () =>
    new Promise<void>((ok) => {
      srv.closeAllConnections();
      srv.close(() => ok());
    });
  return finto;
}
