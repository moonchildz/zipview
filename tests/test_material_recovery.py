import importlib.util
import io
from pathlib import Path
import sqlite3
import unittest
import zipfile

spec=importlib.util.spec_from_file_location('recovery',Path(__file__).resolve().parents[1]/'scripts/recover-material-text.py')
recovery=importlib.util.module_from_spec(spec);spec.loader.exec_module(recovery)


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.db=sqlite3.connect(':memory:')
        self.db.executescript('''CREATE TABLE entities(id,source,name,address);
        CREATE TABLE attachments(entity,file);
        CREATE TABLE evidence(entity,file,locator,role,basis,snippet);
        CREATE TABLE links(source,target,method,status,file,locator,evidence);
        INSERT INTO entities VALUES('kb:1','kb','테스트아파트','서울특별시 시험대로 12');
        INSERT INTO attachments VALUES('lh:1','test.pdf');''')
        self.auto=recovery.matcher(self.db)

    def tearDown(self): self.db.close()

    def test_repeated_recovery_preserves_other_evidence(self):
        self.db.execute("INSERT INTO evidence VALUES('lh:1','test.pdf','page:1','floorplan','source-original','original')")
        for _ in range(2):
            recovery.connect(self.db,self.auto,'test.pdf',[('page:2','테스트아파트 시험대로 12 평면도')],'ocr-text-candidate')
        self.assertEqual(self.db.execute('SELECT count(*) FROM evidence').fetchone()[0],2)
        self.assertEqual(self.db.execute('SELECT count(*) FROM links').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT status,locator FROM links').fetchone(),('candidate','page:2'))

    def test_name_only_stays_weak_and_address_prefix_does_not_match(self):
        recovery.connect(self.db,self.auto,'test.pdf',[('page:1','테스트아파트 시험대로 123 평면도')],'ocr-text-candidate')
        self.assertEqual(self.db.execute('SELECT status,method FROM links').fetchone(),('weak','recovery-ocr-name'))

    def test_nested_archive_preserves_locator(self):
        inner=io.BytesIO()
        with zipfile.ZipFile(inner,'w') as z:z.writestr('scan.pdf',b'PDF')
        outer=io.BytesIO()
        with zipfile.ZipFile(outer,'w') as z:z.writestr('plans.zip',inner.getvalue())
        self.assertEqual(list(recovery.documents(outer.getvalue(),'.zip')),[('entry:plans.zip/entry:scan.pdf/',b'PDF')])


if __name__=='__main__':unittest.main()
