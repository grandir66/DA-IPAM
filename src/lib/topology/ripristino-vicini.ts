/**
 * «Tornare indietro» da T1 (spec topologia §13.11.1, prova di ritorno R6). Il lettore dei vicini di T1 scrive il
 * protocollo vero (`lldp`) dove il lettore di prima scriveva sempre `mndp`. Se si torna al codice di prima e la prova R6
 * non regge (verifica del piano sul dato del 14/10: col codice di prima e `lldp` fra router dai due lati un padre
 * cambiava), queste righe tornano `mndp`, e il codice di prima vede i dati come li ha sempre visti. Solo le righe dei
 * MikroTik letti via SSH (il ramo del lettore di T1), scritte dall'ora del rilascio in poi.
 *
 * Qui si scrive solo il testo SQL: lo script lo stampa e la sessione principale lo manda all'impianto da stdin, come le
 * altre interrogazioni. Così dopo il ritorno non serve nessun file del repo sull'impianto. È una scrittura sul DB del
 * cliente: prima la prova a vuoto e la copia delle righe, e solo con la conferma di Riccardo. Logica pura.
 */
const ORA_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * Le righe da riportare a `mndp`. `dalle` è l'ora del rilascio in UTC, come la scrive il DB («AAAA-MM-GG HH:MM:SS»). Solo
 * `lldp`: il lettore di T1 scrive `lldp` o `mndp` e nient'altro (`mikrotikProtocol`). Una riga `cdp` o `unknown` sullo
 * stesso MikroTik viene dal ripiego SNMP dei vicini (router-client.ts), che c'era anche prima: non si tocca (revisione
 * finale di T1). Le righe `lldp` del ripiego invece non si distinguono da quelle del lettore.
 */
function righeDelLettoreT1(dalle: string): string {
  if (!ORA_UTC.test(dalle)) throw new Error("L'ora del rilascio va scritta «AAAA-MM-GG HH:MM:SS», in UTC.");
  return `FROM device_neighbors
 WHERE source = 'device' AND protocol = 'lldp' AND timestamp >= '${dalle}'
   AND device_id IN (SELECT id FROM network_devices WHERE LOWER(TRIM(COALESCE(vendor, ''))) = 'mikrotik' AND protocol = 'ssh')`;
}

/** Prova a vuoto: quante righe cambierebbero, per apparato e protocollo (niente nomi). */
export function sqlConta(dalle: string): string {
  return `SELECT device_id, protocol, COUNT(*) AS righe ${righeDelLettoreT1(dalle)} GROUP BY device_id, protocol ORDER BY device_id, protocol;`;
}

/** Le righe che si toccheranno, da salvare PRIMA (con `sqlite3 -cmd '.mode insert device_neighbors'` diventano INSERT). */
export function sqlCopia(dalle: string): string {
  return `SELECT * ${righeDelLettoreT1(dalle)} ORDER BY id;`;
}

/** La scrittura, in una transazione; dopo, quante righe restano da riportare (atteso 0). */
export function sqlApplica(dalle: string): string {
  return `BEGIN IMMEDIATE;
UPDATE device_neighbors SET protocol = 'mndp' WHERE id IN (SELECT id ${righeDelLettoreT1(dalle)});
SELECT changes() AS riportate;
COMMIT;
SELECT COUNT(*) AS restano ${righeDelLettoreT1(dalle)};`;
}
