"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
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
import { Pannello, TempoRelativo, VoceSelezionabile } from "@/components/shared/console";
import { ASSENTE_DOPO_GIORNI } from "@/lib/hosts/assenti";
import type { PortaCliente, RigaApparato, TipoCliente } from "@/lib/cliente/schede/apparati";

const ICONE: Record<string, LucideIcon> = {
  Camera,
  CircleHelp,
  Monitor,
  Network,
  Phone,
  Printer,
  Server,
  Smartphone,
};

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
      <ul>
        {apparati.map((apparato) => {
          const scelto = apparato.ip === ipScelto;
          return (
            <li key={apparato.ip} className="border-b last:border-b-0">
              <Link
                href={`/cliente/apparati?tipo=${tipo}&ip=${encodeURIComponent(apparato.ip)}`}
                aria-current={scelto ? "true" : undefined}
                className={`flex items-center gap-2 py-2 text-sm ${scelto ? "font-semibold" : ""}`}
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
                  <span className="ml-2 font-normal text-muted-foreground">{apparato.cosa}</span>
                </span>
                {apparato.acceso ? (
                  <span className="shrink-0 font-mono text-[13px]">{apparato.ip}</span>
                ) : apparato.assente ? (
                  <span className="shrink-0 text-[13px] text-muted-foreground">
                    {apparato.vistoIl ? (
                      <>non si vede da <TempoRelativo data={apparato.vistoIl} /></>
                    ) : (
                      <>non si vede da più di {ASSENTE_DOPO_GIORNI} giorni</>
                    )}
                  </span>
                ) : (
                  <span className="shrink-0 text-[13px] text-muted-foreground">
                    spento da <TempoRelativo data={apparato.vistoIl} />
                  </span>
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
  const bordo = porta.dorsale ? "border-2 border-foreground" : "border border-foreground/30";
  const fondo = porta.dorsale
    ? "bg-muted text-foreground"
    : porta.stato === "collegata"
      ? "bg-foreground text-background"
      : "bg-transparent text-foreground";
  const anello = scelta ? "outline outline-2 outline-offset-1 outline-foreground" : "";
  return `flex h-7 items-center justify-center rounded-sm font-mono text-[13px] ${bordo} ${fondo} ${anello}`;
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
    <Pannello
      titolo={`Porte di ${nome}`}
      sottotitolo="pieno = collegata · vuoto = libera · bordo spesso = dorsale"
    >
      <div className="space-y-3">
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
          {collegate} collegate · {libere} libere · {dorsali} dorsali
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
