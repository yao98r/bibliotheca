function normalizeCatalogText(value){
 return String(value??'').normalize('NFKC').toLowerCase()
  .replace(/模擬考(?:試)?(?:題本|試題|題)?|模考/g,'模考')
  .replace(/國語文寫作|國文寫作/g,'國寫').replace(/國語文綜合|國文綜合/g,'國綜')
  .replace(/國語文/g,'國文').replace(/數學\s*([ab])/g,'數$1')
  .replace(/[\s_\-‐‑–—·.,，。:：/\\()[\]【】「」]+/g,' ').trim();
}
function catalogSearchTokens(query){
 return normalizeCatalogText(query)
  .replace(/(\d{3})(?=[a-z\u4e00-\u9fff])/g,'$1 ')
  .replace(/(模考|國寫|國綜|數a|數b|英聽|自然|英文|國文|社會|南一|翰林|晟景)/g,' $1 ')
  .split(/\s+/).filter(Boolean);
}
function matchesCatalogSearch(book,tokens){
 const text=normalizeCatalogText([book.title,book.subject,book.publisher,book.series,book.year,book.category,book.referenceKind,book.referenceType].filter(Boolean).join(' ')).replace(/\s/g,'');
 return tokens.every(token=>text.includes(token));
}
