"""Convert an existing concatenated gzip index bundle into bounded D1 SQL files.
No source PDFs, identities, OAuth tokens, or public assets are emitted.
"""
import argparse, base64, gzip, json
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('bundle',type=Path)
p.add_argument('output',type=Path)
a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
raw=gzip.open(a.bundle,'rt',encoding='utf-8').read()
decoder=json.JSONDecoder();pos=0;batch=[];size=0;number=0;assets=pages=0
def quote(s): return "'"+str(s).replace("'","''")+"'"
def flush():
 global batch,size,number
 if batch:
  (a.output/f'indexes-{number:03}.sql').write_text('\n'.join(batch)+'\n',encoding='utf-8')
  number+=1;batch=[];size=0
def emit(s):
 global size
 if size+len(s)>4_000_000:flush()
 batch.append(s);size+=len(s)
while pos<len(raw):
 while pos<len(raw) and raw[pos].isspace():pos+=1
 if pos==len(raw):break
 d,pos=decoder.raw_decode(raw,pos);asset=d['asset'];assets+=1
 assert len(asset)<200 and d['version']==1
 tail=d['tail'] if d.get('tailEncoding')=='base64' else base64.b64encode(d['tail'].encode()).decode()
 emit(f"INSERT OR REPLACE INTO pdf_headers VALUES ({quote(asset)},{int(d['size'])},{quote(d['md5'])},{quote(tail)},{len(d['pages'])});")
 for n,page in enumerate(d['pages'],1):
  pages+=1
  payload=base64.b64encode(gzip.compress(json.dumps(page,separators=(',',':')).encode(),mtime=0)).decode()
  emit(f'DELETE FROM pdf_pages WHERE asset={quote(asset)} AND page={n};')
  for part,start in enumerate(range(0,len(payload),32000)):
   emit(f'INSERT INTO pdf_pages VALUES ({quote(asset)},{n},{part},{quote(payload[start:start+32000])});')
flush()
print(json.dumps({'assets':assets,'pages':pages,'sqlFiles':number}))
