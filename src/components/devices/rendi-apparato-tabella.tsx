"use client";

/**
 * Sezione «3 Credenziale, un esito per host» della finestra «Rendi apparato» (tappa 3, 21/10):
 * una riga per host, mai un totale. Su ogni riga si può scegliere un'altra credenziale e provarla.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tipiCredenzialePerProtocollo } from "@/lib/credential-protocol-map";
import { dataBreve } from "@/lib/devices/rendi-apparato";
import type { CredenzialeArchivio, ProtocolloApparato } from "@/lib/devices/proposta-apparato";
import Link from "next/link";
import { BadgeEsito, BadgeAvviso } from "./rendi-apparato-esito";
import { esitoVisibile, tentativiFatti, type AzioniCredenziale, type EscluseHost, type RigaApparato } from "./rendi-apparato-tipi";

interface Props {
  righe: RigaApparato[];
  archivio: CredenzialeArchivio[];
  protocollo: ProtocolloApparato;
  escluse: EscluseHost;
  azioni: AzioniCredenziale;
  /** Host su cui una prova o la ricerca sta girando. */
  inCorso: ReadonlySet<number>;
  /** Ricerca automatica in corso (su qualsiasi riga): i pulsanti si fermano. */
  ricercaAttiva: boolean;
  rigaViva: string | null;
}

export function RendiApparatoTabella({ righe, archivio, protocollo, escluse, azioni, inCorso, ricercaAttiva, rigaViva }: Props) {
  const tipi = tipiCredenzialePerProtocollo(protocollo);
  const voci = archivio.filter((c) => tipi.includes(c.credential_type));
  const idDaFare = righe.filter((r) => r.creazione?.stato !== "creato" && !r.bloccata).map((r) => r.host.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {ricercaAttiva ? (
          <Button type="button" variant="outline" className="h-9" onClick={azioni.onFermaRicerca}>
            Ferma
          </Button>
        ) : (
          <Button type="button" variant="outline" className="h-9" disabled={inCorso.size > 0} onClick={() => azioni.onTrova(idDaFare)}>
            Trova in automatico su tutti
          </Button>
        )}
        <span className="text-[13px] text-muted-foreground" role="status" aria-live="polite">
          {rigaViva ?? (protocollo === "winrm"
            ? "Windows: al massimo 3 tentativi per host · ogni tentativo è un accesso fallito vero sul server"
            : "prima le validate sull'host, poi la catena della rete, poi l'archivio")}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[44rem] border-collapse text-sm">
          <thead>
            <tr className="bg-muted/50 text-left text-[13px] font-semibold text-muted-foreground">
              <th className="px-3 py-2">Host</th>
              <th className="px-3 py-2">Nome</th>
              <th className="px-3 py-2">Credenziale</th>
              <th className="px-3 py-2">Esito</th>
              <th className="px-3 py-2 text-right">Tentativi</th>
            </tr>
          </thead>
          <tbody>
            {righe.map((r) => {
              const esito = inCorso.has(r.host.id) ? { stato: "in_corso" as const } : esitoVisibile(r, protocollo, escluse, archivio);
              const fatta = r.creazione?.stato === "creato";
              if (r.bloccata) {
                return (
                  <tr key={r.host.id} className="border-t border-border align-top">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">{r.host.ip}</td>
                    <td colSpan={4} className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <BadgeAvviso>bloccato</BadgeAvviso>
                        <span className="text-[13px]">Questo IP è già dell&apos;apparato {r.bloccata.nome}</span>
                        <Link href={`/objects/${r.bloccata.host_id}`} className="text-[13px] font-semibold text-[#006C96] underline underline-offset-2 dark:text-[#3FBBF0]">
                          Apri la scheda di {r.bloccata.nome}
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              }
              const escludeHost = escluse[r.host.id] ?? {};
              return (
                <tr key={r.host.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-[13px]">{r.host.ip}</td>
                  <td className="px-3 py-2">
                    <Input className="h-8 min-w-32" aria-label={`Nome di ${r.host.ip}`} value={r.nome} disabled={fatta} onChange={(e) => azioni.onNome(r.host.id, e.target.value)} />
                    {r.creazione?.stato === "errore" && <p className="mt-1 text-[13px] font-semibold text-[#8E1B20] dark:text-[#E8625A]">✕ {r.creazione.messaggio}</p>}
                    {fatta && <p className="mt-1 text-[13px] font-semibold text-[#1F7A4D] dark:text-[#5ED3A0]">✓ Apparato creato</p>}
                  </td>
                  <td className="px-3 py-2">
                    <Select value={r.credentialId ?? "none"} onValueChange={(v) => azioni.onScegli(r.host.id, !v || v === "none" ? null : v)} disabled={fatta || inCorso.has(r.host.id)}>
                      <SelectTrigger className="h-8 w-full min-w-40 text-sm" aria-label={`Credenziale di ${r.host.ip}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {voci.map((c) => (
                          <SelectItem key={c.id} value={String(c.id)}>
                            {c.name}
                            {escludeHost[c.id] ? ` — esclusa (rifiutata il ${dataBreve(escludeHost[c.id].dal)})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <BadgeEsito esito={esito} />
                      <Button type="button" variant="outline" size="sm" disabled={fatta || !r.credentialId || inCorso.has(r.host.id) || ricercaAttiva} onClick={() => azioni.onProva(r.host.id)}>
                        Prova
                      </Button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{tentativiFatti(r.tentativi)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
