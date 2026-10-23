export function pdfCatalogEntry(asset,book){
 const metadata=JSON.parse(book.data),fileTitle=asset.name.replace(/\.pdf$/i,'');
 const title=/^(?:\d+|正文|答案|解答|上冊|下冊)$/u.test(fileTitle)?book.title+' — '+fileTitle:fileTitle;
 const subject=title.match(/數學[AB甲乙]?|國文|英文|物理|化學|生物|地球科學|地理|歷史|公民|自然|社會/)?.[0]
   || ({'數A':'數學A','數B':'數學B','國寫':'國文'}[title.match(/數A|數B|國寫/)?.[0]]) || metadata.subject;
 return {...metadata,id:book.id,asset:asset.id,title,subject,publisher:title.match(/[\[［【]([^\]］】]+)[\]］】]/)?.[1]||metadata.publisher,year:title.match(/\d{3}(?=學?年)/)?.[0]||metadata.year,series:book.id===asset.id?'':book.title,folder:false,hasAnswer:false,referenceKind:book.category==='參考書'?(title.includes('歷屆')?'歷屆學測彙編':/模擬|模模考|模考/.test(title)?'成冊模擬題本':'學習講義'):''};
}
