import Link from "next/link";
import { LinkPerBrowser } from "@/components/shared/url-per-browser";
import { parseDbDate, FUSO_UTENTI } from "@/lib/db-date";
import { STILE_STATO, type ToniStato } from "@/components/shared/stile-stato-modulo";
import type { DestinazioneRigaModulo } from "@/lib/modules/dashboard-rows";
import { statoRiquadro, tempoFa, type RigaRiquadro, type StatoRiquadro } from "@/lib/modules/riquadri-dashboard";

/**
 * Stato dei moduli in un riquadro compatto (Riccardo, 20/10): i moduli configurati a
 * riquadri piccoli coi colori dei token, i non configurati raccolti in una riga sola
 * che porta all'elenco dei moduli. Sempre visibile, senza occupare la fascia migliore.
 */
export type RiquadroDashboard = RigaRiquadro & { apre?: DestinazioneRigaModulo["apre"] };

const TONO: Record<StatoRiquadro, ToniStato> = {
  ok: "ok", attenzione: "attenzione", guasto: "guasto", da_verificare: "da_verificare", non_configurato: "grigio",
};

const TITOLO_APRE: Record<DestinazioneRigaModulo["apre"], string> = {
  modulo: "Apri il modulo",
  pagina_modulo: "Apri la pagina del modulo",
  configurazione: "Apri la configurazione del modulo",
};

export function ModuliCompatti({ riquadri }: { riquadri: RiquadroDashboard[] }) {
  const configurati = riquadri.filter((r) => statoRiquadro(r) !== "non_configurato");
  const altri = riquadri.filter((r) => statoRiquadro(r) === "non_configurato");
  return (
    <div className="flex flex-col gap-1.5">
      {configurati.length > 0 && (
        <div className="grid gap-1.5 grid-cols-2">
          {configurati.map((r) => <RiquadroModulo key={r.key} item={r} />)}
        </div>
      )}
      {altri.length > 0 && (
        <Link
          href="/settings?tab=moduli"
          className="text-[13px] text-muted-foreground hover:text-primary truncate"
          title={altri.map((r) => r.label).join(", ")}
        >
          {altri.length} non configurati: {altri.map((r) => r.label).join(", ")} →
        </Link>
      )}
    </div>
  );
}

/** Un riquadro piccolo per applicativo: nome, ultimo aggiornamento, stato dal colore (con simbolo). */
function RiquadroModulo({ item }: { item: RiquadroDashboard }) {
  const stato = statoRiquadro(item);
  const st = STILE_STATO[TONO[stato]];
  const quando = item.notaStato ?? tempoFa(item.lastSync) ?? "mai verificato";
  // Di un modulo non installato non si mostra l'esito della sonda (UI-20).
  const dettaglio = [item.label, item.contaNegliErrori !== false ? item.message : null, item.lastSync ? `Ultimo aggiornamento: ${parseDbDate(item.lastSync).toLocaleString("it-IT", { timeZone: FUSO_UTENTI })}` : null, item.apre ? TITOLO_APRE[item.apre] : null]
    .filter(Boolean).join("\n");
  return (
    <LinkPerBrowser href={item.href} title={dettaglio} className={`min-w-0 rounded-md border px-2 py-1 leading-tight hover:opacity-90 transition-opacity ${st.classi}`}>
      <span className="flex items-center gap-1 text-[13px] font-semibold">
        <span aria-hidden className="font-bold">{st.segno}</span>
        <span className="truncate">{item.label}</span>
      </span>
      <span className="block text-[13px] opacity-90 truncate">{quando}</span>
    </LinkPerBrowser>
  );
}
