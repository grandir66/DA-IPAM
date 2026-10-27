import {campiTerse,righeDiUscita} from '../devices/mikrotik-vicini';
import {textValue} from './parsers';
import type {SnmpRow} from './schema';
export type InventoryRecord=Record<string,string|number|boolean|null>;
export function parseJson(text:string):unknown {try{return JSON.parse(text);}catch{return null;}}
export function records(value:unknown):Record<string,unknown>[] {return Array.isArray(value)?value.filter((r):r is Record<string,unknown>=>!!r&&typeof r==='object'&&!Array.isArray(r)):[];}
export function pick(row:Record<string,unknown>,keys:readonly string[]):InventoryRecord {return Object.fromEntries(keys.filter(k=>row[k]===null||['string','number','boolean'].includes(typeof row[k])).map(k=>[k,row[k] as string|number|boolean|null]));}
export function terse(text:string):InventoryRecord[] {const allowed=['name','default-name','type','mtu','actual-mtu','mac-address','address','network','interface','disabled','running','comment','bridge','pvid','vlan-ids','tagged','untagged','current-tagged','current-untagged','vlan-filtering','protocol-mode','priority','hw','horizon','bonding','mode','slaves','lacp-rate','transmit-hash-policy','dst-address','gateway','distance','routing-table','active','ssid','band','channel-width','frequency','master-interface','configuration.mode','configuration.ssid','radio-mac'];return righeDiUscita(text).map(r=>pick(Object.fromEntries(campiTerse(r)),allowed)).filter(r=>Object.keys(r).length>0);}
export function colonValues(text:string):Record<string,string>{return Object.fromEntries(text.split(/\r?\n/).map(l=>l.match(/^\s*([\w-]+):\s*(.*?)\s*$/)).filter((m):m is RegExpMatchArray=>!!m).map(m=>[m[1],m[2]]));}
export function parseDf(text:string):InventoryRecord[]{return text.split(/\r?\n/).flatMap(l=>{const m=l.match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);return m?[{filesystem:m[1],size_bytes:(BigInt(m[2])*BigInt(1024)).toString(),used_bytes:(BigInt(m[3])*BigInt(1024)).toString(),available_bytes:(BigInt(m[4])*BigInt(1024)).toString(),mountpoint:m[6]}]:[];});}
/** Preserve original columns; vendor capacity units are not guessed from legacy GB conversions. */
export function snmpTable(rows:SnmpRow[],root:string,columns:Record<string,string>):InventoryRecord[]{const map=new Map<string,InventoryRecord>();for(const row of rows){if(!row.oid.startsWith(root+'.'))continue;const [column,...suffix]=row.oid.slice(root.length+1).split('.');if(!columns[column]||!suffix.length)continue;const key=suffix.join('.');const r=map.get(key)??{index:key};r[columns[column]]=textValue(row.value);map.set(key,r);}return [...map.values()];}
export function linuxAddresses(text:string):InventoryRecord[]{return records(parseJson(text)).flatMap(r=>records(r.addr_info).filter(a=>a.family==='inet'||a.family==='inet6').map(a=>({...pick(a,['family','local','prefixlen','scope']),interface:typeof r.ifname==='string'?r.ifname:null,if_index:typeof r.ifindex==='number'?r.ifindex:null})));}
export function parseRead(command:string,text:string):InventoryRecord[]{
 if(command.includes(' print terse'))return terse(text);
 if(command==='df -P -k')return parseDf(text);
 if(command.includes('pvesh get /cluster/resources'))return records(parseJson(text)).map(r=>pick(r,['id','type','node','vmid','name','status','cpu','maxcpu','mem','maxmem','disk','maxdisk','uptime','storage','content','shared','pool','hastate','template','tags']));
 if(command.includes('pvesh get '))return records(parseJson(text)).map(r=>pick(r,['id','name','node','type','status','online','quorate','level','ip','local','nodes','version','cpu','maxcpu','mem','maxmem','disk','maxdisk','uptime']));
 if(command.includes('ip -j address'))return linuxAddresses(text);
 if(command.includes('link show'))return records(parseJson(text)).map(r=>({...pick(r,['ifindex','ifname','mtu','address','operstate','master','link_index']),link_kind:typeof (r.linkinfo as Record<string,unknown>|undefined)?.info_kind==='string'?(r.linkinfo as Record<string,unknown>).info_kind as string:null}));
 if(command.includes('neighbor show'))return records(parseJson(text)).map(r=>pick(r,['dst','dev','lladdr','state']));
 if(command.startsWith('lsblk')){const obj=parseJson(text) as {blockdevices?:unknown}|null;const out:InventoryRecord[]=[];const walk=(rows:unknown,parent:string|null)=>{for(const r of records(rows)){const p=pick(r,['name','type','size','model','serial','rota']);p.parent=parent;out.push(p);walk(r.children,typeof r.name==='string'?r.name:null);}};walk(obj?.blockdevices,null);return out;}
 if(command==='cat /proc/meminfo')return text.split(/\r?\n/).flatMap(l=>{const m=l.match(/^(MemTotal|MemFree|MemAvailable|SwapTotal|SwapFree):\s+(\d+) kB$/);return m?[{name:m[1],size_bytes:(BigInt(m[2])*BigInt(1024)).toString()}]:[];});
 if(command==='cat /proc/mdstat')return text.split(/\r?\n/).flatMap(l=>{const m=l.match(/^(md\S+)\s*:\s*(.*)$/);return m?[{name:m[1],state_members:m[2]}]:[];});
 if(command==='mca-status'){const data=parseJson(text);const row=data&&typeof data==='object'?data as Record<string,unknown>:{};return [pick(row,['model','name','mac','version','uptime','ip','state','adopted'])].filter(r=>Object.keys(r).length>0);}
 return [];
}
