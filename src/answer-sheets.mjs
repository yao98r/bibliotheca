import mappings from './answer-sheets-data.mjs';

export function attachAnswerSheets(entries, assets, books, links = mappings) {
 const byId = new Map(assets.map(a => [a.id, a]));
 const sheetIds = new Set(links.map(link => link.asset));
 return entries.filter(b => !sheetIds.has(b.asset)).map(b => {
  const answerSheets = links.filter(link => link.sources.includes(b.asset)).flatMap(link => {
   const a = byId.get(link.asset);
   if (!a || a.indexedReady === 0 || a.watermarkedReady === 0 || books.get(a.book_id)?.category !== b.category) return [];
   return [{asset:a.id,bookId:a.book_id,label:link.label,note:link.note || ''}];
  });
  return answerSheets.length ? {...b,answerSheets} : b;
 });
}
