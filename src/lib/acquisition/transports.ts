import { execFile } from "node:child_process";
import { INVENTORY_COMMANDS, isInventoryProfile } from "./device-profiles";
import { readExec } from "./exec-reader";
import type { EventEmitter } from "node:events";
import * as snmp from "net-snmp";
import type { ClientChannel } from "ssh2";
import { apriSessioneSnmp } from "../protocols/snmp-sessione";
import type { CredenzialeSnmp } from "../protocols/snmp-sessione";
import { runWinrmCommand, WinrmError } from "../devices/winrm-run";
import { SshError, withSshClient } from "../devices/ssh-transport";
import { cleanConsole } from "./parsers";
import { CATALOGO, descrittore } from "./catalogo";
import type { AcquisitionInput, AcquisitionTransports, ReadResult, SnmpRow } from "./schema";
export { QSS_COMMANDS, PROCURVE_COMMANDS, COMWARE_COMMANDS } from "./comandi";
type ConsoleProfile = AcquisitionInput['collector'];
const commandSets: Record<ConsoleProfile, readonly string[]> = Object.fromEntries(CATALOGO.map(d => [d.id, d.comandi ?? []])) as unknown as Record<ConsoleProfile, readonly string[]>;
const fail = <T>(data: T, code: string): ReadResult<T> => ({ status: "error", data, warnings: [code] });
/** Codici dopo i quali una lettura exec in serie non prova i comandi rimasti (trasporto, limiti, permessi). */
const EXEC_BATCH_STOP = ['SSH_CONNECT_FAILED', 'SSH_EXEC_TIMEOUT', 'SSH_CHANNEL_ERROR', 'SSH_EXEC_UNAVAILABLE', 'OUTPUT_LIMIT', 'PAGE_LIMIT', 'TOTAL_TIMEOUT', 'SSH_PERMISSION_DENIED', 'SSH_EXIT_STATUS_MISSING'];
/**
 * Codici che dicono la connessione guasta: dopo uno di questi il lotto non prova i comandi rimasti. Un comando che esce
 * con stato ≠ 0, manca, non ha il permesso o riempie il limite di byte è il suo problema: ha la sua lettura (`error`,
 * `unsupported`, `partial`) e il lotto continua. Un comando che scade una volta può essere solo lento (`timedatectl`
 * senza D-Bus): si ferma alla seconda scadenza di fila.
 */
export const LOTTO_GUASTO_TRASPORTO = ['SSH_CONNECT_FAILED', 'SSH_CHANNEL_ERROR', 'SSH_EXEC_UNAVAILABLE', 'TOTAL_TIMEOUT', 'LOCAL_SSH_READ_FAILED'];
export async function leggiLotto(commands: readonly string[], leggi: (command: string) => Promise<ReadResult<string>>, deadline: number, result: Record<string, ReadResult<string>> = {}): Promise<Record<string, ReadResult<string>>> {
    let fermo = false, scaduti = 0;
    for (const command of commands) {
        if (fermo || Date.now() >= deadline) {
            result[command] = fail('', fermo ? 'SSH_BATCH_ABORTED' : 'TOTAL_TIMEOUT');
            continue;
        }
        const r = await leggi(command);
        result[command] = r;
        scaduti = r.warnings.includes('SSH_EXEC_TIMEOUT') ? scaduti + 1 : 0;
        fermo = scaduti >= 2 || r.warnings.some(w => LOTTO_GUASTO_TRASPORTO.includes(w));
    }
    return result;
}
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
/** Moduli sostituibili nei test; in produzione i veri `net-snmp` e `runWinrmCommand`. */
export interface TransportDeps { snmp?: typeof snmp }
type WinrmRunner = typeof runWinrmCommand;
const WINRM_BATCH_STOP = ['WINRM_TCP_CLOSED', 'WINRM_TCP_TIMEOUT', 'WINRM_AUTH_REJECTED', 'WINRM_TIMEOUT', 'WINRM_FAILED'];
/**
 * Lettore WinRM: esegue solo script a id fisso dell'allowlist (`scripts`), uno alla volta. Gli errori del bridge
 * diventano il solo codice (`WINRM_<CODE>`), mai il messaggio grezzo; dopo un errore di rete o di autenticazione
 * gli script successivi non partono. `graceMs` (test) accorcia l'attesa oltre la scadenza totale.
 */
export function createWinrmReader(input: Pick<AcquisitionInput, 'host' | 'winrm' | 'limits'>, scripts: Readonly<Record<string, string>>, run: WinrmRunner = runWinrmCommand, totalMs?: number) {
    const deadline = Date.now() + (totalMs ?? input.limits.total_timeout_ms);
    return async (ids: readonly string[]): Promise<Record<string, ReadResult<string>>> => {
        if (ids.some(id => !Object.prototype.hasOwnProperty.call(scripts, id)))
            throw Error('COMMAND_NOT_ALLOWED');
        const w = input.winrm;
        if (!w)
            return Object.fromEntries(ids.map(id => [id, fail('', 'NO_WINRM_CREDENTIAL')]));
        const result: Record<string, ReadResult<string>> = {};
        let aborted = false;
        for (const id of ids) {
            const remaining = deadline - Date.now();
            if (aborted || remaining <= 0) {
                result[id] = fail('', aborted ? 'WINRM_BATCH_ABORTED' : 'TOTAL_TIMEOUT');
                continue;
            }
            let timer: ReturnType<typeof setTimeout> | undefined;
            try {
                const text = await Promise.race([
                    run(input.host, w.port, w.username, w.password, scripts[id], true, w.realm),
                    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('WINRM_TIMEOUT')), remaining); }),
                ]);
                result[id] = Buffer.byteLength(text) > input.limits.max_output_bytes ? fail('', 'OUTPUT_LIMIT') : { status: 'ok', data: text, warnings: [] };
            }
            catch (e) {
                result[id] = fail('', e instanceof WinrmError ? 'WINRM_' + e.code : e instanceof Error && e.message === 'WINRM_TIMEOUT' ? 'WINRM_TIMEOUT' : 'WINRM_FAILED');
            }
            finally {
                clearTimeout(timer);
            }
            aborted = result[id].warnings.some(c => WINRM_BATCH_STOP.includes(c));
        }
        return result;
    };
}
export function createTransports(input: AcquisitionInput, deps: TransportDeps = {}): AcquisitionTransports {
    const snmpModule = deps.snmp ?? snmp;
    const deadline = Date.now() + input.limits.total_timeout_ms;
    async function query(oids: string[], walk: boolean): Promise<ReadResult<SnmpRow[]>> {
        if (!input.snmp)
            return fail([], 'NO_SNMP_CREDENTIAL');
        if (Date.now() >= deadline)
            return fail([], 'TOTAL_TIMEOUT');
        return new Promise(resolve => {
            let session: import("net-snmp").Session | undefined;
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
                    if (snmpModule.isVarbindError(v)) {
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
                const cfg = input.snmp!, v3 = !('community' in cfg);
                const cred: CredenzialeSnmp = 'community' in cfg ? { forma: 'community', community: cfg.community } : { forma: 'v3', record: { username: cfg.username, securityLevel: cfg.level, authProtocol: cfg.authProtocol ?? null, authKey: cfg.authKey ?? null, privProtocol: cfg.privProtocol ?? null, privKey: cfg.privKey ?? null } };
                const opened = apriSessioneSnmp(snmpModule, input.host, cred, { versione: 'community' in cfg ? cfg.version : null, port: cfg.port, timeout: input.limits.timeout_ms, retries: 0 });
                if (!opened.ok) {
                    finish(v3 && !opened.motivo.startsWith('Sessione SNMP non aperta') ? 'SNMP_V3_OPTIONS_INVALID' : 'SNMP_OPEN_FAILED');
                    return;
                }
                session = opened.session;
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
            if (isInventoryProfile(input.collector)) {
                // Letture già fatte: se la connessione cade a lotto avviato restano, il resto prende il codice del guasto.
                const fatte: Record<string, ReadResult<string>> = {};
                const run=(conn?: Parameters<typeof readExec>[0]) => leggiLotto(commands, async command => {
                    if(conn) return readExec(conn,command,input.limits,deadline);
                    return new Promise<ReadResult<string>>(resolve=>execFile('ssh',['-n','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','--',`root@${input.host}`,command],{timeout:Math.max(1,Math.min(input.limits.timeout_ms,deadline-Date.now())),maxBuffer:input.limits.max_output_bytes},(error,stdout)=>resolve(!error?{status:'ok',data:stdout,warnings:[]}:{status:stdout?'partial':'error',data:stdout,warnings:[typeof error.code==='number'?'SSH_COMMAND_FAILED':'LOCAL_SSH_READ_FAILED']})));
                }, deadline, fatte);
                if(input.local_ssh && input.collector==='proxmox-ve') return run();
                if(!input.ssh) return Object.fromEntries(commands.map(c=>[c,fail('', 'NO_SSH_CREDENTIAL')]));
                try {return await withSshClient({host:input.host,...input.ssh,timeout:Math.max(1,Math.min(input.limits.timeout_ms,deadline-Date.now()))},conn=>run(conn));}
                catch(error) {const code=error instanceof SshError?'SSH_'+error.kind.toUpperCase():'SSH_CONNECT_FAILED';return Object.fromEntries(commands.map(c=>[c,fatte[c]??fail('', code)]));}
            }
            if (!input.ssh || Date.now() >= deadline)
                return Object.fromEntries(commands.map(c => [c, fail('', input.ssh ? 'TOTAL_TIMEOUT' : 'NO_SSH_CREDENTIAL')]));
            const modo = descrittore(input.collector).ssh_modo ?? 'console';
            if (modo === 'exec_per_comando') {
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
                    aborted = result[command].warnings.some(c => EXEC_BATCH_STOP.includes(c));
                }
                return result;
            }
            if (modo === 'exec') {
                // Una connessione sola (un login), un canale exec per comando in sequenza; dopo un errore di trasporto i
                // comandi rimasti non partono.
                try {
                    return await withSshClient({ host: input.host, ...input.ssh, timeout: Math.min(input.limits.timeout_ms, Math.max(1, deadline - Date.now())) }, async conn => {
                        return leggiLotto(commands, command => readExec(conn, command, input.limits, deadline), deadline);
                    });
                }
                catch {
                    return Object.fromEntries(commands.map(c => [c, fail('', 'SSH_CONNECT_FAILED')]));
                }
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
        }, winrm: ids => createWinrmReader(input, descrittore(input.collector).script_winrm ?? {}, runWinrmCommand, Math.max(0, deadline - Date.now()))(ids) };
}
