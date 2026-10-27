import { acquisitionInputSchema,snapshotSchema,type AcquisitionRequest,type AcquisitionSnapshot,type AcquisitionTransports,type ReadResult,type SnmpRow } from './schema';
import {createTransports} from './transports';
import {INVENTORY_COMMANDS,isInventoryProfile} from './device-profiles';
import {parseSnmpInterfaces,parseIpNetwork,textValue,emptyInterface} from './parsers';
import {parseRead,colonValues,snmpTable,terse} from './inventory-parsers';
import {parseMikrotikNeighbors} from '../devices/mikrotik-vicini';
import {redactSnapshot} from './redact';
import {versioneCollector} from './catalogo';
import {QNAP_OID,identitaQnap} from '../scanner/qnap-oid';
import {estendiNas,estendiMikrotik, estendiProxmox, comandiApprofondimentoProxmox, applicaApprofondimentoProxmox} from './inventory-estensioni';
const section=<T>(data:T,status:'ok'|'partial'|'error'|'unsupported'|'skipped'='skipped',sources:string[]=[],warnings:string[]=[])=>({data,status,collected_at:new Date().toISOString(),sources,warnings});
const failed=<T>(data:T,code='NOT_COLLECTED'):ReadResult<T>=>({data,status:'error',warnings:[code]});
/** An `ok` read with output but no recognised row is a format we do not know, never an authoritative empty list. */
const unrecognised=(r:ReadResult<string>,rows:number):ReadResult<string>['status']=>r.status==='ok'&&r.data.trim()&&rows===0?'partial':r.status;
const SYS=['1.3.6.1.2.1.1.1.0','1.3.6.1.2.1.1.2.0','1.3.6.1.2.1.1.3.0','1.3.6.1.2.1.1.5.0'];
/** Dedicated static family profiles share transport and envelope, never DB/configuration writes. */
export async function collectInventoryDevice(request:AcquisitionRequest,transports?:AcquisitionTransports):Promise<AcquisitionSnapshot>{
 const input=acquisitionInputSchema.parse(request);if(!isInventoryProfile(input.collector))throw Error('COLLECTOR_MISMATCH');
 const profile=input.collector,start=Date.now(),io=transports??createTransports(input);
 const safe=async<T>(op:()=>Promise<ReadResult<T>>,empty:T)=>{try{return await op();}catch{return failed(empty,'TRANSPORT_EXCEPTION');}};
 const s:AcquisitionSnapshot={schema_version:'1.0',collector:profile,collector_version:versioneCollector(profile),target:input.host,collected_at:new Date(start).toISOString(),duration_ms:0,status:'error',identity:section(null),interfaces:section([]),vlans:section([]),forwarding:section([]),neighbors:section([]),spanning_tree:section({enabled:null,protocol:null,ports:[]}),aggregation:section([]),poe:section([]),sensors:section([]),network:section({ipv4_addresses:[],arp:[]}),inventory:section({scope:profile==='proxmox-ve'?'proxmox-cluster-visible':'device',tables:[]})};
 const tables=s.inventory!.data.tables;
 let shell:Record<string,ReadResult<string>>={};
 if(input.ssh||input.local_ssh){try{shell=await io.shell(INVENTORY_COMMANDS[profile]);}catch{shell=Object.fromEntries(INVENTORY_COMMANDS[profile].map(c=>[c,failed('','SSH_BATCH_FAILED')]));}}
 const read=(c:string)=>shell[c]??failed('');
 const okText=(c:string)=>read(c).status==='ok'?read(c).data:'';
 for(const [command,r0] of Object.entries(shell)){
  // DSM non ha `ip -j` (BusyBox/iproute vecchio: «invalid option», uscita 1): ripiego dichiarato, le interfacce arrivano da SNMP.
  const r:ReadResult<string>=profile==='synology-dsm'&&command.startsWith('ip -j')&&r0.status==='error'&&r0.warnings.includes('SSH_COMMAND_FAILED')?{status:'unsupported',data:'',warnings:['IP_JSON_NOT_AVAILABLE_ON_DSM','SNMP_USED_INSTEAD']}:r0;
  const parsed=parseRead(command,r.data),limited=parsed.length>input.limits.max_rows;
  // Inventory commands with scalar identity output are consumed below, not dumped as raw text.
  if(command.includes('terse')||command.includes('pvesh')||command.includes('ip -')||command.startsWith('lsblk')||['df -P -k','cat /proc/meminfo','cat /proc/mdstat','mca-status'].includes(command))tables.push({name:command,status:r.status==='ok'&&r.data.trim()&&!parsed.length?'partial':limited?'partial':r.status,sources:['ssh:'+command],warnings:[...r.warnings,...(limited?['ROW_LIMIT']:[]),...(r.status==='ok'&&r.data.trim()&&!parsed.length?['FORMAT_UNRECOGNIZED_OR_EMPTY']:[])],records:parsed.slice(0,input.limits.max_rows)});
 }
 let sys=failed<SnmpRow[]>([]);
 if(input.snmp)sys=await safe(()=>io.get(SYS),[]);
 const val=(oid:string)=>textValue(sys.data.find(r=>r.oid===oid)?.value);
 const resources=colonValues(okText('/system resource print')),board=colonValues(okText('/system routerboard print'));
 const vendor=({'synology-dsm':'Synology','qnap-nas':'QNAP','mikrotik-routeros':'MikroTik','ubiquiti-device':'Ubiquiti','proxmox-ve':'Proxmox'})[profile];
 const sshOk=Object.values(shell).some(r=>r.status==='ok');
 const firmware=profile==='mikrotik-routeros'?resources.version:profile==='proxmox-ve'?okText('pveversion').trim().split('\n')[0]:profile==='qnap-nas'?okText('getcfg System Version -f /etc/config/uLinux.conf').trim():profile==='synology-dsm'?okText('cat /etc.defaults/VERSION').match(/^productversion="([^"]+)"/m)?.[1]:okText('cat /etc/version').trim();
 let nasModel:string|null=null,nasSerial:string|null=null,nasVersion:string|null=null;
 // QNAP via solo SNMP: modello, seriale, nome, temperatura e ventole dagli OID enterprise giusti (`scanner/qnap-oid.ts`). `…24681.1.2.1/.2/.3` sono CPU %, memoria totale e libera: non si leggono. Il firmware via SNMP non esiste: resta `null`. Una misura («15979.0 MB», «12 %») non è mai un'identità.
 const qnapSensors:Array<{name:string;kind:'temperature'|'fan';value:number;unit:'celsius'|'rpm';note:null}>=[];
 if(profile==='qnap-nas'&&input.snmp&&sys.status!=='error'){const O=[...QNAP_OID.model,...QNAP_OID.serial,QNAP_OID.name,QNAP_OID.temperature];const r=await safe(()=>io.get(O),[]);const first=(oids:readonly string[])=>{for(const o of oids){const t=identitaQnap(textValue(r.data.find(v=>v.oid===o)?.value));if(t)return t;}return null;};nasModel=first(QNAP_OID.model);nasSerial=first(QNAP_OID.serial);const temp=Number(textValue(r.data.find(v=>v.oid===QNAP_OID.temperature)?.value));if(Number.isFinite(temp)&&textValue(r.data.find(v=>v.oid===QNAP_OID.temperature)?.value)?.trim())qnapSensors.push({name:'sistema',kind:'temperature',value:temp,unit:'celsius',note:null});const fan=await safe(()=>io.walk(QNAP_OID.fanTable),[]);const nomi=new Map<string,string>(),giri=new Map<string,number>();for(const row of fan.data){const m=row.oid.slice(QNAP_OID.fanTable.length+1).match(/^(\d+)\.(\d+)$/);if(!m)continue;const v=textValue(row.value);if(v===null)continue;if(m[1]==='2')nomi.set(m[2],v);else if(m[1]==='3'&&Number.isFinite(Number(v)))giri.set(m[2],Number(v));}for(const [idx,v] of giri)qnapSensors.push({name:nomi.get(idx)||'ventola '+idx,kind:'fan',value:v,unit:'rpm',note:null});}
 if(profile==='synology-dsm'&&input.snmp&&sys.status!=='error'){const r=await safe(()=>io.get(['1.3.6.1.4.1.6574.1.5.1.0','1.3.6.1.4.1.6574.1.5.2.0','1.3.6.1.4.1.6574.1.5.3.0']),[]);const get=(oid:string)=>textValue(r.data.find(v=>v.oid===oid)?.value);nasModel=get('1.3.6.1.4.1.6574.1.5.1.0');nasSerial=get('1.3.6.1.4.1.6574.1.5.2.0');nasVersion=get('1.3.6.1.4.1.6574.1.5.3.0');}
 const model=nasModel??board.model??resources['board-name']??(profile==='qnap-nas'?okText('getsysinfo model').trim():profile==='synology-dsm'?null:null);
 const hostname=profile==='mikrotik-routeros'?colonValues(okText('/system identity print')).name:okText('hostname').trim();
 s.identity=section({manufacturer:vendor,model:model||null,firmware:firmware||nasVersion||null,serial_number:nasSerial??board['serial-number']??(profile==='qnap-nas'?okText('getsysinfo serial_num').trim()||null:null),hostname:hostname||val(SYS[3]),mac:null,sys_object_id:val(SYS[1]),uptime_seconds:val(SYS[2])!==null?Number(val(SYS[2]))/100:null},sshOk||sys.data.length?'partial':'error',[...(input.snmp?['snmp:system']:[]),...Object.keys(shell).filter(c=>['hostname','pveversion','/system resource print','/system routerboard print','cat /etc.defaults/VERSION','getsysinfo model'].includes(c)).map(c=>'ssh:'+c)],['PROFILE_SELECTED_BY_CALLER',...sys.warnings.filter(()=>!!input.snmp)]);
 const walks:Record<string,ReadResult<SnmpRow[]>>={};
 if(input.snmp&&sys.status!=='error'){
  for(const [name,oid] of Object.entries({interfaces:'1.3.6.1.2.1.2.2.1',extended:'1.3.6.1.2.1.31.1.1.1',ip:'1.3.6.1.2.1.4.20.1',arp:'1.3.6.1.2.1.4.22.1'}))walks[name]=await safe(()=>io.walk(oid),[]);
  if(profile==='synology-dsm'||profile==='qnap-nas'){
   const defs=profile==='synology-dsm'?[['disks','1.3.6.1.4.1.6574.2.1.1',{'2':'id','3':'model','4':'type','5':'status','6':'temperature_c','7':'slot','13':'smart_status'}],['raid','1.3.6.1.4.1.6574.3.1.1',{'2':'name','3':'status','4':'total_vendor_units','5':'free_vendor_units'}]]:[['disks','1.3.6.1.4.1.24681.1.2.11.1',{'2':'model','3':'serial','4':'capacity_vendor_units','5':'temperature_c','6':'status','7':'smart_status'}],['volumes','1.3.6.1.4.1.24681.1.2.17.1',{'2':'name','3':'status','4':'total_vendor_units','5':'free_vendor_units','6':'raid_type'}]];
   for(const [name,oid,cols] of defs as [string,string,Record<string,string>][]){const r=await safe(()=>io.walk(oid),[]);tables.push({name,status:r.status,sources:['snmp:'+oid],warnings:[...r.warnings,'CAPACITY_VENDOR_UNITS_NOT_ASSUMED'],records:snmpTable(r.data,oid,cols)});}
  }
 }
 const walk=(name:string)=>walks[name]??failed<SnmpRow[]>([]);
 if(walks.interfaces){s.interfaces=section(parseSnmpInterfaces(walk('interfaces').data,walk('extended').data),walk('interfaces').status==='ok'&&walk('extended').status==='ok'?'ok':'partial',['snmp:ifTable','snmp:ifXTable'],[...walk('interfaces').warnings,...walk('extended').warnings]);s.network=section(parseIpNetwork(walk('ip').data,walk('arp').data),walk('ip').status==='ok'&&walk('arp').status==='ok'?'ok':'partial',['snmp:ipAddrTable','snmp:ipNetToMediaTable'],[...walk('ip').warnings,...walk('arp').warnings]);}
 const linkTable=tables.find(t=>t.name==='ip -j link show'||t.name==='ip -d -j link show');
 if(!s.interfaces.data.length&&linkTable&&linkTable.records.length){s.interfaces=section(linkTable.records.filter(r=>typeof r.ifname==='string').map(r=>{const p=emptyInterface(String(r.ifname));p.if_index=typeof r.ifindex==='number'?r.ifindex:null;p.mac=typeof r.address==='string'?r.address:null;p.mtu=typeof r.mtu==='number'?r.mtu:null;p.oper_status=typeof r.operstate==='string'?r.operstate.toLowerCase():null;return p;}),'partial',linkTable.sources,['LINK_KIND_NOT_PHYSICAL_CABLE_PROOF','SPEED_NOT_COLLECTED']);}
 const addresses=tables.find(t=>t.name==='ip -j address show');
 if(!s.network.data.ipv4_addresses.length&&addresses?.records.length)s.network=section({ipv4_addresses:addresses.records.filter(r=>r.family==='inet'&&typeof r.local==='string').map(r=>({address:String(r.local),netmask:null,if_index:typeof r.if_index==='number'?r.if_index:null})),arp:[]},'partial',addresses.sources,['PREFIX_IN_INVENTORY_TABLE','ARP_NOT_COLLECTED']);
 if(profile==='mikrotik-routeros'){
  const cmd='/interface print terse without-paging',r=read(cmd);
  if(!s.interfaces.data.length&&r.status==='ok')s.interfaces=section(terse(r.data).filter(v=>typeof v.name==='string').map(v=>{const p=emptyInterface(String(v.name));p.description=typeof v.comment==='string'?v.comment:null;p.mac=typeof v['mac-address']==='string'?v['mac-address']:null;p.kind=v.type==='ether'?'physical':v.type==='bond'?'aggregate':'other';return p;}),'partial',['ssh:'+cmd],['TERSE_FLAGS_AND_NEGOTIATED_SPEED_NOT_INTERPRETED']);
  const ncmd='/ip neighbor print terse without-paging',nr=read(ncmd);
  const nb=parseMikrotikNeighbors(nr.data);
  s.neighbors=section(nb.map(n=>({local_port:n.localPort,remote_chassis:n.remoteMac??n.remoteDevice,remote_port:n.remotePort,system_name:n.remoteDevice||null,system_description:n.remotePlatform??null,management_addresses:n.remoteIp?[n.remoteIp]:[],capabilities:n.remoteCaps?n.remoteCaps.split(","):[],ttl_seconds:null})),unrecognised(nr,nb.length),['ssh:'+ncmd],[...nr.warnings,...(unrecognised(nr,nb.length)!==nr.status?['FORMAT_UNRECOGNIZED_OR_EMPTY']:[])]);
 }
 if(profile==='mikrotik-routeros'){
  const vlanCmd='/interface bridge vlan print terse without-paging',vr=read(vlanCmd);
  const split=(v:unknown)=>typeof v==='string'?v.split(',').filter(Boolean):[];
  const vlans:AcquisitionSnapshot['vlans']['data']=[];
  for(const row of terse(vr.data)){for(const chunk of split(row['vlan-ids'])){const m=chunk.match(/^(\d+)(?:-(\d+))?$/);if(!m)continue;const first=Number(m[1]),last=Number(m[2]??m[1]);if(first<1||last>4094||last<first)continue;for(let id=first;id<=last&&vlans.length<input.limits.max_rows;id++)vlans.push({id,name:null,description:typeof row.bridge==='string'?row.bridge:null,tagged_ports:split(row['current-tagged']??row.tagged),untagged_ports:split(row['current-untagged']??row.untagged),forbidden_ports:[]});}}
  s.vlans=section(vlans,vr.status==='ok'?'partial':vr.status,['ssh:'+vlanCmd],[...vr.warnings,'BRIDGE_VLAN_ROWS_NOT_INDEPENDENT_VLANS','CONFIGURED_AND_CURRENT_MEMBERSHIP_IN_INVENTORY']);
  const bondCmd='/interface bonding print terse without-paging',br=read(bondCmd);
  const bonds=terse(br.data).filter(r=>typeof r.name==='string');
  s.aggregation=section(bonds.map(r=>({name:String(r.name),protocol:typeof r.mode==='string'?r.mode:null,admin_status:r.disabled==='true'?'down':null,oper_status:null,members:split(r.slaves)})),unrecognised(br,bonds.length),['ssh:'+bondCmd],[...br.warnings,...(unrecognised(br,bonds.length)!==br.status?['FORMAT_UNRECOGNIZED_OR_EMPTY']:[]),'BOND_MONITOR_NOT_COLLECTED']);
 }
 if(input.ssh||input.local_ssh){if(profile==='qnap-nas'||profile==='synology-dsm')estendiNas(s,profile,read);if(profile==='mikrotik-routeros')estendiMikrotik(s,read);if(profile==='proxmox-ve'){estendiProxmox(s,read);const extra=comandiApprofondimentoProxmox(s);if(extra.length){let sh2:Record<string,ReadResult<string>>;try{sh2=await io.shell(extra);}catch{sh2=Object.fromEntries(extra.map(c=>[c,failed('','SSH_BATCH_FAILED')]));}applicaApprofondimentoProxmox(s,c=>sh2[c]??failed(''));}}}
 const mem=tables.find(t=>t.name==='cat /proc/meminfo');
 if(mem){const bytes=(name:string)=>{const value=mem.records.find(r=>r.name===name)?.size_bytes;return typeof value==='string'&&/^\d+$/.test(value)&&BigInt(value)<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):null;};s.resources=section({cpu_percent:null,memory_total_bytes:bytes('MemTotal'),memory_free_bytes:bytes('MemFree')},mem.status,mem.sources,mem.warnings);}
 const disks=tables.find(t=>t.name==='disks');
 if(disks)s.sensors=section(disks.records.flatMap(d=>{const value=typeof d.temperature_c==='string'?Number(d.temperature_c):NaN;return Number.isFinite(value)?[{name:'disk '+String(d.index),kind:'temperature' as const,value,unit:'celsius' as const,note:null}]:[];}),disks.status,disks.sources,disks.warnings);
 if(qnapSensors.length)s.sensors=section([...(s.sensors?.data??[]),...qnapSensors],s.sensors?.status??'ok',[...(s.sensors?.sources??[]),'snmp:qnap-sensors'],s.sensors?.warnings??[]);
 s.inventory!.status=tables.length&&tables.every(t=>t.status==='ok')?'ok':tables.some(t=>t.status==='ok'||t.status==='partial')?'partial':'error';
 s.status=sshOk||sys.data.length?'partial':'error';s.duration_ms=Date.now()-start;
 return snapshotSchema.parse(redactSnapshot(s,input));
}
