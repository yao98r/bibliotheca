import restored from './restored-catalog.mjs';
export const restoredBooks=new Map(restored.map(b=>[b.id,b]));
export function restoredCategory(asset,fallback){
 const categories=new Set(restored.filter(b=>[b.asset,b.answerAsset,b.answerSourceAsset].includes(asset)).map(b=>b.category));
 return categories.size===1?[...categories][0]:fallback;
}
export function categoryRepairs(assets,books){
 const byId=new Map(assets.map(a=>[a.id,a])),categories=new Map();
 for(const b of restored)for(const id of [b.asset,b.answerAsset,b.answerSourceAsset]){const a=byId.get(id);if(!a)continue;if(!categories.has(a.book_id))categories.set(a.book_id,new Set());categories.get(a.book_id).add(b.category);}
 const changes=[],conflicts=[];
 for(const [id,targets] of categories){const b=books.get(id);if(!b)continue;if(targets.size!==1){conflicts.push(id);continue;}const category=[...targets][0];if(b.category!==category)changes.push({id,title:b.title,before:b.category,category});}
 return {changes,conflicts};
}
const FOLDER='application/vnd.google-apps.folder';
export function restoredSource(book,action){return typeof action==='string'&&action.startsWith('answer')?(book.answerAsset||book.answerId):book.asset;}
export function catalogEntries(assets,books){
 const byId=new Map(assets.map(a=>[a.id,a])),covered=new Set(),result=[];
 const available=(id,category)=>{const a=byId.get(id),b=a&&books.get(a.book_id);return b?.category===category?a:null;};
 const cover=root=>{if(!root)return;covered.add(root.id);if(root.mime===FOLDER)for(const a of assets){let p=a;const seen=new Set();while(p&&!seen.has(p.id)){if(p.id===root.id){covered.add(a.id);break;}seen.add(p.id);p=byId.get(p.parent);}}};
 for(const b of restored){
  const main=available(b.asset,b.category);if(!main)continue;
  const answer=available(b.answerAsset,b.category);
  const ready=answer&&(answer.mime===FOLDER||answer.indexedReady!==0);
  result.push({...b,id:main.book_id,legacyId:b.id,asset:main.id,folder:main.mime===FOLDER,hasAnswer:!!ready,answerAsset:ready?answer.id:null,answerBookId:ready?answer.book_id:null});
  cover(main);cover(answer);cover(available(b.answerSourceAsset,b.category));
 }
 for(const a of assets)if(a.mime==='application/pdf'&&!covered.has(a.id)&&books.has(a.book_id))result.push(pdfCatalogEntry(a,books.get(a.book_id)));
 return result;
}
export function pdfCatalogEntry(asset,book){
 const metadata=JSON.parse(book.data),fileTitle=asset.name.replace(/\.pdf$/i,'');
 const title=/^(?:\d+|正文|答案|解答|上冊|下冊)$/u.test(fileTitle)?book.title+' — '+fileTitle:fileTitle;
 const subject=title.match(/數學[AB甲乙]?|國文|英文|物理|化學|生物|地球科學|地理|歷史|公民|自然|社會/)?.[0]
   || ({'數A':'數學A','數B':'數學B','國寫':'國文'}[title.match(/數A|數B|國寫/)?.[0]]) || metadata.subject;
 return {...metadata,id:book.id,asset:asset.id,title,subject,publisher:title.match(/[\[［【]([^\]］】]+)[\]］】]/)?.[1]||metadata.publisher,year:title.match(/\d{3}(?=學?年)/)?.[0]||metadata.year,series:book.id===asset.id?'':book.title,folder:false,hasAnswer:false,referenceKind:book.category==='參考書'?(title.includes('歷屆')?'歷屆學測彙編':/模擬|模模考|模考/.test(title)?'成冊模擬題本':'學習講義'):''};
}
