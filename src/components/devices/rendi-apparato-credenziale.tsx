"use client";

/**
 * Sezione «3 Credenziale» della finestra «Rendi apparato» per UN host (tappa 3, 21/10):
 * una dall'archivio con «Prova», oppure una nuova da salvare nell'archivio e provare,
 * oppure «Trova in automatico». L'esito sta sempre accanto al pulsante che lo ha prodotto.
 */
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { vociSnmpAggiuntive, opzioniCreazioneRapida, tipoCreazioneRapida, tipiCredenzialePerProtocollo } from "@/lib/credential-protocol-map";
import { dataBreve } from "@/lib/devices/rendi-apparato";
import type { CredenzialeArchivio, ProtocolloApparato } from "@/lib/devices/proposta-apparato";
import { BadgeEsito, eMotivoTetto, type EsitoCredenziale } from "./rendi-apparato-esito";
import { tentativiFatti, type AzioniCredenziale, type EscluseHost, type RigaApparato } from "./rendi-apparato-tipi";

export interface NuovaCredenziale {
  tipo: string;
  nome: string;
  utente: string;
  password: string;
}

interface Props {
  riga: RigaApparato;
  archivio: CredenzialeArchivio[];
  protocollo: ProtocolloApparato;
  escluse: EscluseHost;
  esito: EsitoCredenziale;
  azioni: AzioniCredenziale;
  /** Una prova o una ricerca in corso: i pulsanti si fermano. */
  occupato: boolean;
  /** Riga viva della ricerca automatica ("Cerco la credenziale su …"). */
  rigaViva: string | null;
  /** Salva la voce nuova nell'archivio, la sceglie e la prova. Risolve con il messaggio d'errore, o null se è andata. */
  onCreaEProva: (nuova: NuovaCredenziale) => Promise<string | null>;
}

export function RendiApparatoCredenziale({ riga, archivio, protocollo, escluse, esito, azioni, occupato, rigaViva, onCreaEProva }: Props) {
  const [modo, setModo] = useState<"archivio" | "nuova">("archivio");
  const opzioniTipo = opzioniCreazioneRapida(protocollo);
  const [nuova, setNuova] = useState<NuovaCredenziale>({ tipo: tipoCreazioneRapida(protocollo), nome: "", utente: "", password: "" });
  const [erroreNuova, setErroreNuova] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const tipi = tipiCredenzialePerProtocollo(protocollo);
  const voci = archivio.filter((c) => tipi.includes(c.credential_type));
  const vociSnmp = vociSnmpAggiuntive(archivio);
  const tipoCorrente = opzioniTipo.some((o) => o.value === nuova.tipo) ? nuova.tipo : tipoCreazioneRapida(protocollo);
  const eCommunity = tipoCorrente === "snmp";
  const escludeHost = escluse[riga.host.id] ?? {};
  const valore = riga.credentialId ?? "none";

  async function creaEProva() {
    setErroreNuova(null);
    setSalvando(true);
    const errore = await onCreaEProva({ ...nuova, tipo: tipoCorrente });
    setSalvando(false);
    if (errore) setErroreNuova(errore);
    else {
      setModo("archivio");
      setNuova({ tipo: tipoCreazioneRapida(protocollo), nome: "", utente: "", password: "" });
    }
  }

  const puoCreare = nuova.nome.trim() !== "" && nuova.password !== "" && (eCommunity || nuova.utente.trim() !== "");
  const fatti = tentativiFatti(riga.tentativi);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="radio" name="modo-credenziale" className="size-4 accent-[#0D2537]" checked={modo === "archivio"} onChange={() => setModo("archivio")} />
          dall&apos;archivio
        </label>
        <Select value={valore} onValueChange={(v) => azioni.onScegli(riga.host.id, !v || v === "none" ? null : v)} disabled={modo !== "archivio" || occupato}>
          <SelectTrigger className="h-9 min-w-56 text-sm" aria-label="Credenziale dall'archivio">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Nessuna</SelectItem>
            {voci.map((c) => {
              const esclusa = escludeHost[c.id];
              return (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                  {esclusa ? ` — esclusa (rifiutata il ${dataBreve(esclusa.dal)})` : ""}
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" className="h-9" disabled={modo !== "archivio" || !riga.credentialId || occupato} onClick={() => azioni.onProva(riga.host.id)}>
          Prova
        </Button>
        {modo === "archivio" && <BadgeEsito esito={esito} />}
        {modo === "archivio" && esito.stato === "rifiutata" && esito.dettaglio && <span className="text-[13px] text-muted-foreground">{esito.dettaglio}</span>}
      </div>
      {!protocollo.startsWith("snmp") && vociSnmp.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pl-6">
          <span className="text-[13px] font-semibold text-muted-foreground">SNMP aggiuntivo</span>
          <Select value={riga.snmpCredentialId ?? "none"} onValueChange={(v) => azioni.onScegliSnmp(riga.host.id, !v || v === "none" ? null : v)} disabled={occupato}>
            <SelectTrigger className="h-9 min-w-56 text-sm" aria-label="Credenziale SNMP aggiuntiva">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nessuna</SelectItem>
              {vociSnmp.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-[13px] text-muted-foreground">per leggere porte, LLDP e ARP accanto all&apos;accesso principale</span>
        </div>
      )}

      {voci.length === 0 && modo === "archivio" && (
        <p className="text-[13px] text-muted-foreground">Nell&apos;archivio non c&apos;è nessuna credenziale adatta a questo protocollo: salvane una nuova qui sotto.</p>
      )}

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="radio" name="modo-credenziale" className="size-4 accent-[#0D2537]" checked={modo === "nuova"} onChange={() => setModo("nuova")} />
          nuova nell&apos;archivio
        </label>
        {modo === "nuova" && (
          <div className="space-y-2 pl-6">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))_auto]">
              <Select value={tipoCorrente} onValueChange={(v) => v && setNuova((n) => ({ ...n, tipo: v }))}>
                <SelectTrigger className="h-9 w-full text-sm" aria-label="Tipo di credenziale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opzioniTipo.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input className="h-9" placeholder="Nome" aria-label="Nome della credenziale" value={nuova.nome} onChange={(e) => setNuova((n) => ({ ...n, nome: e.target.value }))} />
              {!eCommunity && (
                <Input className="h-9" placeholder="Utente" aria-label="Utente" autoComplete="off" value={nuova.utente} onChange={(e) => setNuova((n) => ({ ...n, utente: e.target.value }))} />
              )}
              <Input
                className="h-9"
                type="password"
                placeholder={eCommunity ? "Community" : "Password"}
                aria-label={eCommunity ? "Community" : "Password"}
                autoComplete="new-password"
                value={nuova.password}
                onChange={(e) => setNuova((n) => ({ ...n, password: e.target.value }))}
              />
              <Button type="button" variant="outline" className="h-9" disabled={!puoCreare || salvando || occupato} onClick={() => void creaEProva()}>
                {salvando ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Salva e prova
              </Button>
            </div>
            {erroreNuova && <p className="text-[13px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ {erroreNuova}</p>}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 pt-3">
        {occupato && rigaViva ? (
          <Button type="button" variant="outline" className="h-9" onClick={azioni.onFermaRicerca}>
            Ferma
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-9" disabled={occupato} onClick={() => azioni.onTrova([riga.host.id])}>
            Trova in automatico
          </Button>
        )}
        <span className="text-[13px] text-muted-foreground" role="status" aria-live="polite">
          {rigaViva ?? (protocollo === "winrm"
            ? "Windows/AD: al massimo 3 tentativi · ogni tentativo è un accesso fallito vero sul server"
            : "prima le validate sull'host, poi la catena della rete, poi l'archivio")}
        </span>
      </div>

      {riga.tentativi.length > 0 && (
        <ul className="space-y-1 text-[13px]" aria-label="Tentativi dell'ultima ricerca">
          {riga.tentativi.map((t, i) => (
            <li key={`${t.credentialId}-${i}`} className="flex flex-wrap items-center gap-2">
              <BadgeEsito esito={{ stato: t.esito, quando: t.quando, nome: t.nome, dettaglio: t.motivo, tetto: t.esito === "fermata" && eMotivoTetto(t.motivo) }} />
              {t.esito !== "esclusa" && <span className="text-muted-foreground">{t.nome}</span>}
              {t.motivo && t.esito === "rifiutata" && <span className="text-muted-foreground">— {t.motivo}</span>}
            </li>
          ))}
          {fatti > 0 && <li className="text-muted-foreground">{fatti === 1 ? "1 tentativo" : `${fatti} tentativi`}</li>}
        </ul>
      )}
    </div>
  );
}
