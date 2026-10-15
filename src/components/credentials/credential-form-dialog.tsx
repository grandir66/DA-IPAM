"use client";

/**
 * Finestra «Nuova / Modifica credenziale», condivisa fra la pagina Credenziali
 * e il wizard di prima configurazione (tappa 4 credenziali, 15/10).
 *
 * Prima il modulo stava solo nella pagina e il wizard ne aveva uno suo, con
 * quattro blocchi fissi (una voce per tipo): la stessa voce si chiedeva più
 * volte e non tutte finivano nell'archivio. Controlli e corpi delle richieste
 * stanno in `src/lib/credentials/modulo.ts`, con le prove.
 */
import { useState } from "react";
import { toast } from "sonner";
import { BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { WinRMSetupGuideDialog } from "@/components/shared/winrm-setup-guide-dialog";
import { etichettaPrivacyV3, SNMP_V3_AUTH_PROTOCOLS, SNMP_V3_PRIV_PROTOCOLS } from "@/lib/protocols/snmp-sessione";
import { fetchJson } from "@/lib/fetch-json";
import {
  erroreModulo,
  haUtentePassword,
  opzioniConTipoAttuale,
  richiestaSalvataggio,
  segnapostoPorta,
  serveUtenteInModifica,
  statoModifica,
  type LivelloV3,
  type ModuloCredenziale,
  type OpzioneTipo,
  type StatoModulo,
  type VoceArchivio,
} from "@/lib/credentials/modulo";

/**
 * Stato del modulo per modificare una voce: lo username si legge in chiaro
 * (`?for_edit=1`, solo admin). Se la lettura non riesce lo si dice e il campo
 * resta vuoto: il salvataggio lo chiederà.
 */
export async function caricaStatoModifica(voce: VoceArchivio): Promise<StatoModulo> {
  let username = "";
  if (serveUtenteInModifica(voce)) {
    const esito = await fetchJson<{ username?: string | null }>(`/api/credentials/${voce.id}?for_edit=1`, { cache: "no-store" });
    if (esito.ok) {
      username = esito.data.username ?? "";
    } else {
      toast.error(`Utente della voce non caricato: ${esito.message}`);
    }
  }
  return statoModifica(voce, username);
}

export interface CredentialFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stato con cui si apre: `statoNuovo()` o `caricaStatoModifica(voce)`. */
  stato: StatoModulo;
  /** Tipi offerti nella tendina. */
  opzioniTipo: readonly OpzioneTipo[];
  /** Chiamata dopo un salvataggio riuscito, con la voce come la restituisce il server. */
  onSaved: (voce: VoceArchivio) => void;
}

export function CredentialFormDialog({ open, onOpenChange, stato, opzioniTipo, onSaved }: CredentialFormDialogProps) {
  const [guidaWinrm, setGuidaWinrm] = useState(false);
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {/* Su un telefono il modulo SNMPv3 authPriv è più alto dello schermo e la
            finestra è fissa: senza scorrimento titolo e «Salva» restavano fuori. */}
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{stato.editingId ? "Modifica credenziale" : "Nuova credenziale"}</DialogTitle>
          </DialogHeader>
          {/* Il contenuto si smonta alla chiusura: a ogni apertura riparte dallo stato passato. */}
          <ModuloVoce
            stato={stato}
            opzioniTipo={opzioniTipo}
            onAnnulla={() => onOpenChange(false)}
            onApriGuida={() => setGuidaWinrm(true)}
            onSalvata={(voce) => {
              onOpenChange(false);
              onSaved(voce);
            }}
          />
        </DialogContent>
      </Dialog>
      <WinRMSetupGuideDialog open={guidaWinrm} onOpenChange={setGuidaWinrm} />
    </>
  );
}

function ModuloVoce({
  stato,
  opzioniTipo,
  onAnnulla,
  onApriGuida,
  onSalvata,
}: {
  stato: StatoModulo;
  opzioniTipo: readonly OpzioneTipo[];
  onAnnulla: () => void;
  onApriGuida: () => void;
  onSalvata: (voce: VoceArchivio) => void;
}) {
  const [form, setForm] = useState<ModuloCredenziale>(stato.form);
  const [salvando, setSalvando] = useState(false);
  const { editingId, existingAuthKey, existingPrivKey } = stato;
  const opzioni = opzioniConTipoAttuale(opzioniTipo, form.credential_type);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const corrente: StatoModulo = { ...stato, form };
    const errore = erroreModulo(corrente);
    if (errore) {
      toast.error(errore);
      return;
    }
    const r = richiestaSalvataggio(corrente);
    setSalvando(true);
    try {
      const esito = await fetchJson<VoceArchivio>(r.url, {
        method: r.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(r.body),
      });
      if (!esito.ok) {
        toast.error(esito.message);
        return;
      }
      toast.success(editingId ? "Credenziale aggiornata" : "Credenziale creata");
      onSalvata(esito.data);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Nome</Label>
        <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="es. Admin MikroTik" />
      </div>
      <div>
        <Label>Tipo</Label>
        <Select value={form.credential_type} onValueChange={(v) => v && setForm((f) => ({ ...f, credential_type: String(v) }))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opzioni.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {haUtentePassword(form.credential_type) && (
        <>
          <div>
            <div className="flex items-center justify-between">
              <Label>Username</Label>
              {form.credential_type === "windows" && (
                <button
                  type="button"
                  onClick={onApriGuida}
                  className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
                  title="Guida per abilitare WinRM sul server target"
                >
                  <BookOpen className="h-3 w-3" />
                  Come abilitare WinRM?
                </button>
              )}
            </div>
            <Input
              value={form.username}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder={form.credential_type === "windows" ? "es. .\\admin (locale), DOMINIO\\utente (AD), o utente@dominio.fqdn" : "es. admin o DOMINIO\\utente"}
            />
            {form.credential_type === "windows" && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Account locale → <code>.\nomeutente</code> · Dominio AD → <code>DOMINIO\nomeutente</code> o <code>utente@dominio.fqdn</code>
              </p>
            )}
          </div>
          <div>
            <Label>Password {editingId && "(lascia vuoto per non modificare)"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
            />
          </div>
        </>
      )}
      {form.credential_type === "snmp" && (
        <>
          <div>
            <Label>Community string (SNMPv2c) {editingId && "(lascia vuoto per non modificare)"}</Label>
            <Input
              type="password"
              value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="es. public"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Non serve se sotto imposti la sicurezza SNMPv3.</p>
          </div>
          <div className="border-t pt-4">
            <Label>Sicurezza SNMPv3 (opzionale)</Label>
            <Select
              value={form.security_level || "none"}
              onValueChange={(v) => setForm((f) => ({ ...f, security_level: v === "none" ? "" : (v as LivelloV3) }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nessuna — SNMPv2c (community string)</SelectItem>
                <SelectItem value="noAuthNoPriv">SNMPv3 noAuthNoPriv</SelectItem>
                <SelectItem value="authNoPriv">SNMPv3 authNoPriv</SelectItem>
                <SelectItem value="authPriv">SNMPv3 authPriv (completo)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">Per apparati enterprise dove v2c è disabilitato per policy.</p>
          </div>
          {form.security_level && (
            <div>
              <Label htmlFor="cred-snmpv3-user">Username SNMPv3</Label>
              <Input
                id="cred-snmpv3-user"
                value={form.username}
                onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                placeholder="es. monitor"
              />
            </div>
          )}
          {(form.security_level === "authNoPriv" || form.security_level === "authPriv") && (
            <>
              <div>
                <Label>Protocollo di autenticazione</Label>
                <Select value={form.auth_protocol || undefined} onValueChange={(v) => setForm((f) => ({ ...f, auth_protocol: v ?? "" }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona protocollo" />
                  </SelectTrigger>
                  <SelectContent>
                    {SNMP_V3_AUTH_PROTOCOLS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Chiave di autenticazione {existingAuthKey && "(già impostata — lascia vuoto per non modificare)"}</Label>
                <Input
                  type="password"
                  value={form.auth_key}
                  onChange={(e) => setForm((f) => ({ ...f, auth_key: e.target.value }))}
                  placeholder={existingAuthKey ? "••••••••" : "chiave di autenticazione"}
                />
              </div>
            </>
          )}
          {form.security_level === "authPriv" && (
            <>
              <div>
                <Label>Protocollo di privacy</Label>
                <Select value={form.priv_protocol || undefined} onValueChange={(v) => setForm((f) => ({ ...f, priv_protocol: v ?? "" }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleziona protocollo" />
                  </SelectTrigger>
                  <SelectContent>
                    {SNMP_V3_PRIV_PROTOCOLS.map((p) => (
                      <SelectItem key={p} value={p}>
                        {etichettaPrivacyV3(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {form.priv_protocol === "AES192" && (
                  <p className="text-[11px] text-destructive mt-1">
                    AES192 non è supportato dalla libreria SNMP disponibile: usa AES o AES256.
                  </p>
                )}
              </div>
              <div>
                <Label>Chiave di privacy {existingPrivKey && "(già impostata — lascia vuoto per non modificare)"}</Label>
                <Input
                  type="password"
                  value={form.priv_key}
                  onChange={(e) => setForm((f) => ({ ...f, priv_key: e.target.value }))}
                  placeholder={existingPrivKey ? "••••••••" : "chiave di privacy"}
                />
              </div>
            </>
          )}
        </>
      )}
      <div>
        <Label htmlFor="cred-porta">Porta</Label>
        <Input
          id="cred-porta"
          inputMode="numeric"
          value={form.port}
          onChange={(e) => setForm((f) => ({ ...f, port: e.target.value.replace(/[^0-9]/g, "") }))}
          placeholder={segnapostoPorta(form.credential_type)}
          className="w-40"
        />
        <p className="text-[11px] text-muted-foreground mt-1">
          Vuota = porta standard. Serve per SSH su una porta diversa (es. 2022) o SNMP fuori dalla 161.
        </p>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onAnnulla}>
          Annulla
        </Button>
        <Button type="submit" disabled={salvando}>
          Salva
        </Button>
      </div>
    </form>
  );
}
