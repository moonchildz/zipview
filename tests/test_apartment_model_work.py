import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

spec=importlib.util.spec_from_file_location('work',Path(__file__).resolve().parents[1]/'scripts/apartment-model-work.py')
work=importlib.util.module_from_spec(spec);spec.loader.exec_module(work)


class ApartmentModelWorkTests(unittest.TestCase):
    def test_plan_trace_preserves_unknown_transform(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);image=np.full((400,500,3),255,np.uint8)
            cv2.rectangle(image,(80,70),(420,330),(210,235,245),-1);cv2.rectangle(image,(80,70),(420,330),(20,20,20),8)
            cv2.line(image,(250,70),(250,330),(20,20,20),6);cv2.line(image,(80,200),(420,200),(20,20,20),6)
            source=folder/'plan.png';cv2.imwrite(str(source),image);target=folder/'plan.json'
            old=work.ROOT;work.ROOT=folder
            try:work.trace_plan(dict(providerId='1',areaId='84',variant='basic',image='plan.png',sha256='',area=84,displayType='84A'),'plan.json')
            finally:work.ROOT=old
            result=json.loads(target.read_text(encoding='utf8'))
            self.assertGreater(len(result['draft']['exterior']),3)
            self.assertGreater(len(result['draft']['wallLineCandidates']),1)
            self.assertIn('rotation',result['unknown']);self.assertIn('reflection',result['unknown'])

    def test_unit_stack_keeps_type_exception(self):
        with tempfile.TemporaryDirectory() as folder:
            folder=Path(folder);source=folder/'provider.json';target=folder/'stacks.json'
            source.write_text(json.dumps({'providerId':'1','buildings':[{'building':'101','providerDongId':'d1'}],'units':[{'building':'101','unit':'201','areaId':'a'},{'building':'101','unit':'301','areaId':'a'},{'building':'101','unit':'401','areaId':'b'}]}),encoding='utf8')
            old=work.ROOT;work.ROOT=folder
            try:work.unit_stacks({'source':'provider.json'},'stacks.json')
            finally:work.ROOT=old
            line=json.loads(target.read_text(encoding='utf8'))['buildings'][0]['lines'][0]
            self.assertEqual(line['defaultAreaId'],'a');self.assertEqual(line['exceptions'][0]['areaId'],'b')
            self.assertIsNone(json.loads(target.read_text(encoding='utf8'))['buildings'][0]['geographicTransform']['reflection'])


if __name__=='__main__':unittest.main()
