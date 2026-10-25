import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDriveTokenCache} from '../src/drive-token-cache.mjs';
import {driveToken} from '../src/auth.mjs';
import {random,seal} from '../src/core.mjs';

test('Drive access tokens coalesce concurrent refreshes and renew before expiration',async()=>{
 let now=1000,calls=0;const cache=createDriveTokenCache(()=>now);
 const refresh=async()=>{calls++;await new Promise(resolve=>setImmediate(resolve));return {access_token:'token-'+calls,expires_in:3600};};
 assert.deepEqual(await Promise.all([cache('connection',refresh),cache('connection',refresh)]),['token-1','token-1']);assert.equal(calls,1);
 now+=3539*1000;assert.equal(await cache('connection',refresh),'token-1');assert.equal(calls,1);
 now+=2000;assert.equal(await cache('connection',refresh),'token-2');assert.equal(calls,2);
});
test('failed and unbounded-lifetime refresh responses are never kept as cached credentials',async()=>{
 const cache=createDriveTokenCache();let calls=0;
 await assert.rejects(cache('failed',async()=>{throw Error('temporary failure');}),/temporary/);
 assert.equal(await cache('failed',async()=>({access_token:'retry',expires_in:3600})),'retry');
 for(let i=0;i<2;i++)await cache('no-lifetime',async()=>{calls++;return {access_token:'short'};});assert.equal(calls,2);
 await assert.rejects(cache('invalid',async()=>({expires_in:3600})),e=>e.status===502);
});
test('connection replacement and key rotation cannot reuse cached tokens; disconnect applies immediately',async()=>{
 const originalFetch=globalThis.fetch,key=random(),owner='owner@example.com';let calls=0,stored={email:owner,refresh:await seal('first-refresh',key)};
 const env={OWNER_EMAIL:owner,TOKEN_ENCRYPTION_KEY:key,GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',DB:{prepare(){return {bind(){return this;},async first(){return stored?{value:JSON.stringify(stored)}:null;}};}}};
 globalThis.fetch=async()=>Response.json({access_token:'live-'+(++calls),expires_in:3600});
 try{
  assert.equal(await driveToken(env),'live-1');assert.equal(await driveToken(env),'live-1');assert.equal(calls,1);
  stored={email:owner,refresh:await seal('second-refresh',key)};assert.equal(await driveToken(env),'live-2');
  env.GOOGLE_CLIENT_SECRET='rotated';assert.equal(await driveToken(env),'live-3');
  env.TOKEN_ENCRYPTION_KEY=random();await assert.rejects(driveToken(env));assert.equal(calls,3);
  stored=null;await assert.rejects(driveToken(env),e=>e.status===503);assert.equal(calls,3);
 }finally{globalThis.fetch=originalFetch;}
});
