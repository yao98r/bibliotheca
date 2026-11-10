import tempfile
import threading
import unittest
from pathlib import Path
import fitz
import numpy as np
import cv2
from engine import process_pdf, sha256, Cancelled

class EngineTest(unittest.TestCase):
    def fixture(self, path, pages=2):
        doc = fitz.open()
        image = np.full((140,100,3),240,np.uint8)
        cv2.putText(image,'TEST',(5,70),cv2.FONT_HERSHEY_SIMPLEX,.6,(0,0,0),1)
        data = cv2.imencode('.png',image)[1].tobytes()
        for n in range(pages):
            page=doc.new_page(width=200,height=280)
            page.insert_image(fitz.Rect(20,60,180,250),stream=data)
            page.insert_text((20,25),'Keep this text %d' % n)
            page.insert_text((20,45),'xyz66.ai')
            page.draw_rect(fitz.Rect(10,10,190,270))
            page.insert_link({'kind':fitz.LINK_URI,'from':fitz.Rect(20,20,100,30),'uri':'https://example.com/keep'})
            if n==1: page.set_rotation(90)
        doc.set_toc([[1,'Chapter 1',1]])
        doc.save(path)
        doc.close()
    def test_geometry_text_vectors_links_bookmarks_original_and_watermark(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'來源.pdf';out=Path(tmp)/'輸出.pdf';self.fixture(source)
            original=sha256(source)
            report=process_pdf(source,out,300,['xyz66.ai'])
            self.assertEqual(sha256(source),original)
            self.assertTrue(report['source_unchanged'])
            self.assertGreater(report['enhanced_images'],0)
            with fitz.open(source) as before,fitz.open(out) as after:
                self.assertEqual(after.get_toc(),before.get_toc())
                for n,page in enumerate(after):
                    self.assertIn('Keep this text',page.get_text())
                    self.assertNotIn('xyz66.ai',page.get_text())
                    self.assertEqual(page.rect,before[n].rect)
                    self.assertEqual(page.rotation,before[n].rotation)
                    self.assertEqual(len(page.get_drawings()),len(before[n].get_drawings()))
                    self.assertEqual(page.get_links()[0]['uri'],'https://example.com/keep')
            self.assertTrue(out.with_suffix('.report.json').exists())
    def test_cancel_does_not_leave_output_or_modify_original(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source.pdf';out=Path(tmp)/'out.pdf';self.fixture(source)
            original=sha256(source);stop=threading.Event()
            def progress(current,*args):
                if current: stop.set()
            with self.assertRaises(Cancelled): process_pdf(source,out,300,progress=progress,cancelled=stop.is_set)
            self.assertFalse(out.exists());self.assertEqual(sha256(source),original)
            self.assertEqual(list(Path(tmp).glob('.tianhe-*')),[])
    def test_existing_destination_and_source_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'source.pdf';self.fixture(source);original=sha256(source)
            with self.assertRaises(ValueError): process_pdf(source,source)
            self.assertEqual(sha256(source),original)
            out=Path(tmp)/'existing.pdf';out.write_bytes(b'KEEP')
            with self.assertRaises(ValueError):process_pdf(source,out)
            self.assertEqual(out.read_bytes(),b'KEEP')

if __name__=='__main__':unittest.main()
