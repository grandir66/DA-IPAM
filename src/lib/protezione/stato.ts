/**
 * «Stato della protezione»: gli strati di difesa e le debolezze che restano, una riga ciascuno, in parole
 * semplici con gravità e rimedio (Riccardo, 25/11/2026; piano §4.8, ADR 0041). Modulo puro: ogni riga è
 * calcolata dai fatti letti sulla macchina (`raccolta.ts`). `null` in un fatto = fonte non letta: la riga dice
 * «non so», mai «a posto».
 */
export type Gravita = "alta" | "media" | "bassa";
export type Esito = "a_posto" | "da_sistemare" | "non_so";

export interface RigaStato {
  chiave: string;
  strato: string;
  esito: Esito;
  /** Due o tre parole per l'etichetta. */
  stato: string;
  /** Cosa vuol dire, in una frase. */
  parole: string;
  gravita: Gravita | null;
  rimedio: { testo: string; href?: string } | null;
}

export interface FattiStato {
  /** La tabella `inet daipam_accessi`: `assente` finché la tappa 2 non la porta. */
  filtro: "assente" | "osserva" | "acceso" | null;
  porteATutti: number | null;
  interneEsposte: number[] | null;
  nonAttribuite: number | null;
  conIpv6: number | null;
  adminTotali: number;
  adminSenzaSeconda: number;
  /** `PasswordAuthentication` di sshd. */
  sshConPassword: boolean | null;
  vaultLocale: boolean;
  /** Permessi del file con la chiave d'installazione (`.env.local`), solo i bit; `null` = non letto. */
  permessiChiave: number | null;
  credenzialiSnmpVecchio: number | null;
  firma: "blocca" | "avvisa" | "spenta";
  root: boolean | null;
  containerPrivilegiati: string[] | null;
}

const N = (n: number, uno: string, tanti: string): string => `${n} ${n === 1 ? uno : tanti}`;
const nonSo = (chiave: string, strato: string, cosa: string): RigaStato => ({
  chiave, strato, esito: "non_so", stato: "non letto", parole: `Non è stato possibile leggere ${cosa} su questa macchina.`, gravita: null, rimedio: null,
});

export function righeStato(f: FattiStato): RigaStato[] {
  const r: RigaStato[] = [];

  if (f.filtro === null || f.porteATutti === null) r.push(nonSo("filtro", "Filtro di rete", "lo stato del filtro"));
  else if (f.filtro === "acceso") r.push({ chiave: "filtro", strato: "Filtro di rete", esito: "a_posto", stato: "acceso", parole: "Alle porte arriva solo chi è negli elenchi.", gravita: null, rimedio: null });
  else r.push({
    chiave: "filtro", strato: "Filtro di rete", esito: "da_sistemare", stato: f.filtro === "osserva" ? "osserva" : "non c'è",
    parole: `Chiunque arrivi alla macchina dalla rete raggiunge ${N(f.porteATutti, "porta", "porte")}. Installazione NON protetta.`,
    gravita: "alta", rimedio: { testo: "Il filtro arriva con la prossima tappa (Chi può collegarsi)" },
  });

  if (f.interneEsposte === null) r.push(nonSo("interne", "Porte interne", "le porte in ascolto"));
  else if (f.interneEsposte.length === 0) r.push({ chiave: "interne", strato: "Porte interne", esito: "a_posto", stato: "chiuse", parole: "Le porte che servono solo dentro la macchina non rispondono da fuori.", gravita: null, rimedio: null });
  else r.push({
    chiave: "interne", strato: "Porte interne", esito: "da_sistemare", stato: "aperte",
    parole: `${f.interneEsposte.join(" e ")}: ${f.interneEsposte.length === 1 ? "serve" : "servono"} solo dentro la macchina ma ${f.interneEsposte.length === 1 ? "risponde" : "rispondono"} a tutta la rete, saltando la pagina d'accesso.`,
    gravita: "alta", rimedio: { testo: "Si chiudono dalla macchina: prepara-netbird.sh --porte-interne chiuse" },
  });

  if (f.nonAttribuite !== null && f.nonAttribuite > 0) r.push({
    chiave: "ignote", strato: "Porte non attribuite", esito: "da_sistemare", stato: `${f.nonAttribuite}`,
    parole: `${N(f.nonAttribuite, "porta risponde", "porte rispondono")} alla rete e DA-IPAM non sa di chi ${f.nonAttribuite === 1 ? "è" : "sono"}.`,
    gravita: "media", rimedio: { testo: "Vedi in Porte presentate", href: "/protezione/porte" },
  });

  if (f.adminTotali === 0) r.push(nonSo("seconda", "Seconda verifica", "gli utenti"));
  else if (f.adminSenzaSeconda === 0) r.push({ chiave: "seconda", strato: "Seconda verifica", esito: "a_posto", stato: "tutti gli admin", parole: "Ogni amministratore entra con password e codice.", gravita: null, rimedio: null });
  else r.push({
    chiave: "seconda", strato: "Seconda verifica", esito: "da_sistemare", stato: `${N(f.adminSenzaSeconda, "admin senza", "admin senza")}`,
    parole: `${N(f.adminSenzaSeconda, "amministratore entra", "amministratori entrano")} con la sola password (su ${f.adminTotali}).`,
    gravita: "alta", rimedio: { testo: "Accendila in Impostazioni › Utenti", href: "/settings?tab=utenti" },
  });

  if (f.sshConPassword === null) r.push(nonSo("ssh", "SSH", "la configurazione di sshd"));
  else if (f.sshConPassword) r.push({ chiave: "ssh", strato: "SSH", esito: "da_sistemare", stato: "accetta password", parole: "Alla macchina si entra anche con una password: si può indovinare.", gravita: "alta", rimedio: { testo: "Sulla macchina: PasswordAuthentication no" } });
  else r.push({ chiave: "ssh", strato: "SSH", esito: "a_posto", stato: "solo a chiave", parole: "Alla macchina si entra solo con una chiave. La porta però risponde a chi la raggiunge: la stringe il filtro.", gravita: null, rimedio: null });

  if (f.vaultLocale) r.push({ chiave: "chiave", strato: "Chiave delle credenziali", esito: "a_posto", stato: "vault a slot", parole: "Le credenziali dei sistemi si leggono solo dopo aver aperto il vault.", gravita: null, rimedio: null });
  else r.push({
    chiave: "chiave", strato: "Chiave delle credenziali", esito: "da_sistemare", stato: "sullo stesso disco",
    parole: "Le credenziali dei sistemi sono cifrate, ma la chiave sta in un file accanto ai dati: chi copia la macchina o un suo backup le legge.",
    gravita: "alta", rimedio: { testo: "Vault in Impostazioni › Sistema", href: "/settings/vault" },
  });

  if (f.permessiChiave === null) r.push(nonSo("permessi", "File della chiave", "i permessi del file"));
  else if ((f.permessiChiave & 0o077) === 0) r.push({ chiave: "permessi", strato: "File della chiave", esito: "a_posto", stato: "solo il proprietario", parole: "Il file con la chiave lo legge solo l'utenza del servizio.", gravita: null, rimedio: null });
  else r.push({ chiave: "permessi", strato: "File della chiave", esito: "da_sistemare", stato: `permessi ${(f.permessiChiave & 0o777).toString(8)}`, parole: "Il file con la chiave è leggibile da altre utenze della macchina.", gravita: "alta", rimedio: { testo: "Sulla macchina: chmod 600 sul file" } });

  if (f.credenzialiSnmpVecchio === null) r.push(nonSo("snmp", "Credenziali dei sistemi", "l'archivio delle credenziali"));
  else if (f.credenzialiSnmpVecchio === 0) r.push({ chiave: "snmp", strato: "Credenziali dei sistemi", esito: "a_posto", stato: "nessuna in chiaro sulla rete", parole: "Nessuna credenziale SNMP v1/v2c in archivio.", gravita: null, rimedio: null });
  else r.push({
    chiave: "snmp", strato: "Credenziali dei sistemi", esito: "da_sistemare", stato: `${f.credenzialiSnmpVecchio} SNMP v1/v2c`,
    parole: `${N(f.credenzialiSnmpVecchio, "credenziale SNMP v1/v2c", "credenziali SNMP v1/v2c")}: la community viaggia in chiaro sulla rete del cliente a ogni lettura.`,
    gravita: "media", rimedio: { testo: "Passa a SNMP v3 in Credenziali", href: "/credentials" },
  });

  if (f.firma === "blocca") r.push({ chiave: "firma", strato: "Aggiornamenti", esito: "a_posto", stato: "firmati", parole: "Sul ramo dei rilasci entra solo codice con la firma di chi può rilasciare.", gravita: null, rimedio: null });
  else r.push({ chiave: "firma", strato: "Aggiornamenti", esito: "da_sistemare", stato: f.firma === "avvisa" ? "firma: avvisa" : "firma spenta", parole: "Un aggiornamento senza firma verrebbe installato lo stesso.", gravita: "alta", rimedio: { testo: "Nel file dell'installazione: DA_INVENT_FIRMA_RILASCI=blocca" } });

  if (f.root === null) r.push(nonSo("root", "Servizio", "l'utenza del servizio"));
  else if (f.root) r.push({ chiave: "root", strato: "Servizio", esito: "da_sistemare", stato: "gira come root", parole: "Un difetto dell'applicazione vale tutta la macchina.", gravita: "media", rimedio: { testo: "In programma (piano di sicurezza del 14/11)" } });
  else r.push({ chiave: "root", strato: "Servizio", esito: "a_posto", stato: "utenza dedicata", parole: "L'applicazione non ha i poteri di root.", gravita: null, rimedio: null });

  if (f.containerPrivilegiati === null) r.push(nonSo("container", "Container", "Docker"));
  else if (f.containerPrivilegiati.length > 0) r.push({ chiave: "container", strato: "Container", esito: "da_sistemare", stato: `${f.containerPrivilegiati.length} privilegiati`, parole: `${f.containerPrivilegiati.join(", ")}: dentro hanno gli stessi poteri della macchina.`, gravita: "alta", rimedio: { testo: "Vedi in Moduli e container", href: "/protezione/moduli" } });
  else r.push({ chiave: "container", strato: "Container", esito: "a_posto", stato: "nessuno privilegiato", parole: "Nessun container ha i poteri pieni della macchina.", gravita: null, rimedio: null });

  if (f.conIpv6 !== null && f.conIpv6 > 0) r.push({ chiave: "ipv6", strato: "IPv6", esito: "da_sistemare", stato: `${N(f.conIpv6, "porta", "porte")}`, parole: `${N(f.conIpv6, "porta risponde", "porte rispondono")} anche in IPv6: un filtro solo IPv4 le lascerebbe aperte.`, gravita: "bassa", rimedio: { testo: "Il filtro copre anche IPv6" } });

  const ordine: Record<Esito, number> = { da_sistemare: 0, non_so: 1, a_posto: 2 };
  const peso: Record<Gravita, number> = { alta: 0, media: 1, bassa: 2 };
  return r.sort((a, b) => ordine[a.esito] - ordine[b.esito] || (a.gravita ? peso[a.gravita] : 9) - (b.gravita ? peso[b.gravita] : 9));
}

/** Cose che questa pagina non controlla ancora: si dicono, così «a posto» non sembra più di quel che è. */
export const NON_CONTROLLATI: readonly string[] = [
  "volume cifrato",
  "backup cifrati e ripristino provato",
  "segreti in chiaro nei file dei moduli",
  "password riusate su più apparati",
  "registro in sola aggiunta",
];
