import type { Client, ClientChannel } from 'ssh2';
import type { AcquisitionInput, ReadResult } from './schema';
import { cleanConsole } from './parsers';
/** Messaggio di login di sshd/shell che alcuni sistemi (DSM) mandano sul canale dati: mai parte dell'uscita di un comando. */
const MESSAGGI_DI_LOGIN = /^Could not chdir to home directory[^\n]*\n?/gm;
/** Comware read-only exec. A closed channel without an exit status is never complete. */
export function readExec(conn: Pick<Client, 'exec'>, command: string, limits: AcquisitionInput['limits'], deadline: number): Promise<ReadResult<string>> {
    return new Promise(resolve => {
        let done = false, out = '', errText = '', tail = '', bytes = 0, pages = 0, stream: ClientChannel | undefined;
        const finish = (status: ReadResult<string>['status'], warnings: string[]) => { if (done)
            return; done = true; clearTimeout(timer); try {
            stream?.close();
        }
        catch { /* closed */ } resolve({ status, data: cleanConsole(out).replace(/\0/g, '').replace(MESSAGGI_DI_LOGIN, ''), warnings }); };
        const remaining = Math.min(limits.timeout_ms, deadline - Date.now());
        if (remaining <= 0) {
            resolve({ status: 'error', data: '', warnings: ['TOTAL_TIMEOUT'] });
            return;
        }
        const timer = setTimeout(() => finish('error', ['SSH_EXEC_TIMEOUT']), remaining);
        try {
            conn.exec(command, (err, channel) => {
                if (err) {
                    finish('error', ['SSH_EXEC_UNAVAILABLE']);
                    return;
                }
                if (done) {
                    channel.close();
                    return;
                }
                stream = channel;
                const receive = (chunk: Buffer, daErrore = false) => { if (done)
                    return; bytes += chunk.length; if (bytes > limits.max_output_bytes) {
                    finish('partial', ['OUTPUT_LIMIT']);
                    return;
                } if (daErrore) { errText += chunk.toString(); return; } out += chunk.toString(); tail += chunk.toString(); if (/--\s*More\s*--/i.test(tail)) {
                    tail = tail.replace(/--\s*More\s*--/gi, '');
                    if (++pages > 512) {
                        finish('partial', ['PAGE_LIMIT']);
                        return;
                    }
                    channel.write(' ');
                } };
                channel.on('data', (chunk: Buffer) => receive(chunk));
                // Lo stderr (banner e messaggi del login: «Could not chdir to home directory…») non entra mai nei dati letti; serve solo a
                // riconoscere il permesso negato.
                channel.stderr?.on('data', (chunk: Buffer) => receive(chunk, true));
                channel.on('error', () => finish('error', ['SSH_CHANNEL_ERROR']));
                channel.on('close', (code: number | undefined) => { if (done)
                    return; const unsupported = /%\s*(?:Unrecognized command|Incomplete command|Too many parameters|Wrong parameter)/i.test(out); const denied = /permission denied|not authorized|Authorization failed/i.test(out + errText); if (denied)
                    finish('error', ['SSH_PERMISSION_DENIED']);
                else if (unsupported || code === 127 || /bad command name|no such command/i.test(out))
                    finish('unsupported', ['COMMAND_UNSUPPORTED']);
                else if (code === 0)
                    finish('ok', []);
                else if (code === 127)
                    finish('unsupported', ['COMMAND_UNSUPPORTED']); // shell Unix: comando assente su questo sistema
                else if (code === undefined)
                    finish('partial', ['SSH_EXIT_STATUS_MISSING']);
                else
                    finish('error', ['SSH_COMMAND_FAILED']); });
            });
        }
        catch {
            finish('error', ['SSH_EXEC_UNAVAILABLE']);
        }
    });
}
