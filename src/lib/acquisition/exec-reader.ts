import type { Client, ClientChannel } from 'ssh2';
import type { AcquisitionInput, ReadResult } from './schema';
import { cleanConsole } from './parsers';
/** Comware read-only exec. A closed channel without an exit status is never complete. */
export function readExec(conn: Pick<Client, 'exec'>, command: string, limits: AcquisitionInput['limits'], deadline: number): Promise<ReadResult<string>> {
    return new Promise(resolve => {
        let done = false, out = '', tail = '', bytes = 0, pages = 0, stream: ClientChannel | undefined;
        const finish = (status: ReadResult<string>['status'], warnings: string[]) => { if (done)
            return; done = true; clearTimeout(timer); try {
            stream?.close();
        }
        catch { /* closed */ } resolve({ status, data: cleanConsole(out).replace(/\0/g, ''), warnings }); };
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
                const receive = (chunk: Buffer) => { if (done)
                    return; bytes += chunk.length; if (bytes > limits.max_output_bytes) {
                    finish('partial', ['OUTPUT_LIMIT']);
                    return;
                } out += chunk.toString(); tail += chunk.toString(); if (/--\s*More\s*--/i.test(tail)) {
                    tail = tail.replace(/--\s*More\s*--/gi, '');
                    if (++pages > 512) {
                        finish('partial', ['PAGE_LIMIT']);
                        return;
                    }
                    channel.write(' ');
                } };
                channel.on('data', receive);
                channel.stderr?.on('data', receive);
                channel.on('error', () => finish('error', ['SSH_CHANNEL_ERROR']));
                channel.on('close', (code: number | undefined) => { if (done)
                    return; const unsupported = /%\s*(?:Unrecognized command|Incomplete command|Too many parameters|Wrong parameter)/i.test(out); const denied = /permission denied|not authorized|Authorization failed/i.test(out); if (denied)
                    finish('error', ['SSH_PERMISSION_DENIED']);
                else if (unsupported || code === 127 || /bad command name|no such command/i.test(out))
                    finish('unsupported', ['COMMAND_UNSUPPORTED']);
                else if (code === 0)
                    finish('ok', []);
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
