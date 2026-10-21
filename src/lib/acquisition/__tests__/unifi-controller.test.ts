import {test} from 'node:test';
import assert from 'node:assert/strict';
import {collectUnifiController} from '../unifi-controller';
import {acquisitionInputSchema} from '../schema';
import type {createUnifiClient} from '../../integrations/unifi-api';
const request={collector:'unifi-controller' as const,host:'controller.test',unifi:{api_token:'test-only-secret'}};
const fake=(devices:unknown[],fail=false):typeof createUnifiClient => (()=>({kind:'udm',probe:async()=>({ok:true,devices:0,certPin:null,certPinRecorded:false}),listDevices:async()=>{if(fail)throw Error('test-only-secret');return devices;},listClients:async()=>[]})) as typeof createUnifiClient;
test('offline devices remain inventory; ports never belong to controller',async()=>{
 const s=await collectUnifiController(request,fake([{mac:'00:11:22:33:44:55',name:'offline',model:'test',type:'usw',ip:null,state:0,version:null,serial:null,adopted:true,port_table:[],lldp_table:[],uplink:null}]));
 assert.equal(s.controller_inventory?.data.devices[0].state,0);assert.equal(s.interfaces.status,'skipped');assert.equal(s.status,'partial');
});
test('failed read is error, never authoritative empty inventory or leaked error',async()=>{
 const s=await collectUnifiController(request,fake([],true));assert.equal(s.status,'error');assert.equal(s.controller_inventory?.status,'error');assert.ok(!JSON.stringify(s).includes('test-only-secret'));
});
test('controller credentials are exclusive',()=>{assert.equal(acquisitionInputSchema.safeParse({...request,snmp:{community:'test'}}).success,false);});
