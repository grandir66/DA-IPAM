/**
 * «Perché questo collegamento» in forma corta (T1b; spec topologia §13.4.6 e §13.15 punto 6): una frase per prova, con le
 * fonti di oggi, e il motivo delle righe scartate sulla coppia. Il 14/10 la domanda «perché quella porta e non il 10G?»
 * aveva la risposta solo nel codice. Logica pura, senza nomi di prodotto (prova I37): i nomi degli oggetti, le parole dei
 * protocolli e l'ora italiana li dà chi chiama.
 */
import type { LinkSource, MapLink, PassoPerche } from "@/lib/topology/model-types";

export interface ParoleFrasi {
  /** Il nome a schermo di un oggetto. */
  nome: (id: string) => string;
  /** Il protocollo dentro la frase («LLDP», «CDP», «un annuncio di rete (…)»): `dettoInFrase` di edge-look.ts. */
  detto: (fonte: LinkSource) => string;
  /** L'ora italiana di una lettura (il DB è in UTC), col giorno se non è oggi. */
  ora: (quando: string) => string;
  /** Il giorno italiano di una data del DB. */
  giorno: (quando: string) => string;
}

/** L'ordine delle frasi: chi l'ha detto a mano, chi l'ha visto, chi l'ha calcolato, chi l'ha dedotto, e infine lo scartato. */
const ORDINE: Readonly<Record<PassoPerche["tipo"], number>> = { a_mano: 0, vicino: 1, uplink: 2, tabella_mac: 3, vm: 4, scartata: 5 };
/** Un annuncio che non attraversa un apparato gestito: vale come cavo dai due capi. */
const daCavo = (f: LinkSource): boolean => f === "lldp" || f === "cdp";

export function frasiPerche(l: Pick<MapLink, "perche" | "manual">, p: ParoleFrasi): string[] {
  const N = p.nome;
  const alle = (quando: string | null, parola: string): string => (quando ? `, ${parola} alle ${p.ora(quando)}` : "");
  const out: string[] = [];
  const conCavo = new Set<string>(); // chi ha già la frase del cavo: l'altro capo la conferma
  // I nomi scelti fra gli stessi due oggetti fanno una frase sola (verifica del 15/10: sull'hub il router sente il router di
  // frontiera su dieci VLAN dai nomi scelti, e dieci frasi quasi uguali coprivano le altre).
  const scelti = new Map<string, string[]>();
  for (const x of l.perche ?? []) if (x.tipo === "scartata" && x.motivo === "nome_scelto") scelti.set(`${x.da}|${x.altro}`, [...(scelti.get(`${x.da}|${x.altro}`) ?? []), x.porta]);
  for (const x of [...(l.perche ?? [])].sort((u, v) => ORDINE[u.tipo] - ORDINE[v.tipo])) {
    switch (x.tipo) {
      case "a_mano": {
        const chi = x.utente ? ` da ${x.utente}` : "";
        const quando = x.quando ? ` il ${p.giorno(x.quando)}` : "";
        out.push(`Collegato a mano${chi}${quando}; ${l.manual?.confirmed ? "confermato dai dati" : "non visto dai dati"}.`);
        break;
      }
      case "vicino": {
        if (daCavo(x.fonte) && conCavo.has(x.altro)) {
          out.push(`${N(x.da)} vede ${N(x.altro)} sulla porta ${x.porta}: il cavo è confermato dai due capi.`);
          break;
        }
        if (daCavo(x.fonte)) conCavo.add(x.da);
        const remota = x.portaRemota ? `porta remota ${x.portaRemota}` : "porta remota non nota";
        const altre = x.altreRighe === 0 ? ""
          : `, e ${x.altreRighe === 1 ? "un'altra riga" : `altre ${x.altreRighe} righe`} di ${N(x.altro)} dalle sue VLAN o VRRP: contate una volta sola`;
        out.push(`${N(x.da)} vede ${N(x.altro)} via ${p.detto(x.fonte)} sulla porta ${x.porta} (${remota})${alle(x.visto, "letto")}${altre}.`);
        break;
      }
      case "uplink": {
        const porta = x.porta ? ` dalla porta ${x.porta}` : "";
        const stessa = x.stessaOsservazione ? `; lo calcola dall'LLDP di ${N(x.figlio)}: è la stessa osservazione, non una seconda prova` : "";
        out.push(`Il controller dice che ${N(x.figlio)} esce${porta} verso ${N(x.padre)}${stessa}.`);
        if (x.dallaRiga) out.push(`La porta di ${N(x.padre)} viene dalla stessa prova LLDP sulla porta ${x.porta}.`);
        break;
      }
      case "tabella_mac":
        out.push(x.router
          ? `Dedotto: il MAC di ${N(x.altro)} è visto sulla porta ${x.porta} del router ${N(x.da)} (tabella MAC${alle(x.visto, "letta")}): nessuno switch lo vede su una porta di bordo.`
          : `Dedotto: il MAC di ${N(x.altro)} è visto sulla porta ${x.porta} di ${N(x.da)} (tabella MAC${alle(x.visto, "letta")}).`);
        break;
      case "vm": {
        const una = x.vm === 1;
        out.push(`Dedotto: ${x.vm} ${una ? "VM accesa" : "VM accese"} di ${N(x.hypervisor)} ${una ? "è vista" : "sono viste"} sulla porta ${x.porta} di ${N(x.da)} (tabella MAC${alle(x.visto, "letta")}).`);
        break;
      }
      case "scartata":
        if (x.motivo === "segmento") out.push(`Sulla porta ${x.porta} ${N(x.da)} sente ${x.sentiti.length} apparati (${x.sentiti.map((s) => (s.nodo ? N(s.nodo) : s.nome)).join(", ")}): in mezzo c'è un apparato che non si legge (un modem, uno switch non gestito o un ponte radio).`);
        else if (x.motivo === "nome_scelto") {
          const porte = scelti.get(`${x.da}|${x.altro}`) ?? [x.porta];
          if (porte[0] !== x.porta) break; // la frase l'ha già scritta la prima porta della coppia
          if (porte.length === 1) out.push(`${N(x.da)} sente ${N(x.altro)} su ${x.porta}, un nome scelto a mano: non si sa se è una porta fisica, e una riga del router su di lei non prova un cavo.`);
          else {
            const su = porte.length === 2 ? `${porte[0]} e ${porte[1]}` : `${porte[0]}, ${porte[1]} e ${porte.length === 3 ? "un'altra interfaccia" : `altre ${porte.length - 2} interfacce`}`;
            out.push(`${N(x.da)} sente ${N(x.altro)} su ${su}, nomi scelti a mano: non si sa se sono porte fisiche, e le righe del router su di loro non provano un cavo.`);
          }
        }
        else out.push(`${N(x.da)} sente ${N(x.altro)} con ${p.detto(x.fonte)} sulla porta ${x.porta}: sono nella stessa rete, ma questo non prova un cavo.`);
        break;
    }
  }
  return out;
}
