/**
 * Accende o spegne un servizio del bridge Network Services dal browser.
 *
 * Passo 2 del piano di solidità (2026-10-16): `network-services-client.tsx` e
 * `dns-dashboard-client.tsx` avevano ognuno la sua copia, senza try/catch; con la
 * rete giù o la sessione scaduta (pagina di login al posto del JSON) l'errore
 * finiva nel vuoto e l'utente non sapeva se il servizio era cambiato. Qui una
 * funzione sola che non lancia mai: torna l'esito e il messaggio da mostrare. Lo
 * stato a schermo lo cambia solo una rilettura dello stato del bridge.
 */
import { fetchJson } from "@/lib/fetch-json";

export type ServizioRete = "resolver" | "adblock" | "dns" | "dhcp";

export interface EsitoToggle {
  ok: boolean;
  /** Pronto per un toast. */
  messaggio: string;
}

interface RispostaToggle {
  ok?: boolean;
  error?: string;
  results?: Array<{ unit: string; out?: string }>;
}

export async function toggleServizio(
  servizio: ServizioRete,
  abilita: boolean,
  etichetta: string,
): Promise<EsitoToggle> {
  const azione = abilita ? "abilitazione" : "disabilitazione";
  try {
    const r = await fetchJson<RispostaToggle>(`/api/network-services/toggle/${servizio}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enable: abilita }),
    });
    if (!r.ok) {
      return { ok: false, messaggio: `${etichetta}: ${azione} non riuscita — ${r.message}` };
    }
    if (r.data?.ok === false) {
      const dettaglio =
        r.data.error ||
        r.data.results?.map((x) => `${x.unit}: ${x.out ?? "?"}`).join(" · ") ||
        "errore sconosciuto";
      return { ok: false, messaggio: `${etichetta}: ${azione} non riuscita — ${dettaglio}` };
    }
    return { ok: true, messaggio: `${etichetta} ${abilita ? "abilitato" : "disabilitato"}` };
  } catch {
    return { ok: false, messaggio: `${etichetta}: ${azione} non riuscita — errore imprevisto` };
  }
}
