"use client";

/**
 * «Account LDAP» delle finestre dell'Active Directory (tappa 2f credenziali,
 * T24, interfaccia punto 3): una tendina di voci «Active Directory»
 * dell'archivio e accanto «Nuova nell'archivio», che apre utente e password e
 * crea la voce «AD · <nome>» al salvataggio. Con D12 = (a), se l'indirizzo del
 * DC cambia la scelta si svuota e va rifatta: l'account di dominio non parte
 * verso un DC che nessuno ha scelto.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VoceArchivio } from "@/components/controllers/controllers-model";
import { nomeVoceAd } from "@/lib/ad/account-ldap";

/** Lo stato del campo nel modulo. */
export interface AccountLdapForm {
  credentialId: number | null;
  nuova: boolean;
  username: string;
  password: string;
}

export const ACCOUNT_LDAP_VUOTO: AccountLdapForm = { credentialId: null, nuova: false, username: "", password: "" };

/** Il campo è pronto per il salvataggio: una voce scelta, o un account nuovo completo. */
export function accountLdapCompleto(a: AccountLdapForm): boolean {
  return a.nuova ? a.username.trim() !== "" && a.password !== "" : a.credentialId !== null;
}

/** I campi dell'account per POST/PUT `/api/ad`: la voce o l'account nuovo, mai tutti e due. */
export function corpoAccountLdap(a: AccountLdapForm): { credential_id?: number; username?: string; password?: string } {
  if (a.nuova) return { username: a.username, password: a.password };
  return a.credentialId !== null ? { credential_id: a.credentialId } : {};
}

export function AccountLdapField({
  id,
  valore,
  onChange,
  voci,
  vociErrore,
  onRiprova,
  nomeIntegrazione,
  formaVecchia = false,
  dcCambiato = false,
  disabled = false,
}: {
  id: string;
  valore: AccountLdapForm;
  onChange: (patch: Partial<AccountLdapForm>) => void;
  /** Tutte le voci dell'archivio; null finché non sono caricate. */
  voci: VoceArchivio[] | null;
  vociErrore: string | null;
  onRiprova: () => void;
  nomeIntegrazione: string;
  /** Riga di prima della 2f mai convertita: senza scelta restano le colonne. */
  formaVecchia?: boolean;
  /** L'indirizzo del DC è diverso da quello salvato. */
  dcCambiato?: boolean;
  disabled?: boolean;
}) {
  const vociAd = (voci ?? []).filter((v) => v.credential_type === "ad");
  // Una voce che non è più fra quelle AD (tipo cambiato, voce tolta) non si mostra come scelta.
  const scelta = valore.credentialId !== null && vociAd.some((v) => v.id === valore.credentialId) ? valore.credentialId : null;
  const daRifare = dcCambiato && !valore.nuova && valore.credentialId === null;
  const segnaposto =
    voci === null
      ? vociErrore
        ? "Voci dell'archivio non caricate"
        : "Caricamento delle voci…"
      : formaVecchia && !dcCambiato
        ? "Account nella forma vecchia: resta finché non ne scegli uno"
        : vociAd.length === 0
          ? "Nessuna voce Active Directory nell'archivio"
          : "Scegli una voce dell'archivio";

  return (
    <div className="space-y-2">
      <label htmlFor={valore.nuova ? `${id}-user` : id} className="text-sm font-medium">
        Account LDAP
      </label>
      {valore.nuova ? (
        <div className="space-y-2 rounded-md border border-input p-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label htmlFor={`${id}-user`} className="text-[13px] text-muted-foreground">
                Utente
              </label>
              <Input
                id={`${id}-user`}
                value={valore.username}
                disabled={disabled}
                autoComplete="off"
                placeholder="Es. DOMINIO\admin o admin@example.local"
                onChange={(e) => onChange({ username: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-pass`} className="text-[13px] text-muted-foreground">
                Password
              </label>
              <Input
                id={`${id}-pass`}
                type="password"
                value={valore.password}
                disabled={disabled}
                autoComplete="new-password"
                onChange={(e) => onChange({ password: e.target.value })}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              Si salva nell&apos;archivio come «{nomeVoceAd(nomeIntegrazione || "…")}».
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => onChange({ nuova: false, username: "", password: "" })}
            >
              Scegli dall&apos;archivio
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Select
              // Finché le voci non ci sono il trigger mostrerebbe l'id grezzo: si vede il segnaposto.
              value={voci === null || scelta === null ? null : String(scelta)}
              disabled={disabled || voci === null || vociAd.length === 0}
              onValueChange={(v) => v && onChange({ credentialId: Number(v) })}
            >
              <SelectTrigger id={id} className="w-full min-w-0" aria-invalid={daRifare || undefined}>
                <SelectValue placeholder={segnaposto} />
              </SelectTrigger>
              <SelectContent className="w-auto min-w-(--anchor-width)">
                {vociAd.map((v) => (
                  <SelectItem key={v.id} value={String(v.id)}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" className="shrink-0" disabled={disabled} onClick={() => onChange({ nuova: true })}>
              Nuova nell&apos;archivio
            </Button>
          </div>
          {daRifare && (
            <p role="alert" className="text-[13px] text-destructive">
              L&apos;indirizzo del DC è cambiato: scegli di nuovo l&apos;account.
            </p>
          )}
          {vociErrore && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <span>Impossibile caricare le voci dell&apos;archivio: {vociErrore}</span>
              <Button variant="outline" size="sm" onClick={onRiprova}>
                Riprova
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
