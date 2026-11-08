/**
 * Come si aggiorna questa installazione (09/11/2026). Sul Mac del tecnico (installa-tecnico-mac.sh di
 * Deploy-Appliance) non c'è il servizio d'aggiornamento di systemd: si aggiorna dal Terminale col
 * comando che lo script installa. Su Linux tutto resta com'era: la pagina offre «Installa».
 */
export interface ModoAggiornamento {
  applicabile: boolean;
  istruzione: string | null;
}

export function modoAggiornamento(piattaforma: NodeJS.Platform = process.platform): ModoAggiornamento {
  if (piattaforma === "darwin") {
    return {
      applicabile: false,
      istruzione: "Sul Mac DA-IPAM si aggiorna dal Terminale: sudo da-ipam-tecnico --aggiorna",
    };
  }
  return { applicabile: true, istruzione: null };
}
