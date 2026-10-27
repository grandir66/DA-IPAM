/**
 * Aggiunta in blocco a LibreNMS dalla Discovery (tavola `docs/proposte/2026-10-23-librenms-esclusione-e-blocco.html`,
 * oggetti 8-9): la stessa rotta di una sola aggiunta (`POST /api/integrations/librenms/host`), un oggetto alla volta. Qui
 * la traduzione della risposta nell'esito della riga; puro, provato da `__tests__/librenms-blocco.test.ts`.
 */
export type EsitoRigaLibrenms =
  | { stato: "aggiunto"; librenms_device_id: number }
  | { stato: "gia_presente"; librenms_device_id: number }
  | { stato: "rifiutato"; motivo: string }
  | { stato: "senza_snmp"; motivo: string }
  | { stato: "errore"; motivo: string };

export function esitoRigaLibrenms(status: number, corpo: unknown): EsitoRigaLibrenms {
  const c = corpo !== null && typeof corpo === "object" ? (corpo as Record<string, unknown>) : {};
  if (status >= 200 && status < 300 && typeof c.librenms_device_id === "number") {
    return c.added === false ? { stato: "gia_presente", librenms_device_id: c.librenms_device_id } : { stato: "aggiunto", librenms_device_id: c.librenms_device_id };
  }
  const motivo = typeof c.error === "string" && c.error.trim() ? c.error : `errore ${status}`;
  if (c.codice === "senza_snmp") return { stato: "senza_snmp", motivo };
  // Un rifiuto di LibreNMS (SNMP che non risponde, già presente con altro nome, rifiuto generico): 422 col codice.
  if (status === 422 && typeof c.codice === "string" && c.codice !== "rete") return { stato: "rifiutato", motivo };
  return { stato: "errore", motivo };
}
