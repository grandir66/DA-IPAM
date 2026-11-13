"use client";

/**
 * «Metti in monitoraggio» (13/11/2026, tappa C di DATIA MONITORING): dalla scheda
 * dell'apparato a Zabbix, passando dal centro.
 *
 * Due passi, sempre: prima il centro dice **cosa farebbe** (prova a vuoto, niente scritto),
 * poi chi guarda conferma. Per Windows e Linux il centro restituisce lo script dell'agente:
 * qui si copia o si scarica, e **lo lancia una persona sulla macchina** (Riccardo, 13/11:
 * «l'install sarà sempre manuale, solo verso i sistemi monitorati»). DA-IPAM non lo esegue.
 */
import { useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Download, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogScrollableArea,
  DialogTitle,
  DIALOG_PANEL_WIDE_CLASS,
} from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";
import type { EsitoScrittura } from "@/lib/zabbix-lettura/scrittura";

type Passo = { tipo: "chiuso" } | { tipo: "attesa" } | { tipo: "anteprima"; esito: EsitoScrittura } | { tipo: "fatto"; esito: EsitoScrittura } | { tipo: "errore"; testo: string };

function frasePrima(e: EsitoScrittura): string {
  if (e.esito === "fuori_perimetro") return `Il centro lo considera fuori perimetro: ${e.motivo}`;
  if (e.esito !== "prova") return "";
  const modelli = e.template.filter((t) => t !== "ICMP Ping").join(", ") || "solo raggiungibilità (ping)";
  return e.farebbe === "serve_agente"
    ? `Verrà aggiunto come «${e.host}» con ${modelli}. Poi va installato l'agente sulla macchina: ti darò lo script.`
    : `Verrà aggiunto come «${e.host}» con ${modelli}.`;
}

function nomeFile(e: Extract<EsitoScrittura, { esito: "serve_agente" }>): string {
  return `agente-zabbix-${e.host || "apparato"}.${e.sistema === "windows" ? "ps1" : "sh"}`;
}

export function Script({ e }: { e: Extract<EsitoScrittura, { esito: "serve_agente" }> }) {
  const [copiato, setCopiato] = useState(false);
  if (!e.comando) {
    return (
      <p className="flex items-start gap-2 rounded-md border border-[#C9A800] bg-[#FFF6BF] p-3 text-sm text-[#0D2537]">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        L&apos;apparato è stato aggiunto, ma lo script non è pronto: {e.perche_senza_comando ?? "manca l'indirizzo del proxy"}.
      </p>
    );
  }
  const comando = e.comando;
  async function copia() {
    try {
      await navigator.clipboard.writeText(comando);
      setCopiato(true);
      setTimeout(() => setCopiato(false), 2000);
    } catch {
      toast.error("Copia non riuscita: selezionalo a mano");
    }
  }
  function scarica() {
    const url = URL.createObjectURL(new Blob([comando + "\n"], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFile(e);
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-2">
      <p className="text-sm">
        {e.sistema === "windows"
          ? "Sulla macchina Windows apri PowerShell con «Esegui come amministratore» e incolla questo comando."
          : "Sulla macchina Linux lancia questo comando da root (o con sudo)."}{" "}
        L&apos;agente manderà i dati a <span className="font-mono">{e.server_active}</span>: non serve aprire porte in ingresso.
      </p>
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-md border bg-muted/50 p-2 font-mono text-[12px]">{comando}</pre>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => void copia()}>
          {copiato ? <Check className="mr-1 size-4" /> : <Copy className="mr-1 size-4" />}
          {copiato ? "Copiato" : "Copia"}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={scarica}>
          <Download className="mr-1 size-4" />
          Scarica {e.sistema === "windows" ? ".ps1" : ".sh"}
        </Button>
      </div>
    </div>
  );
}

export function MettiInMonitoraggio({ hostId, nome, alFatto }: { hostId: number; nome: string; alFatto?: () => void }) {
  const [passo, setPasso] = useState<Passo>({ tipo: "chiuso" });
  const [forza, setForza] = useState(false);

  async function chiedi(prova: boolean, conForza = forza) {
    setPasso({ tipo: "attesa" });
    const r = await fetchJson<EsitoScrittura>(`/api/hosts/${hostId}/zabbix`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prova, forza: conForza }),
    });
    if (!r.ok) return setPasso({ tipo: "errore", testo: r.message });
    if (prova || r.data.esito === "fuori_perimetro") return setPasso({ tipo: "anteprima", esito: r.data });
    setPasso({ tipo: "fatto", esito: r.data });
    alFatto?.();
  }

  const aperto = passo.tipo !== "chiuso";
  return (
    <>
      <Button type="button" size="sm" variant="outline" onClick={() => void chiedi(true, false)}>
        Metti in monitoraggio
      </Button>
      <Dialog open={aperto} onOpenChange={(o) => { if (!o) { setPasso({ tipo: "chiuso" }); setForza(false); } }}>
        <DialogContent className={DIALOG_PANEL_WIDE_CLASS}>
          <DialogHeader className="shrink-0 border-b border-border/50 px-4 pt-4 pb-3">
            <DialogTitle className="text-lg">Metti in monitoraggio: {nome}</DialogTitle>
            <DialogDescription>Lo aggiunge il centro di controllo, nel gruppo di questo cliente. Non cancella e non modifica niente.</DialogDescription>
          </DialogHeader>
          <DialogScrollableArea className="space-y-3 px-4 py-3">
            {passo.tipo === "attesa" && (
              <p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" /> Chiedo al centro…</p>
            )}
            {passo.tipo === "errore" && <p className="text-sm text-[#8E1B20] dark:text-[#E8625A]">{passo.testo}</p>}
            {passo.tipo === "anteprima" && <p className="text-sm">{frasePrima(passo.esito)}</p>}
            {passo.tipo === "anteprima" && passo.esito.esito === "prova" && passo.esito.avvisi.length > 0 && (
              <ul className="list-disc pl-5 text-[13px] text-muted-foreground">{passo.esito.avvisi.map((a) => <li key={a}>{a}</li>)}</ul>
            )}
            {passo.tipo === "fatto" && passo.esito.esito === "inserito" && (
              <p className="text-sm">Aggiunto come «{passo.esito.host}». I primi dati arrivano entro qualche minuto.</p>
            )}
            {passo.tipo === "fatto" && passo.esito.esito === "gia_presente" && (
              <p className="text-sm">C&apos;era già in Zabbix come «{passo.esito.host}»: non è stato aggiunto di nuovo.</p>
            )}
            {passo.tipo === "fatto" && passo.esito.esito === "serve_agente" && (
              <>
                <p className="text-sm">Aggiunto come «{passo.esito.host}». Manca l&apos;agente: finché non lo installi, Zabbix vede solo se risponde.</p>
                <Script e={passo.esito} />
              </>
            )}
          </DialogScrollableArea>
          <DialogFooter className="border-t px-4 py-3">
            {passo.tipo === "anteprima" && passo.esito.esito === "prova" && (
              <Button type="button" onClick={() => void chiedi(false)}>Aggiungi</Button>
            )}
            {passo.tipo === "anteprima" && passo.esito.esito === "fuori_perimetro" && (
              <Button type="button" variant="outline" onClick={() => { setForza(true); void chiedi(true, true); }}>
                Aggiungilo comunque
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => { setPasso({ tipo: "chiuso" }); setForza(false); }}>
              {passo.tipo === "fatto" ? "Chiudi" : "Annulla"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
