import { boundedPinnedTransportFactory, createUnifiClient, type UnifiClient } from '../integrations/unifi-api';
import { acquisitionInputSchema, snapshotSchema, type AcquisitionSnapshot, type AcquisitionRequest } from './schema';
import { redactSnapshot } from './redact';
import { versioneCollector } from './catalogo';
const section = <T>(data: T, status: 'ok'|'partial'|'error'|'skipped' = 'skipped', warnings: string[] = []) => ({ data, status, collected_at: new Date().toISOString(), sources: [] as string[], warnings });
/** A controller observes multiple chassis: never flatten their ports onto the controller. */
export async function collectUnifiController(request: AcquisitionRequest, factory: typeof createUnifiClient = createUnifiClient): Promise<AcquisitionSnapshot> {
 const input=acquisitionInputSchema.parse(request);
 if(input.collector!=='unifi-controller'||!input.unifi) throw Error('COLLECTOR_MISMATCH');
 const started=Date.now();
 const s:AcquisitionSnapshot={schema_version:'1.0',collector:'unifi-controller',collector_version:versioneCollector('unifi-controller'),target:input.host,collected_at:new Date(started).toISOString(),duration_ms:0,status:'error',identity:section(null,'skipped',['CONTROLLER_SCOPE_NOT_SINGLE_CHASSIS']),interfaces:section([]),vlans:section([]),forwarding:section([]),neighbors:section([]),spanning_tree:section({enabled:null,protocol:null,ports:[]}),aggregation:section([]),poe:section([]),sensors:section([]),network:section({ipv4_addresses:[],arp:[]})};
 let pin:string|null=input.unifi.tls_pin??null;
 const finish=()=>{s.duration_ms=Date.now()-started;return snapshotSchema.parse(redactSnapshot(s,input));};
 const client:UnifiClient=factory({url:`https://${input.host.includes(':')?'['+input.host+']':input.host}:${input.unifi.port}`,kind:'udm',apiToken:input.unifi.api_token,site:input.unifi.site},{get:()=>pin,set:value=>{pin=value;},clear:()=>{pin=null;}},{transportFactory:boundedPinnedTransportFactory(input.limits.max_output_bytes),readTimeoutMs:Math.min(input.limits.timeout_ms,Math.floor(input.limits.total_timeout_ms/2)),loginTimeoutMs:input.limits.timeout_ms});
 try {
  const devices=await client.listDevices();
  const truncated=devices.length>input.limits.max_rows;
  s.controller_inventory=section({site:input.unifi.site,tls_pin:pin,devices:devices.slice(0,input.limits.max_rows)},'partial',[...(truncated?['ROW_LIMIT']:[]),'RADIO_AND_CLIENT_DETAILS_NOT_COLLECTED','FIRST_USE_TLS_PIN_RETURNED_FOR_PERSISTENCE']);
  s.controller_inventory.sources=['api:/proxy/network/api/s/<site>/stat/device'];
  s.status='partial';
 } catch { s.controller_inventory=section({site:input.unifi.site,tls_pin:pin,devices:[]},'error',['CONTROLLER_READ_FAILED_NOT_EMPTY_INVENTORY']); }
 return finish();
}
