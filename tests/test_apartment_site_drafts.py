import importlib.util
from pathlib import Path
import unittest

spec=importlib.util.spec_from_file_location('site',Path(__file__).resolve().parents[1]/'scripts/build-apartment-site-drafts.py')
site=importlib.util.module_from_spec(spec);spec.loader.exec_module(site)


class SiteDraftTests(unittest.TestCase):
    def test_road_address_key(self):
        self.assertEqual(site.road_key('서울특별시 서대문구 북아현로1길 50'),('북아현로1길',50,0))
        self.assertEqual(site.road_key('서울 강남구 테헤란로 12-3'),('테헤란로',12,3))

    def test_dong_number(self):
        self.assertEqual(site.dong_number('경희궁자이 204동'),'204')
        self.assertEqual(site.dong_number('상가동'),None)


if __name__=='__main__':unittest.main()
