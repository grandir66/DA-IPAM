import type { EventEmitter } from "node:events";
import * as snmp from "net-snmp";
import type { ClientChannel } from "ssh2";
import { apriSessioneCommunity } from "../protocols/snmp-sessione";
import { withSshClient } from "../devices/ssh-transport";
import { cleanConsole } from "./parsers";
import type { AcquisitionInput, AcquisitionTransports, ReadResult, SnmpRow } from "./schema";
export const QSS_COMMANDS = ["show system-information", "show interfaces status", "show interfaces", "show vlan", "show lldp neighbors", "show spanning-tree ports-summary", "show etherchannel summary", "show system temperature", "show interfaces ddm", "show mac-address-table"] as const;
const fail = <T>(data: T, code: string): ReadResult<T> => ({ status: "error", data, warnings: [code] });
export function assertCommands(commands: readonly string[]): void { if (commands.length > QSS_COMMANDS.length || commands.some(c => !(QSS_COMMANDS as readonly string[]).includes(c)))
    throw Error("COMMAND_NOT_ALLOWED"); }
/** Exported for byte-level timeout/pagination tests; never sends configuration commands. */
export function readConsole(stream: Pick<ClientChannel, "on" | "write" | "end">, commands: readonly string[], limits: AcquisitionInput['limits'], deadline: number): Promise<Record<string, ReadResult<string>>> {
    assertCommands(commands);
    return new Promise(resolve => {
        const result: Record<string, ReadResult<string>> = {};
        let buffer = '', index = -1, bytes = 0, pages = 0, prompt = '', ended = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (reason?: string) => { if (ended)
            return; ended = true; clearTimeout(timer); if (reason) {
            for (let i = Math.max(index, 0); i < commands.length; i++)
                if (!result[commands[i]])
                    result[commands[i]] = fail(i === index ? cleanConsole(buffer) : '', reason);
        } stream.end(); resolve(result); };
        const arm = () => { clearTimeout(timer); const remaining = Math.min(limits.timeout_ms, deadline - Date.now()); if (remaining <= 0) {
            finish('TOTAL_TIMEOUT');
            return;
        } timer = setTimeout(() => finish('SSH_TIMEOUT'), remaining); };
        arm();
        stream.on('data', (chunk: Buffer) => {
            if (ended)
                return;
            arm();
            if (ended)
                return;
            bytes += chunk.length;
            if (bytes > limits.max_output_bytes) {
                finish('OUTPUT_LIMIT');
                return;
            }
            buffer += chunk.toString('utf8');
            if (/--\s*More\s*--/i.test(buffer)) {
                buffer = buffer.replace(/--\s*More\s*--/gi, '');
                if (++pages > 512) {
                    finish('PAGE_LIMIT');
                    return;
                }
                stream.write(' ');
                return;
            }
            const text = cleanConsole(buffer), last = text.split('\n').at(-1)?.trim() ?? '';
            if (index === -1) {
                if (!/^[\w.:-]+[>#]$/.test(last))
                    return;
                prompt = last;
            }
            else if (last !== prompt)
                return;
            if (index >= 0) {
                const unsupported = /%\s*(?:Invalid input|Incomplete command|Unrecognized command|Unknown command)/i.test(text);
                const denied = /(?:permission denied|not authorized|authorization failed)/i.test(text);
                result[commands[index]] = { status: denied ? 'error' : unsupported ? 'unsupported' : 'ok', data: denied || unsupported ? '' : text, warnings: denied ? ['SSH_PERMISSION_DENIED'] : unsupported ? ['COMMAND_UNSUPPORTED'] : [] };
            }
            buffer = '';
            index++;
            if (index >= commands.length) {
                finish();
                return;
            }
            arm();
            if (!ended)
                stream.write(commands[index] + '\n');
        });
        stream.on('close', () => finish('SSH_CLOSED_BEFORE_PROMPT'));
        stream.on('error', () => finish('SSH_CHANNEL_ERROR'));
    });
}
export function createTransports(input: AcquisitionInput): AcquisitionTransports {
    const deadline = Date.now() + input.limits.total_timeout_ms;
    async function query(oids: string[], walk: boolean): Promise<ReadResult<SnmpRow[]>> {
        if (!input.snmp)
            return fail([], 'NO_SNMP_CREDENTIAL');
        if (Date.now() >= deadline)
            return fail([], 'TOTAL_TIMEOUT');
        return new Promise(resolve => {
            let session: ReturnType<typeof apriSessioneCommunity>;
            const rows: SnmpRow[] = [];
            let done = false, exceptions = false, bytes = 0;
            const timer = setTimeout(() => finish('SNMP_TIMEOUT'), Math.max(1, Math.min(input.limits.timeout_ms, deadline - Date.now())));
            function finish(error?: string, limited = false) { if (done)
                return; done = true; clearTimeout(timer); try {
                session?.close();
            }
            catch { /* already closed */ } resolve({ status: error ? (rows.length ? 'partial' : 'error') : limited ? 'partial' : exceptions ? (rows.length ? 'partial' : 'unsupported') : 'ok', data: rows, warnings: error ? [error] : limited ? ['ROW_OR_BYTE_LIMIT'] : exceptions ? ['SNMP_EXCEPTION'] : [] }); }
            function feed(varbinds: snmp.Varbind[]): boolean {
                if (done)
                    return true;
                for (const v of varbinds) {
                    if (snmp.isVarbindError(v)) {
                        exceptions = true;
                        continue;
                    }
                    if (rows.length >= input.limits.max_rows) {
                        finish(undefined, true);
                        return true;
                    }
                    const value = Buffer.isBuffer(v.value) ? { hex: v.value.toString('hex') } : typeof v.value === 'number' ? v.value : String(v.value);
                    const size = v.oid.length + (typeof value === 'object' ? value.hex.length : String(value).length);
                    bytes += size;
                    if (bytes > input.limits.max_output_bytes) {
                        finish(undefined, true);
                        return true;
                    }
                    rows.push({ oid: v.oid, value });
                }
                return false;
            }
            try {
                session = apriSessioneCommunity(snmp, input.host, input.snmp!.community, { versione: input.snmp!.version, port: input.snmp!.port, timeout: input.limits.timeout_ms, retries: 0 });
                (session as typeof session & Pick<EventEmitter, 'on'>).on('error', () => finish('SNMP_TRANSPORT_ERROR'));
                if (walk)
                    session.subtree(oids[0], 10, feed, e => finish(e ? 'SNMP_READ_FAILED' : undefined));
                else
                    session.get(oids, (e, v) => { if (e)
                        finish('SNMP_READ_FAILED');
                    else {
                        feed(v);
                        finish();
                    } });
            }
            catch {
                finish('SNMP_OPEN_FAILED');
            }
        });
    }
    return { get: oids => query(oids, false), walk: oid => query([oid], true), shell: async (commands) => {
            assertCommands(commands);
            if (!input.ssh || Date.now() >= deadline)
                return Object.fromEntries(commands.map(c => [c, fail('', input.ssh ? 'TOTAL_TIMEOUT' : 'NO_SSH_CREDENTIAL')]));
            try {
                return await withSshClient({ host: input.host, ...input.ssh, timeout: Math.min(input.limits.timeout_ms, Math.max(1, deadline - Date.now())) }, conn => new Promise<Record<string, ReadResult<string>>>(resolve => {
                    let opened = false;
                    const timer = setTimeout(() => { if (opened)
                        return; opened = true; conn.end(); resolve(Object.fromEntries(commands.map(c => [c, fail('', 'SSH_OPEN_TIMEOUT')]))); }, Math.max(1, Math.min(input.limits.timeout_ms, deadline - Date.now())));
                    conn.shell((err, stream) => { if (opened) {
                        stream?.end();
                        return;
                    } opened = true; clearTimeout(timer); if (err) {
                        resolve(Object.fromEntries(commands.map(c => [c, fail('', 'SSH_SHELL_UNAVAILABLE')])));
                        return;
                    } resolve(readConsole(stream, commands, input.limits, deadline)); });
                }));
            }
            catch {
                return Object.fromEntries(commands.map(c => [c, fail('', 'SSH_CONNECT_FAILED')]));
            }
        } };
}
