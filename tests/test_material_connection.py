import importlib.util
import io
from pathlib import Path
import unittest
import zipfile
import pymupdf

spec=importlib.util.spec_from_file_location('connection',Path(__file__).resolve().parents[1]/'scripts/connect-downloaded-materials.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
plan_spec=importlib.util.spec_from_file_location('household_plans',Path(__file__).resolve().parents[1]/'scripts/connect-household-plans.py')
plan_module=importlib.util.module_from_spec(plan_spec);plan_spec.loader.exec_module(plan_module)


class MaterialConnectionTests(unittest.TestCase):
    def test_pdf_evidence_keeps_page_number(self):
        doc=pymupdf.open();doc.new_page().insert_text((60,60),'Announcement')
        doc.new_page().insert_text((60,60),'floor plan and site plan')
        pages,flags=module.extract(doc.tobytes(),'.pdf');doc.close()
        self.assertIn('floorplan',module.roles(pages[1][1]))
        self.assertEqual(pages[1][0],'page:2')

    def test_blank_pdf_not_counted_as_text(self):
        doc=pymupdf.open();doc.new_page()
        _,flags=module.extract(doc.tobytes(),'.pdf');doc.close()
        self.assertIn('ocr-needed',flags)

    def test_archive_preserves_member_locator_without_writing(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:z.writestr('../floor-plan.txt','floor plan source inside archive')
        pages,_=module.extract(stream.getvalue(),'.zip')
        self.assertTrue(any(k=='entry:../floor-plan.txt/text-chunk:1' and 'floor plan source' in v for k,v in pages))

    def test_hwpx_text_inside_xml(self):
        stream=io.BytesIO()
        with zipfile.ZipFile(stream,'w') as z:z.writestr('Contents/section0.xml','<root><text>동호배치도 101동</text></root>')
        pages,_=module.extract(stream.getvalue(),'.hwpx')
        self.assertTrue(any('unit_layout' in module.roles(t) for _,t in pages))

    def test_equal_area_does_not_choose_a_subtype(self):
        plans={'84F':plan_module.decimal('84.9339'),'84F1':plan_module.decimal('84.9339')}
        keys,status=plan_module.choose('84.9339',set(),plans)
        self.assertEqual(status,'ambiguous-area')
        self.assertEqual(set(keys),{'84F','84F1'})

    def test_provider_unit_evidence_resolves_equal_area(self):
        plans={'84F':plan_module.decimal('84.9339'),'84F1':plan_module.decimal('84.9339')}
        keys,status=plan_module.choose('84.9339',{'84F1'},plans)
        self.assertEqual((keys,status),(['84F1'],'provider-unit-area-consistent'))

    def test_disagreeing_area_remains_a_conflict(self):
        _,status=plan_module.choose('59.95',{'84F'},{'84F':plan_module.decimal('84.9339')})
        self.assertEqual(status,'provider-unit-area-conflict')


if __name__=='__main__':unittest.main()
