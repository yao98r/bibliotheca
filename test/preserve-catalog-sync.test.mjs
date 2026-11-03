import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import worker from '../src/worker.mjs';
import {hash,random,now,seal} from '../src/core.mjs';

const folderMime='application/vnd.google-apps.folder';
async function fixture(){
 const mf=new Miniflare({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-07-01',d1Databases:['DB']});
 const DB=await mf.getD1Database('DB');
 const env={DB,OWNER_EMAIL:'owner@example.com',REFERENCE_ROOT_ID:'root-reference-123456',MOCK_ROOT_ID:'root-mocks-123456',TOKEN_ENCRYPTION_KEY:random(),GOOGLE_CLIENT_ID:'catalog-test',GOOGLE_CLIENT_SECRET:'test-secret'};
 for(const migration of ['0001','0002','0003','0004','0005'])for(const sql of (await readFile('migrations/'+migration+'.sql','utf8')).split(';').map(s=>s.trim()).filter(Boolean))await DB.prepare(sql).run();
 const book={id:'original-book-12345',title:'原書名：題本與獨立答案',category:'參考書',subject:'數學A',year:'113',sortOrder:27,answerAsset:'answer-asset-123456',customField:'不可由檔名覆寫'};
 await DB.prepare('INSERT INTO books VALUES (?,?,?,?)').bind(book.id,book.title,book.category,JSON.stringify(book)).run();
 for(const [id,parent,name,mime] of [
  ['question-asset-12345',env.REFERENCE_ROOT_ID,'原題本名稱.pdf','application/pdf'],
  ['registered-folder-12345',env.REFERENCE_ROOT_ID,'原分冊名稱',folderMime],
  ['answer-asset-123456','registered-folder-12345','原答案名稱.pdf','application/pdf']
 ])await DB.prepare('INSERT INTO assets(id,parent,book_id,name,mime,size,md5,index_id) VALUES (?,?,?,?,?,?,?,?)').bind(id,parent,book.id,name,mime,100,'a'.repeat(32),'keep-index-reference').run();
 const token=random();
 await DB.prepare('INSERT INTO users(email,google_name) VALUES (?,?)').bind(env.OWNER_EMAIL,'Owner').run();
 await DB.prepare('INSERT INTO sessions VALUES (?,?,?,?)').bind(await hash(token),env.OWNER_EMAIL,'test-csrf',now()+3600).run();
 await DB.prepare("INSERT INTO settings VALUES ('drive',?)").bind(JSON.stringify({email:env.OWNER_EMAIL,refresh:await seal('test-refresh',env.TOKEN_ENCRYPTION_KEY)})).run();
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async url=>{
  if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'test-drive-access',expires_in:3600});
  const u=new URL(url);assert.equal(u.hostname,'www.googleapis.com');
  const q=u.searchParams.get('q');
  if(q.startsWith("'"+env.REFERENCE_ROOT_ID+"'"))return Response.json({files:[
   {id:'question-asset-12345',name:'新檔名不應取代原書名.pdf',mimeType:'application/pdf',size:'222',md5Checksum:'b'.repeat(32)},
   {id:'registered-folder-12345',name:'新資料夾名稱',mimeType:folderMime},
   {id:'unregistered-pdf-12345',name:'不應自動新增.pdf',mimeType:'application/pdf',size:'333',md5Checksum:'c'.repeat(32)},
   {id:'unknown-folder-12345',name:'不應展開的新目錄',mimeType:folderMime}
  ]});
  if(q.startsWith("'registered-folder-12345'"))return Response.json({files:[
   {id:'answer-asset-123456',name:'新的答案檔名.pdf',mimeType:'application/pdf',size:'444',md5Checksum:'d'.repeat(32)},
   // A duplicate ID at another parent cannot silently change its registered identity.
   {id:'question-asset-12345',name:'錯位題本.pdf',mimeType:'application/pdf',size:'999',md5Checksum:'e'.repeat(32)}
  ]});
  return Response.json({files:[]});
 };
 const call=preserveCatalog=>worker.fetch(new Request('https://books.test/api/drive/sync',{method:'POST',headers:{Authorization:'Bearer '+token,Origin:'https://books.test','Content-Type':'application/json'},body:JSON.stringify({csrf:'test-csrf',preserveCatalog})}),env,{});
 return {env,call,async close(){globalThis.fetch=originalFetch;await mf.dispose();}};
}

test('same-ID PDF refresh keeps the complete book catalog and asset identities unchanged',async()=>{
 const f=await fixture();
 try{
  const beforeBooks=(await f.env.DB.prepare('SELECT * FROM books ORDER BY id').all()).results;
  const identitySql='SELECT id,parent,book_id,name,mime,index_id FROM assets ORDER BY id';
  const beforeAssets=(await f.env.DB.prepare(identitySql).all()).results;
  for(let step=0;step<8;step++){
   // Older open management pages send no option: they must preserve the catalog too.
   const response=await f.call(undefined);assert.equal(response.status,200);
   if(!(await response.json()).remaining)break;
   assert.ok(step<7,'registered scan should finish');
  }
  assert.deepEqual((await f.env.DB.prepare('SELECT * FROM books ORDER BY id').all()).results,beforeBooks);
  assert.deepEqual((await f.env.DB.prepare(identitySql).all()).results,beforeAssets);
  const question=await f.env.DB.prepare('SELECT size,md5 FROM assets WHERE id=?').bind('question-asset-12345').first();
  assert.deepEqual(question,{size:222,md5:'b'.repeat(32)});
  const answer=await f.env.DB.prepare('SELECT size,md5 FROM assets WHERE id=?').bind('answer-asset-123456').first();
  assert.deepEqual(answer,{size:444,md5:'d'.repeat(32)});
  assert.equal((await f.env.DB.prepare('SELECT COUNT(*) AS n FROM assets').first()).n,3);
 }finally{await f.close();}
});

test('explicit full catalog sync can still discover new PDFs',async()=>{
 const f=await fixture();
 try{
  for(let step=0;step<8;step++){
   const response=await f.call(false);assert.equal(response.status,200);
   if(!(await response.json()).remaining)break;
  }
  const discovered=await f.env.DB.prepare('SELECT name FROM assets WHERE id=?').bind('unregistered-pdf-12345').first();
  assert.equal(discovered.name,'不應自動新增.pdf');
 }finally{await f.close();}
});
