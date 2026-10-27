"use client";

import { useEffect, useRef, useState } from "react";
import { Eye } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { fetchJson } from "@/lib/fetch-json";

/** Lo stato del vault che serve alla pagina Credenziali: se «Mostra password» c'è (interruttori del vault). */
export function useMostraPasswordAttiva(admin: boolean): boolean {
  const [attiva, setAttiva] = useState(false);
  useEffect(() => {
    if (!admin) return;
    const ctrl = new AbortController();
    fetchJson<{ mostraPassword: boolean }>("/api/vault/stato", { signal: ctrl.signal })
      .then((r) => { if (r.ok) setAttiva(r.data.mostraPassword); })
      .catch(() => { /* richiesta annullata */ });
    return () => ctrl.abort();
  }, [admin]);
  return attiva;
}

const ETICHETTE: Record<string, string> = {
  username: "Utente",
  password: "Password / community / token",
  private_key: "Chiave privata",
  key_passphrase: "Passphrase della chiave",
  auth_key: "Chiave di autenticazione SNMPv3",
  priv_key: "Chiave di privacy SNMPv3",
};

type Fase = { tipo: "chiusa" } | { tipo: "codice"; errore?: string } | { tipo: "carica" } | { tipo: "valori"; campi: Record<string, string>; scade: string };

/**
 * «Mostra password» di una voce (da-vault, D2): prova a mostrare; se la conferma con la verifica in due passaggi non
 * c'è (o è scaduta) chiede il codice. I valori restano a schermo fino alla chiusura o alla fine della conferma
 * (5 minuti), poi si tolgono. Ogni visualizzazione finisce nel registro (Impostazioni › Vault).
 */
export function MostraPassword({ credentialId, nome }: { credentialId: number; nome: string }) {
  const [fase, setFase] = useState<Fase>({ tipo: "chiusa" });
  const [codice, setCodice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function chiudi() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setCodice("");
    setFase({ tipo: "chiusa" });
  }

  async function mostra() {
    setFase({ tipo: "carica" });
    const r = await fetchJson<{ campi: Record<string, string>; scade: string }>(`/api/credentials/${credentialId}/mostra`, { method: "POST" });
    if (r.ok) {
      setFase({ tipo: "valori", campi: r.data.campi, scade: r.data.scade });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(chiudi, Math.max(0, Date.parse(r.data.scade) - Date.now()));
      return;
    }
    if (r.status === 403) {
      setFase({ tipo: "codice" });
      return;
    }
    toast.error(`Errore: ${r.message}`);
    setFase({ tipo: "chiusa" });
  }

  async function conferma() {
    const r = await fetchJson<{ scade: string }>("/api/vault/conferma", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codice }),
    });
    setCodice("");
    if (!r.ok) {
      setFase({ tipo: "codice", errore: r.message });
      return;
    }
    await mostra();
  }

  return (
    <>
      <Button variant="ghost" size="icon" onClick={() => void mostra()} title="Mostra password (verifica in due passaggi)">
        <Eye className="h-4 w-4" />
      </Button>
      <Dialog open={fase.tipo !== "chiusa"} onOpenChange={(open) => { if (!open) chiudi(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mostra password · {nome}</DialogTitle>
            <DialogDescription>
              Ogni visualizzazione va nel registro con il tuo nome e l&apos;ora (Impostazioni › Vault).
            </DialogDescription>
          </DialogHeader>
          {fase.tipo === "carica" && <p className="text-sm text-muted-foreground">Un momento…</p>}
          {fase.tipo === "codice" && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void conferma();
              }}
            >
              <Label htmlFor="codice-2fa">Codice della verifica in due passaggi</Label>
              <Input
                id="codice-2fa"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={codice}
                onChange={(e) => setCodice(e.target.value.replace(/\D/g, ""))}
                autoFocus
              />
              {fase.errore && <p className="text-sm text-destructive">{fase.errore}</p>}
              <p className="text-xs text-muted-foreground">La conferma vale 5 minuti per tutte le password.</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={chiudi}>Annulla</Button>
                <Button type="submit" disabled={codice.length !== 6}>Conferma</Button>
              </div>
            </form>
          )}
          {fase.tipo === "valori" && (
            <div className="space-y-3">
              {Object.keys(fase.campi).length === 0 && <p className="text-sm text-muted-foreground">Questa voce non ha segreti salvati.</p>}
              {Object.entries(fase.campi).map(([campo, valore]) => (
                <div key={campo} className="space-y-1">
                  <Label>{ETICHETTE[campo] ?? campo}</Label>
                  <div className="flex items-start gap-2">
                    <pre className="flex-1 whitespace-pre-wrap break-all rounded-md border bg-muted px-3 py-2 font-mono text-xs">{valore}</pre>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(valore).then(
                          () => toast.success("Copiato"),
                          () => toast.error("Errore: copia non riuscita"),
                        );
                      }}
                    >
                      Copia
                    </Button>
                  </div>
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Si chiude da sola alla fine della conferma ({new Date(fase.scade).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}).
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
