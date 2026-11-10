import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('both frontend builds restore enhancement while retaining direct downloads and batched catalog',async()=>{
 for(const dir of ['dist','dist-pages']){
  const index=await readFile(dir+'/index.html','utf8'),download=await readFile(dir+'/download.html','utf8'),portal=await readFile(dir+'/enhance.html','utf8');
  assert.match(index,/id="pdfEnhanceTool"/);assert.match(index,/天河增強權限/);assert.match(index,/id="moreBooks"/);
  assert.match(download,/savePdf\('\/file'\+location.search\)/);assert.match(download,/\/api\/enhance\/start/);assert.match(download,/\/api\/enhance\/export/);
  assert.match(portal,/\/api\/enhance\/portal/);assert.doesNotMatch(portal,/已停止提供/);
 }
});
