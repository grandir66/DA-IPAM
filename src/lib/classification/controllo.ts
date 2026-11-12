/**
 * Controllo della classificazione (Riccardo, 12/11/2026: «un sistema che controllasse la classificazione dei device
 * presente con quella migliore possibile»). Su DTS la classe scritta coincideva quasi sempre con quella del motore,
 * perché viene da lì: per trovare gli errori serve un giudice che non sia il motore. Qui stanno le regole
 * indipendenti; il ricalcolo lo fa chi chiama e passa il risultato in `classeRicalcolata`.
 *
 * Modulo puro, senza database. Le scelte a mano si segnalano e basta: nessuna proposta le sostituisce da sola.
 */
import { getDeviceCategoryGroup } from "@/lib/device-classifications";
import { nomeGenerico } from "@/lib/hosts/nomi-generici";
import { nomePersonale } from "@/lib/hosts/cambio-inquilino";

export type Famiglia =
  | "ricalcolo"
  | "nome_contro_classe"
  | "forma_non_funzione"
  | "sistema_non_credibile"
  | "senza_classe"
  | "stesso_apparato";

export const ETICHETTA_FAMIGLIA: Record<Famiglia, string> = {
  ricalcolo: "Il motore di oggi direbbe altro",
  nome_contro_classe: "Il nome dice una cosa, la classe un'altra",
  forma_non_funzione: "Scritto «VM», ma è un server",
  sistema_non_credibile: "Sistema operativo non credibile",
  senza_classe: "Senza classe",
  stesso_apparato: "Lo stesso apparato su tante righe",
};

export type Sicurezza = "alta" | "media" | "bassa";

export interface RigaControllo {
  id: number;
  ip: string;
  nome: string | null;
  mac: string | null;
  vendor: string | null;
  os: string | null;
  /** Porte TCP/UDP aperte lette, solo i numeri. */
  porte: readonly number[];
  classeAdesso: string | null;
  aMano: boolean;
  /** Classe che il motore scriverebbe oggi coi segnali in archivio; `undefined` = ricalcolo non fatto. */
  classeRicalcolata?: string | null;
  /** Quante righe hanno questo stesso nome (compresa questa). */
  righeStessoNome: number;
  /** Quanti MAC veri (non casuali) diversi hanno le righe con questo nome: due o più = apparati diversi, stesso modello. */
  macVeriStessoNome: number;
}

export interface Rilievo {
  famiglia: Famiglia;
  /** Classe proposta; `null` quando il controllo vede il difetto ma non sa dire la classe giusta. */
  proposta: string | null;
  motivo: string;
  sicurezza: Sicurezza;
}

const vuota = (c: string | null | undefined): boolean => !c || c === "unknown";

/** Nome corto, senza dominio. */
function corto(nome: string | null): string {
  return (nome ?? "").trim().split(".")[0];
}

const NOME_TELEFONO = /^(iphone|galaxy[\w-]*|s2\d[\w-]*|pixel[\w-]*|fairphone[\w-]*|android-[0-9a-f]+|redmi[\w-]*|oneplus[\w-]*|xiaomi[\w-]*|huawei[\w-]*)$/i;
const NOME_SERVER = /^(srv|server|dc|sql|fs|exch|veeam)[-_]?[\w-]*$/i;
/** Un nome da server vale solo se ha il trattino o una cifra: «server» da solo o «dcarlo» no. */
function nomeDaServer(nome: string | null): boolean {
  const n = corto(nome);
  return NOME_SERVER.test(n) && /^(srv|server)[-_]/i.test(n) || /^(dc|sql|fs|exch|veeam)[-_]?\d/i.test(n) || /[-_](srv|server|dc\d*)$/i.test(n);
}

/** Produttori che fanno solo (o quasi) apparati di una famiglia. Il gruppo, non la classe: il produttore non la dice. */
const PRODUTTORI: ReadonlyArray<{ re: RegExp; classe: string; cosa: string }> = [
  { re: /siemens|keyence|hms industrial|asem|estic|beckhoff|omron|rockwell|allen-bradley|schneider|phoenix contact|wago|pilz|b&r|mitsubishi electric|tosibox|ewon|weidm/i, classe: "rete_ot", cosa: "produttore di automazione" },
  { re: /espressif|tuya|shelly|sonoff|meross/i, classe: "iot", cosa: "modulo IoT" },
  { re: /yealink|snom|fanvil|grandstream|gigaset|polycom/i, classe: "voip", cosa: "produttore di telefoni VoIP" },
  { re: /routerboard|mikrotik/i, classe: "router", cosa: "MikroTik" },
  { re: /hikvision|dahua|axis communications|ge security|uniview/i, classe: "telecamera", cosa: "produttore di videosorveglianza" },
  { re: /kyocera|ricoh|brother|lexmark|zebra|epson|konica/i, classe: "stampante", cosa: "produttore di stampanti" },
];
const VENDOR_VOIP = PRODUTTORI[2].re;
const PRODUTTORE_PC = /intel corporate|dell|lenovo|hp inc|hewlett|micro-star|asustek|asrock|azurewave|liteon|realtek|giga-byte|acer/i;

const WINDOWS_VECCHIO = /windows (xp|7|vista|2000|server 2008)/i;

export function controlla(r: RigaControllo): Rilievo[] {
  const out: Rilievo[] = [];
  const nome = corto(r.nome);
  const adesso = vuota(r.classeAdesso) ? null : (r.classeAdesso as string);
  const ricalcolata = r.classeRicalcolata === undefined ? undefined : vuota(r.classeRicalcolata) ? null : r.classeRicalcolata;
  /** La classe su cui ragionano le altre regole: quella che resterebbe dopo il ricalcolo, se non è a mano. */
  const classe = r.aMano || ricalcolata === undefined ? adesso : ricalcolata;

  if (ricalcolata !== undefined && !r.aMano && ricalcolata !== adesso) {
    out.push({
      famiglia: "ricalcolo",
      proposta: ricalcolata,
      motivo: ricalcolata === null
        ? `«${adesso}» è rimasta scritta, ma coi segnali di oggi il motore non la sostiene più`
        : adesso === null
          ? "il motore di oggi la riconosce, la riga non è stata ricalcolata"
          : `il motore di oggi dice «${ricalcolata}», in archivio c'è «${adesso}»`,
      sicurezza: ricalcolata === null ? "media" : "alta",
    });
  }

  const gruppo = getDeviceCategoryGroup(classe);
  if (NOME_TELEFONO.test(nome) && classe !== "smartphone" && classe !== "tablet") {
    out.push({
      famiglia: "nome_contro_classe",
      proposta: "smartphone",
      motivo: `si chiama «${nome}»${classe ? `, ma è scritto «${classe}»` : " e non ha classe"}`,
      sicurezza: "alta",
    });
  } else if (nomePersonale(nome) && !NOME_TELEFONO.test(nome) && classe !== null && gruppo !== "postazioni" && gruppo !== "telefonia") {
    out.push({
      famiglia: "nome_contro_classe",
      proposta: null,
      motivo: `si chiama «${nome}» (nome che un apparato personale si dà da solo), ma è scritto «${classe}»`,
      sicurezza: "media",
    });
  }

  if (classe === "vm" && (nomeDaServer(r.nome) || /windows server/i.test(r.os ?? ""))) {
    out.push({
      famiglia: "forma_non_funzione",
      proposta: "server",
      motivo: nomeDaServer(r.nome)
        ? `«${nome}» è un nome da server: che sia virtuale lo dice già «Fisico o virtuale»`
        : `ha «${r.os}»: è un server, che sia virtuale lo dice già «Fisico o virtuale»`,
      sicurezza: "alta",
    });
  }

  const os = r.os ?? "";
  if (/windows/i.test(os) && VENDOR_VOIP.test(r.vendor ?? "")) {
    out.push({
      famiglia: "sistema_non_credibile",
      proposta: null,
      motivo: `«${os}» su una scheda ${r.vendor}: è un telefono, oppure la riga porta i dati del PC collegato dietro`,
      sicurezza: "media",
    });
  } else if (WINDOWS_VECCHIO.test(os) && r.porte.includes(22) && !r.porte.includes(445) && !r.porte.includes(135)) {
    out.push({
      famiglia: "sistema_non_credibile",
      proposta: null,
      motivo: `«${os}» con SSH aperto e senza le porte di Windows (135, 445): con ogni probabilità è Linux`,
      sicurezza: "media",
    });
  }

  if (classe === null && !out.some((x) => x.proposta !== null)) {
    const p = PRODUTTORI.find((x) => x.re.test(r.vendor ?? ""));
    if (p) {
      out.push({ famiglia: "senza_classe", proposta: p.classe, motivo: `${r.vendor}: ${p.cosa}`, sicurezza: "media" });
    } else if (PRODUTTORE_PC.test(r.vendor ?? "") && nome && !nomeGenerico(nome)) {
      out.push({ famiglia: "senza_classe", proposta: "workstation", motivo: `scheda ${r.vendor} e nome «${nome}»: una postazione`, sicurezza: "bassa" });
    } else {
      const manca: string[] = [];
      if (!r.mac) manca.push("nessun MAC");
      if (!r.vendor) manca.push("produttore ignoto");
      if (!nome) manca.push("nessun nome");
      if (r.porte.length === 0) manca.push("nessuna porta letta");
      out.push({
        famiglia: "senza_classe",
        proposta: null,
        motivo: manca.length > 0 ? `non si può decidere: ${manca.join(", ")}` : "ha produttore, nome e porte, ma nessuna regola li riconosce",
        sicurezza: "bassa",
      });
    }
  }

  // Lo stesso nome su tante righe è un apparato solo se non ci sono due MAC veri diversi: diciotto «SIP-T23G»
  // con diciotto MAC sono diciotto telefoni (DTS, 12/11/2026).
  if (r.righeStessoNome >= 3 && nome && !nomeGenerico(nome) && r.macVeriStessoNome <= 1) {
    out.push({
      famiglia: "stesso_apparato",
      proposta: null,
      motivo: r.macVeriStessoNome === 0
        ? `«${nome}» sta su ${r.righeStessoNome} righe, tutte con MAC casuale: sono gli indirizzi passati dello stesso apparato`
        : `«${nome}» sta su ${r.righeStessoNome} righe con un MAC solo: un apparato con più indirizzi conta una volta`,
      sicurezza: "media",
    });
  }

  return out;
}
