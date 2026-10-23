"""Build and validate a range-based index without changing the source PDF.

Usage: python build-pdf-index.py SOURCE.pdf DRIVE_ID OUTPUT.json.gz
Requires pypdf 6.1.3. The index contains per-page PDF structure and byte ranges
into the original source; source streams are never served across page boundaries.
"""
import base64, gzip, hashlib, io, json, re, sys
from pathlib import Path
from pypdf import PdfReader, PdfWriter
from pypdf.generic import StreamObject

def build(source, asset):
    raw=Path(source).read_bytes()
    reader=PdfReader(io.BytesIO(raw))
    if reader.is_encrypted: raise ValueError('Encrypted PDFs require a separate import workflow')
    root=reader.trailer.raw_get('/Root')
    new_id=int(reader.trailer['/Size'])
    previous=int(re.findall(rb'startxref\s+(\d+)\s+%%EOF',raw)[-1])
    obj=f'\n{new_id} 0 obj\n<< /BibliothecaTrace (ZZZZ-ZZZZ) >>\nendobj\n'.encode()
    tail=obj+f'xref\n{new_id} 1\n{len(raw)+1:010d} 00000 n \ntrailer\n<< /Size {new_id+1} /Root {root.idnum} {root.generation} R /Info {new_id} 0 R /Prev {previous} >>\nstartxref\n{len(raw)+len(obj)}\n%%EOF\n'.encode()
    full=PdfReader(io.BytesIO(raw+tail))
    assert len(full.pages)==len(reader.pages)
    assert full.metadata['/BibliothecaTrace']=='ZZZZ-ZZZZ'
    pages=[];offsets={}
    for page in reader.pages:
        writer=PdfWriter();writer.add_page(page,excluded_keys=['/Annots','/AA'])
        writer.add_metadata({'/BibliothecaTrace':'ZZZZ-ZZZZ'})
        out=io.BytesIO();writer.write(out);pdf=out.getvalue()
        # pypdf's escaped hyphen is preserved by the runtime trace replacement.
        assert b'/BibliothecaTrace (ZZZZ\\055ZZZZ)' in pdf
        spans=[]
        for obj in writer._objects:
            if not isinstance(obj,StreamObject) or len(obj._data)<256: continue
            data=obj._data;key=hashlib.sha256(data).digest()
            if key not in offsets: offsets[key]=raw.find(data)
            original=offsets[key]
            if original<0: continue
            start=pdf.find(data)
            if start>=0: spans.append((start,start+len(data),original))
        spans.sort(key=lambda s:(s[0],-s[1]))
        # Bound range requests. Small streams left inline preserve exact bytes.
        if len(spans)>38: spans=sorted(sorted(spans,key=lambda s:s[1]-s[0],reverse=True)[:38])
        parts=[];cursor=0
        for start,end,original in spans:
            if start<cursor: continue
            if start>cursor: parts.append(base64.b64encode(pdf[cursor:start]).decode())
            parts.append([original,end-start]);cursor=end
        if cursor<len(pdf): parts.append(base64.b64encode(pdf[cursor:]).decode())
        rebuilt=b''.join(base64.b64decode(p) if isinstance(p,str) else raw[p[0]:p[0]+p[1]] for p in parts)
        assert rebuilt==pdf and len(PdfReader(io.BytesIO(rebuilt)).pages)==1
        assert len(pdf)<=16*1024*1024 and len(parts)<=80
        entry={'length':len(pdf),'parts':parts}
        assert len(json.dumps(entry).encode())<2*1024*1024
        pages.append(entry)
    return {'version':1,'asset':asset,'size':len(raw),'md5':hashlib.md5(raw).hexdigest(),'tail':base64.b64encode(tail).decode(),'tailEncoding':'base64','pages':pages}

if __name__=='__main__':
    result=build(sys.argv[1],sys.argv[2])
    with gzip.open(sys.argv[3],'wt',encoding='utf-8') as f: json.dump(result,f,separators=(',',':'))
    print(json.dumps({'asset':result['asset'],'pages':len(result['pages']),'bytes':Path(sys.argv[3]).stat().st_size}))
