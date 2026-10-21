import { readExec } from "./exec-reader";
import type { EventEmitter } from "node:events";
import * as snmp from "net-snmp";
import type { ClientChannel } from "ssh2";
import { apriSessioneCommunity } from "../protocols/snmp-sessione";
import { withSshClient } from "../devices/ssh-transport";
import { cleanConsole } from "./parsers";
import type { AcquisitionInput, AcquisitionTransports, ReadResult, SnmpRow } from "./schema";
export const QSS_COMMANDS = ["show system-information", "show interfaces status", "show interfaces", "show vlan", "show lldp neighbors", "show spanning-tree ports-summary", "show etherchannel summary", "show system temperature", "show interfaces ddm", "show mac-address-table"] as const;
export const PROCURVE_COMMANDS = ["show system", "show version", "show interfaces brief", "show vlans", "show vlans ports all detail", "show mac-address", "show trunks", "show lldp info remote-device detail", "show power-over-ethernet brief", "show spanning-tree", "show system fans", "show modules"] as const;
export const COMWARE_COMMANDS = ["display version", "display interface brief", "display vlan all", "display lldp neighbor-information verbose", "display mac-address", "display link-aggregation verbose", "display stp brief", "display stp", "display cpu-usage", "display memory", "display environment", "display fan", "display power", "display device", "display poe interface"] as const;
type ConsoleProfile = AcquisitionInput['collector'];
const commandSets = { "vmware-esxi": [] as readonly string[], "qnap-switch": QSS_COMMANDS, "hp-procurve": PROCURVE_COMMANDS, "hp-comware": COMWARE_COMMANDS };
const fail = <T>(data: T, code: string): ReadResult<T> => ({ status: "error", data, warnings: [code] });
export function assertCommands(commands: readonly string[], profile: ConsoleProfile = 'qnap-switch'): void {
    const allowed: readonly string[] = commandSets[profile];
    if (!allowed || commands.length > allowed.length || commands.some(c => !allowed.includes(c)))
        throw Error('COMMAND_NOT_ALLOWED');
}
/** Exported for byte-level timeout/pagination tests; never sends configuration commands. */
export function readConsole(stream: Pick<ClientChannel, "on" | "write" | "end">, commands: readonly string[], limits: AcquisitionInput['limits'], deadline: number, profile: ConsoleProfile = 'qnap-switch'): Promise<Record<string, ReadResult<string>>> {
    assertCommands(commands, profile);
    return new Promise(resolve => {
        const result: Record<string, ReadResult<string>> = {};
        let buffer = '', index = -1, bytes = 0, pages = 0, prompt = '', ended = false, keySent = false;
        let timer: ReturnType<typeof setTimeout>;
        const finish = (reason?: string) => {
            if (ended)
                return;
            ended = true;
            clearTimeout(timer);
            if (reason) {
                for (let i = Math.max(index, 0); i < commands.length; i++)
                    if (!result[commands[i]])
                        result[commands[i]] = fail(i === index ? cleanConsole(buffer) : '', reason);
            }
            stream.end();
            resolve(result);
        };
        const arm = () => {
            clearTimeout(timer);
            const remaining = Math.min(limits.timeout_ms, deadline - Date.now());
            if (remaining <= 0) {
                finish('TOTAL_TIMEOUT');
                return;
            }
            timer = setTimeout(() => finish('SSH_TIMEOUT'), remaining);
        };
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
            if (profile === 'hp-procurve' && index === -1 && !keySent && /Press any key to continue/i.test(cleanConsole(buffer))) {
                keySent = true;
                buffer = '';
                stream.write(' ');
                return;
            }
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
                const candidate = profile === 'hp-procurve' ? text.match(/([\w.:-]+[>#])\s*$/)?.[1] : last;
                if (!candidate || !/^[\w.:-]+[>#]$/.test(candidate))
                    return;
                prompt = candidate;
            }
            else if (profile === 'hp-procurve' ? !text.trimEnd().endsWith(prompt) : last !== prompt)
                return;
            if (index >= 0) {
                const unsupported = (profile === 'hp-procurve' ? /(?:%\s*)?(?:Invalid input|Incomplete command|Unrecognized command|Unknown command)/i : /%\s*(?:Invalid input|Incomplete command|Unrecognized command|Unknown command)/i).test(text);
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
                stream.write(commands[index] + (profile === 'hp-procurve' ? '\r' : '\n'));
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
            function finish(error?: string, limited = false) {
                if (done)
                    return;
                done = true;
                clearTimeout(timer);
                try {
                    session?.close();
                }
                catch { /* already closed */ }
                resolve({ status: error ? (rows.length ? 'partial' : 'error') : limited ? 'partial' : exceptions ? (rows.length ? 'partial' : 'unsupported') : 'ok', data: rows, warnings: error ? [error] : limited ? ['ROW_OR_BYTE_LIMIT'] : exceptions ? ['SNMP_EXCEPTION'] : [] });
            }
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
                    session.subtree(oids[0], input.collector === 'hp-comware' ? 50 : 10, feed, e => finish(e ? 'SNMP_READ_FAILED' : undefined));
                else
                    session.get(oids, (e, v) => {
                        if (e)
                            finish('SNMP_READ_FAILED');
                        else {
                            feed(v);
                            finish();
                        }
                    });
            }
            catch {
                finish('SNMP_OPEN_FAILED');
            }
        });
    }
    return { get: oids => query(oids, false), walk: oid => query([oid], true), shell: async (commands) => {
            assertCommands(commands, input.collector);
            if (!input.ssh || Date.now() >= deadline)
                return Object.fromEntries(commands.map(c => [c, fail('', input.ssh ? 'TOTAL_TIMEOUT' : 'NO_SSH_CREDENTIAL')]));
            if (input.collector === 'hp-comware') {
                const result: Record<string, ReadResult<string>> = {};
                let aborted = false;
                for (const command of commands) {
                    if (aborted || Date.now() >= deadline) {
                        result[command] = fail('', 'SSH_BATCH_ABORTED');
                        continue;
                    }
                    try {
                        result[command] = await withSshClient({ host: input.host, ...input.ssh, timeout: Math.min(input.limits.timeout_ms, Math.max(1, deadline - Date.now())) }, conn => readExec(conn, command, input.limits, deadline));
                    }
                    catch {
                        result[command] = fail('', 'SSH_CONNECT_FAILED');
                    }
                    aborted = result[command].warnings.some(c => ['SSH_CONNECT_FAILED', 'SSH_EXEC_TIMEOUT', 'SSH_CHANNEL_ERROR', 'SSH_EXEC_UNAVAILABLE', 'OUTPUT_LIMIT', 'PAGE_LIMIT', 'TOTAL_TIMEOUT', 'SSH_PERMISSION_DENIED', 'SSH_EXIT_STATUS_MISSING'].includes(c));
                }
                return result;
            }
            try {
                return await withSshClient({ host: input.host, ...input.ssh, timeout: Math.min(input.limits.timeout_ms, Math.max(1, deadline - Date.now())) }, conn => new Promise<Record<string, ReadResult<string>>>(resolve => {
                    let opened = false;
                    const timer = setTimeout(() => {
                        if (opened)
                            return;
                        opened = true;
                        conn.end();
                        resolve(Object.fromEntries(commands.map(c => [c, fail('', 'SSH_OPEN_TIMEOUT')])));
                    }, Math.max(1, Math.min(input.limits.timeout_ms, deadline - Date.now())));
                    conn.shell(input.collector === 'hp-procurve' ? { term: 'vt100', cols: 160, rows: 48 } : {}, (err, stream) => {
                        if (opened) {
                            stream?.end();
                            return;
                        }
                        opened = true;
                        clearTimeout(timer);
                        if (err) {
                            resolve(Object.fromEntries(commands.map(c => [c, fail('', 'SSH_SHELL_UNAVAILABLE')])));
                            return;
                        }
                        resolve(readConsole(stream, commands, input.limits, deadline, input.collector));
                    });
                }));
            }
            catch {
                return Object.fromEntries(commands.map(c => [c, fail('', 'SSH_CONNECT_FAILED')]));
            }
        } };
}
