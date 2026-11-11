"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Boxes,
  Camera,
  CircleCheck,
  CircleHelp,
  CircleOff,
  EyeOff,
  Monitor,
  Network,
  Phone,
  Printer,
  Server,
  Smartphone,
  type LucideIcon,
} from "lucide-react";
import { Legenda, Pannello, VoceSelezionabile } from "@/components/shared/console";
import { parseDbDate } from "@/lib/db-date";
import { daQuanto } from "@/lib/cliente/testi";
import type { PortaCliente, RigaApparato, TipoCliente } from "@/lib/cliente/schede/apparati";

const ICONE: Record<string, LucideIcon> = {
  Boxes,
  Camera,
  CircleHelp,
  Monitor,
  Network,
  Phone,
  Printer,
  Server,
  Smartphone,
};

function daQuando(vistoIl: string | null): string {
  if (!vistoIl) return "da tempo";
  return daQuanto(parseDbDate(vistoIl), new Date());
}

export function ElencoTipi({
  voci,
  scelto,
}: {
  voci: Array<{ tipo: TipoCliente; titolo: string; icona: string; conteggio: number }>;
  scelto: TipoCliente | null;
}) {
  const router = useRouter();
  return (
    <Pannello titolo="Per tipo" conteggio={voci.reduce((n, v) => n + v.conteggio, 0)}>
      {voci.length === 0 ? (
        <p className="text-sm">Nessun apparato</p>
      ) : (
        <div className="grid gap-2">
          {voci.map((voce) => {
            const Icona = ICONE[voce.icona] ?? CircleHelp;
            const grigio = voce.tipo === "non_riconosciuti";
            return (
              <VoceSelezionabile
                key={voce.tipo}
                scelta={voce.tipo === scelto}
                onScegli={() => router.push(`/cliente/apparati?tipo=${voce.tipo}`)}
                className={grigio ? "text-muted-foreground" : undefined}
              >
                <span className="flex items-center gap-2">
                  <Icona className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{voce.titolo}</span>
                  <span className="font-mono text-[13px]">{voce.conteggio}</span>
                </span>
              </VoceSelezionabile>
            );
          })}
        </div>
      )}
    </Pannello>
  );
}

export function ElencoApparati({
  tipo,
  titolo,
  apparati,
  ipScelto,
}: {
  tipo: TipoCliente;
  titolo: string;
  apparati: RigaApparato[];
  ipScelto: string | null;
}) {
  const quanti = apparati.length === 1 ? "1 apparato" : `${apparati.length} apparati`;
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">
        {titolo} · {quanti}
      </h2>
      <ul className="grid gap-1">
        {apparati.map((apparato) => {
          const scelto = apparato.ip === ipScelto;
          const quando = daQuando(apparato.vistoIl);
          return (
            <li key={apparato.ip}>
              <Link
                href={`/cliente/apparati?tipo=${tipo}&ip=${encodeURIComponent(apparato.ip)}`}
                aria-current={scelto ? "true" : undefined}
                className={`flex items-center gap-2 rounded-xl border p-3 text-sm ${scelto ? "border-primary bg-selezione font-semibold" : "border-transparent"}`}
              >
                {apparato.acceso ? (
                  <CircleCheck className="size-4 shrink-0" aria-hidden />
                ) : apparato.assente ? (
                  <EyeOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                ) : (
                  <CircleOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {apparato.nome}
                  <span className="ml-2 font-normal text-muted-foreground">{apparato.cosaBreve}</span>
                </span>
                {apparato.acceso ? (
                  <span className="shrink-0 font-mono text-[13px]">{apparato.ip}</span>
                ) : apparato.assente ? (
                  <span className="shrink-0 text-[13px] text-muted-foreground">non si vede {quando}</span>
                ) : (
                  <span className="shrink-0 text-[13px] text-muted-foreground">spento {quando}</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function classePorta(porta: PortaCliente, scelta: boolean): string {
  const fondo = porta.stato === "collegata"
    ? "bg-[var(--vc-acceso)] text-[var(--vc-su-acceso)]"
    : "border border-[var(--vc-bordo)] text-muted-foreground";
  const anello = scelta
    ? "shadow-[0_0_0_2px_var(--card),0_0_0_4px_var(--vc-giallo)]"
    : porta.dorsale
      ? "shadow-[0_0_0_2px_var(--vc-cian)]"
      : "";
  return `flex h-7 items-center justify-center rounded-sm font-mono text-[13px] ${fondo} ${anello}`;
}

function conto(n: number, uno: string, tanti: string): string {
  return `${n} ${n === 1 ? uno : tanti}`;
}

/** Pannello frontale: 12 porte per riga. */
export function PannelloPorte({
  tipo,
  ip,
  nome,
  porte,
  portaScelta,
}: {
  tipo: TipoCliente;
  ip: string;
  nome: string;
  porte: PortaCliente[];
  portaScelta: number | null;
}) {
  const collegate = porte.filter((p) => p.stato === "collegata").length;
  const dorsali = porte.filter((p) => p.dorsale).length;
  const libere = porte.length - collegate;
  const scelta = porte.find((p) => p.numero === portaScelta) ?? null;
  return (
    <Pannello titolo={`Porte di ${nome}`}>
      <div className="space-y-3">
        <Legenda
          voci={[
            { classe: "bg-[var(--vc-acceso)]", testo: "collegata" },
            { classe: "border-[var(--vc-bordo)]", testo: "libera" },
            { classe: "shadow-[0_0_0_2px_var(--vc-cian)]", testo: "dorsale" },
          ]}
        />
        <div className="grid grid-cols-12 gap-1">
          {porte.map((porta) => (
            <Link
              key={`${porta.nome}-${porta.numero}`}
              href={`/cliente/apparati?tipo=${tipo}&ip=${encodeURIComponent(ip)}&porta=${porta.numero}`}
              title={porta.nome}
              aria-label={`Porta ${porta.numero}`}
              aria-current={porta.numero === portaScelta ? "true" : undefined}
              className={classePorta(porta, porta.numero === portaScelta)}
            >
              {porta.numero}
            </Link>
          ))}
        </div>
        <p className="font-mono text-[13px] text-muted-foreground">
          {conto(collegate, "collegata", "collegate")} · {conto(libere, "libera", "libere")} · {conto(dorsali, "dorsale", "dorsali")}
        </p>
        {scelta && <DettaglioPorta porta={scelta} />}
      </div>
    </Pannello>
  );
}

function DettaglioPorta({ porta }: { porta: PortaCliente }) {
  const pezzi = [porta.stato === "collegata" ? "collegata" : "libera"];
  if (porta.velocita) pezzi.push(porta.velocita);
  if (porta.vlan != null) pezzi.push(`VLAN ${porta.vlan}`);
  return (
    <div className="space-y-1 text-sm">
      <p className="font-semibold">Porta {porta.numero}</p>
      <p>{pezzi.join(" · ")}</p>
      {porta.attaccato && (
        <p>
          Chi c&apos;è attaccato: {porta.attaccato.nome}
          {porta.attaccato.ip ? ` · ${porta.attaccato.ip}` : ""}
        </p>
      )}
      {porta.verso && <p>verso {porta.verso}</p>}
    </div>
  );
}
