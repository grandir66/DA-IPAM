/**
 * Correzioni proposte per le anomalie del DNS di Active Directory (passo 2, 17/11/2026).
 *
 * Una correzione è un elenco ordinato di passi elementari, solo due: «aggiungi questo record» e
 * «togli questo record esatto». Un cambio è sempre «aggiungi il nuovo, poi togli il vecchio»: se
 * si interrompe a metà resta un doppione, mai un buco. Funzioni pure: qui non si scrive niente,
 * e niente parte senza la conferma di una persona.
 *
 * Mai i record dei controller di dominio: una correzione che ne tocca uno non viene proposta.
 * «Manca la zona reverse» non ha correzione: creare una zona è un'altra operazione.
 */
import type { AnomaliaDns, HostPerDns } from "./anomalie";
import type { VoceDns, ZonaDns } from "./record";

export type TipoPassoDns = "A" | "CNAME" | "PTR";

export interface PassoDns {
  azione: "aggiungi" | "togli";
  zona: string;
  nome: string;
  tipo: TipoPassoDns;
  /** A: IPv4; PTR e CNAME: nome completo, minuscolo, senza punto finale. */
  dato: string;
}

export interface Correzione {
  /** Stabile fra una lettura e l'altra: `chiave dell'anomalia` + `#` + variante. */
  id: string;
  chiaveAnomalia: string;
  titolo: string;
  /** Nell'ordine di esecuzione: prima gli «aggiungi», poi i «togli». */
  passi: PassoDns[];
  toglieDati: boolean;
}

export interface ContestoCorrezioni {
  zone: readonly ZonaDns[];
  voci: readonly VoceDns[];
  host: readonly HostPerDns[];
  /** Zona forward dove nascono i nomi nuovi: il dominio dell'integrazione. */
  dominio: string;
  /** Controller di dominio: nomi corti in minuscolo e IP. I loro record non si toccano. */
  protetti: { nomi: ReadonlySet<string>; ip: ReadonlySet<string> };
}

const ETICHETTA = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const corto = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().split(".")[0] ?? "";

/** Zona reverse più stretta che copre l'IP, e il nome del nodo dentro quella zona. */
export function nodoPtr(ip: string, zone: readonly ZonaDns[]): { zona: string; nome: string } | null {
  const o = ip.split(".");
  if (o.length !== 4) return null;
  const candidate: [string, string][] = [
    [`${o[2]}.${o[1]}.${o[0]}.in-addr.arpa`, `${o[3]}`],
    [`${o[1]}.${o[0]}.in-addr.arpa`, `${o[3]}.${o[2]}`],
    [`${o[0]}.in-addr.arpa`, `${o[3]}.${o[2]}.${o[1]}`],
  ];
  for (const [zona, nome] of candidate) if (zone.some((z) => z.inversa && z.nome === zona)) return { zona, nome };
  return null;
}

function passoDa(v: VoceDns, azione: PassoDns["azione"]): PassoDns {
  return { azione, zona: v.zona, nome: v.nome, tipo: v.tipo as TipoPassoDns, dato: v.dato };
}

export function correzioniPer(anomalia: AnomaliaDns, ctx: ContestoCorrezioni): Correzione[] {
  const aDi = (ip: string) => ctx.voci.filter((v) => v.tipo === "A" && v.dato === ip);
  const ptrDi = (ip: string) => ctx.voci.filter((v) => v.tipo === "PTR" && v.ip === ip);
  const nuovoPtr = (ip: string, fqdn: string): PassoDns | null => {
    const n = nodoPtr(ip, ctx.zone);
    return n ? { azione: "aggiungi", zona: n.zona, nome: n.nome, tipo: "PTR", dato: fqdn } : null;
  };
  const esce: Correzione[] = [];
  const metti = (variante: string, titolo: string, passi: (PassoDns | null)[]) => {
    const veri = passi.filter((p): p is PassoDns => p !== null);
    if (veri.length === 0) return;
    const ordinati = [...veri.filter((p) => p.azione === "aggiungi"), ...veri.filter((p) => p.azione === "togli")];
    esce.push({ id: `${anomalia.chiave}#${variante}`, chiaveAnomalia: anomalia.chiave, titolo, passi: ordinati, toglieDati: ordinati.some((p) => p.azione === "togli") });
  };
  const ip = anomalia.ip;

  switch (anomalia.tipo) {
    case "a_senza_ptr":
      if (ip) for (const fqdn of anomalia.nomi) metti(`crea:${fqdn}`, `Crea il reverse verso ${fqdn}`, [nuovoPtr(ip, fqdn)]);
      break;

    case "ptr_senza_a":
      if (ip) metti("togli", "Togli il reverse rimasto senza nome", ptrDi(ip).map((v) => passoDa(v, "togli")));
      break;

    case "ptr_altro_nome":
      if (ip) for (const a of aDi(ip)) {
        metti(`cambia:${a.fqdn}`, `Cambia il reverse in ${a.fqdn}`, [nuovoPtr(ip, a.fqdn), ...ptrDi(ip).map((v) => passoDa(v, "togli"))]);
      }
      break;

    case "ip_piu_ptr":
      if (ip) for (const p of ptrDi(ip)) metti(`togli:${p.dato}`, `Togli il reverse verso ${p.dato}`, [passoDa(p, "togli")]);
      break;

    case "ip_piu_nomi":
      if (ip) for (const a of aDi(ip)) {
        metti(`togli:${a.fqdn}`, `Togli il nome ${a.fqdn}`, [passoDa(a, "togli"), ...ptrDi(ip).filter((p) => p.dato === a.fqdn).map((v) => passoDa(v, "togli"))]);
      }
      break;

    case "nome_piu_ip": {
      const fqdn = anomalia.nomi[0];
      for (const a of ctx.voci.filter((v) => v.tipo === "A" && v.fqdn === fqdn)) {
        metti(`togli:${a.dato}`, `Togli ${a.dato} da ${a.fqdn}`, [passoDa(a, "togli"), ...ptrDi(a.dato).filter((p) => p.dato === a.fqdn).map((v) => passoDa(v, "togli"))]);
      }
      break;
    }

    case "cname_rotto":
      metti("togli", "Togli l'alias", ctx.voci.filter((v) => v.tipo === "CNAME" && v.fqdn === anomalia.nomi[0]).map((v) => passoDa(v, "togli")));
      break;

    case "nome_diverso": {
      const nuovo = corto(ctx.host.find((h) => h.ip === ip)?.hostname);
      if (!ip || !ETICHETTA.test(nuovo)) break;
      for (const a of aDi(ip)) {
        const fqdn = `${nuovo}.${a.zona}`;
        if (ctx.voci.some((v) => v.tipo !== "PTR" && v.fqdn === fqdn)) continue; // quel nome c'è già: non se ne crea un secondo
        metti(`rinomina:${a.fqdn}`, `Rinomina ${a.fqdn} in ${fqdn}`, [
          { azione: "aggiungi", zona: a.zona, nome: nuovo, tipo: "A", dato: ip },
          nuovoPtr(ip, fqdn),
          passoDa(a, "togli"),
          ...ptrDi(ip).filter((p) => p.dato === a.fqdn).map((v) => passoDa(v, "togli")),
        ]);
      }
      break;
    }

    case "host_spento":
    case "ip_sconosciuto":
      if (ip) metti("togli", "Togli nome e reverse", [...aDi(ip), ...ptrDi(ip)].map((v) => passoDa(v, "togli")));
      break;

    case "host_senza_nome": {
      const nome = corto(ctx.host.find((h) => h.ip === ip)?.hostname);
      const zona = ctx.dominio.toLowerCase();
      if (!ip || !ETICHETTA.test(nome) || !ctx.zone.some((z) => !z.inversa && z.nome === zona)) break;
      const fqdn = `${nome}.${zona}`;
      if (ctx.voci.some((v) => v.tipo !== "PTR" && v.fqdn === fqdn)) break; // quel nome è già di un altro IP
      metti("crea", `Crea il nome ${fqdn}`, [{ azione: "aggiungi", zona, nome, tipo: "A", dato: ip }, nuovoPtr(ip, fqdn)]);
      break;
    }

    case "a_senza_zona_inversa":
      break;
  }

  const delDc = (p: PassoDns) =>
    ctx.protetti.nomi.has(corto(p.nome)) || ctx.protetti.nomi.has(corto(p.dato)) || ctx.protetti.ip.has(p.dato)
    || (p.tipo === "PTR" && ctx.protetti.ip.has(ipDelNodo(p)));
  return esce.filter((c) => !c.passi.some(delDc));
}

/** IP di un passo PTR, ricomposto da nodo e zona. Stringa vuota se non è un indirizzo. */
function ipDelNodo(p: PassoDns): string {
  const parti = [...p.nome.split("."), ...p.zona.replace(/\.in-addr\.arpa$/i, "").split(".")].reverse();
  return parti.length === 4 ? parti.join(".") : "";
}
