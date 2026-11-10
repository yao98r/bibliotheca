"""Local PDF image enhancement. Originals are never modified."""
import gc
import hashlib
import json
import math
import os
import shutil
import time
import uuid
from pathlib import Path
import fitz
import cv2
import numpy as np

cv2.setNumThreads(1)

def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

class Cancelled(Exception):
    pass

def process_pdf(source, destination, dpi=300, terms=(), sharpen=True, progress=lambda *args: None, cancelled=lambda: False):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if source == destination or destination.exists():
        raise ValueError('請選擇新的輸出檔名，原檔與既有檔案不會被覆寫。')
    if dpi not in (300, 600, 800):
        raise ValueError('解析度必須是 300、600 或 800 DPI。')
    terms = tuple(dict.fromkeys(str(t).strip() for t in terms if str(t).strip()))
    if any(len(t) < 3 for t in terms):
        raise ValueError('浮水印文字至少需 3 個字元，避免誤刪正文。')
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.parent / ('.tianhe-' + uuid.uuid4().hex + '.pdf')
    report = {'version': '1.0.0', 'input': str(source), 'output': str(destination), 'dpi': dpi,
              'input_sha256': sha256(source), 'enhanced_images': 0, 'removed_text': 0,
              'removed_annotations': 0, 'warnings': [], 'pages': []}
    started = time.monotonic()
    seen = set()
    def check_cancel():
        if cancelled():
            raise Cancelled('已取消；原始檔案未變更。')
    try:
        with fitz.open(source) as doc:
            if doc.needs_pass:
                raise ValueError('請先以密碼解鎖 PDF，再選擇已解鎖的檔案。')
            if not doc.is_pdf or not doc.page_count:
                raise ValueError('請選擇有效的 PDF。')
            total = doc.page_count
            geometry = [(tuple(p.mediabox), tuple(p.cropbox), p.rotation) for p in doc]
        shutil.copyfile(source, temp)
        for number in range(total):
            check_cancel()
            progress(number, total, '正在處理第 %d 頁' % (number + 1), time.monotonic() - started)
            # Reopening at each page bounds decoded image retention for large books.
            with fitz.open(temp) as doc:
                page = doc[number]
                rects = []
                for term in terms:
                    rects.extend(page.search_for(term))
                for rect in rects:
                    page.add_redact_annot(rect, fill=False, cross_out=False)
                if rects:
                    page.apply_redactions(images=0, graphics=0, text=0)
                    report['removed_text'] += len(rects)
                for annot in list(page.annots() or []):
                    content = (annot.info.get('content', '') + ' ' + annot.info.get('title', '')).casefold()
                    if any(term.casefold() in content for term in terms):
                        page.delete_annot(annot)
                        report['removed_annotations'] += 1
                for link in page.get_links():
                    if any(term.casefold() in link.get('uri', '').casefold() for term in terms):
                        page.delete_link(link)
                        report['removed_annotations'] += 1
                for info in page.get_images(full=True):
                    check_cancel()
                    xref, mask, width, height = info[:4]
                    if xref in seen:
                        continue
                    seen.add(xref)
                    placements = page.get_image_rects(xref)
                    if not placements:
                        continue
                    if mask:
                        report['warnings'].append('第 %d 頁：保留含透明遮罩的影像。' % (number + 1))
                        continue
                    target_w = max(width, math.ceil(max(r.width for r in placements) / 72 * dpi))
                    target_h = max(height, math.ceil(max(r.height for r in placements) / 72 * dpi))
                    if (target_w, target_h) == (width, height):
                        continue
                    if target_w * target_h > 85_000_000 or width * height > 85_000_000:
                        report['warnings'].append('第 %d 頁：超大影像保留原尺寸，避免記憶體不足。' % (number + 1))
                        continue
                    pix = fitz.Pixmap(doc, xref)
                    if pix.colorspace is None:
                        report['warnings'].append('第 %d 頁：保留特殊色彩影像。' % (number + 1))
                        continue
                    if pix.n not in (1, 3):
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    array = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
                    if pix.n == 1:
                        array = array[:, :, 0]
                    else:
                        array = cv2.cvtColor(array, cv2.COLOR_RGB2BGR)
                    enlarged = cv2.resize(array, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)
                    if sharpen:
                        # A small 8-bit blur avoids several full-size float buffers.
                        blurred = cv2.GaussianBlur(enlarged, (0, 0), 1.0)
                        cv2.addWeighted(enlarged, 1.14, blurred, -0.14, 0, dst=enlarged)
                        del blurred
                    check_cancel()
                    ok, encoded = cv2.imencode('.png', enlarged, [cv2.IMWRITE_PNG_COMPRESSION, 3])
                    if not ok:
                        raise ValueError('影像編碼失敗，原檔未變更。')
                    page.replace_image(xref, stream=encoded.tobytes())
                    report['enhanced_images'] += 1
                    del pix, array, enlarged, encoded
                    gc.collect()
                if doc.is_dirty:
                    doc.saveIncr()
            progress(number + 1, total, '已處理 %d／%d 頁' % (number + 1, total), time.monotonic() - started)
        check_cancel()
        progress(total, total, '正在壓縮及檢查 PDF，剩餘時間估算中…', time.monotonic() - started)
        # Remove superseded image objects from the incremental working copy.
        with fitz.open(temp) as doc:
            doc.save(destination, garbage=3, deflate=True)
        with fitz.open(destination) as result:
            if result.page_count != total:
                raise ValueError('輸出頁數不符。')
            for number, page in enumerate(result):
                check_cancel()
                actual = (tuple(page.mediabox), tuple(page.cropbox), page.rotation)
                if actual != geometry[number]:
                    raise ValueError('第 %d 頁尺寸或方向不符。' % (number + 1))
                preview = page.get_pixmap(matrix=fitz.Matrix(.25, .25), alpha=False)
                report['pages'].append({'page': number + 1, 'geometry': True, 'rendered': preview.width > 0})
        report['seconds'] = round(time.monotonic() - started, 2)
        report['output_sha256'] = sha256(destination)
        report['source_unchanged'] = sha256(source) == report['input_sha256']
        if not report['source_unchanged']:
            raise ValueError('來源在處理期間被其他程式變更。')
        destination.with_suffix('.report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        return report
    except BaseException:
        # Only our newly created output is removed on failure, never an existing file.
        destination.unlink(missing_ok=True)
        raise
    finally:
        temp.unlink(missing_ok=True)
