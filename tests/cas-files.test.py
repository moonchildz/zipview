import importlib.util, tempfile, unittest, struct
from pathlib import Path
spec=importlib.util.spec_from_file_location('cas_files',Path(__file__).resolve().parents[1]/'scripts/verify-cas-files.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class FileChecks(unittest.TestCase):
    def test_missing_and_truncated_rgb(self):
        with tempfile.TemporaryDirectory() as folder:
            p=Path(folder);scene='C1_20211024021358_03282_00201284';prefix=scene+'_L2G_'
            self.assertEqual(module.verify(p,scene)['status'],'pending')
            groups=[('PS3','R_PS'),('PS2','G_PS'),('PS1','B_PS')]
            xml='<root><Image>'+''.join(f'<{g}><ImageFilename>{prefix}{b}.tif</ImageFilename><ImageSize><Width>20</Width><Height>20</Height></ImageSize></{g}>' for g,b in groups)+'</Image></root>'
            (p/(prefix+'Aux.xml')).write_text(xml)
            tags=[(256,20),(257,20),(258,16),(259,1),(277,1),(273,98),(279,800)]
            header=b'II'+struct.pack('<HIH',42,8,len(tags))+b''.join(struct.pack('<HHII',tag,4,1,value) for tag,value in tags)+b'\0'*4
            for _,b in groups:(p/(prefix+b+'.tif')).write_bytes(header+b'\0'*800)
            self.assertEqual(module.verify(p,scene)['status'],'downloaded-header-checked')
            (p/(prefix+'B_PS.tif')).write_bytes(header+b'\0'*799)
            self.assertEqual(module.verify(p,scene)['status'],'partial')
            (p/(prefix+'Aux.xml')).write_text(xml.replace(prefix+'R_PS','WRONG_R_PS'))
            with self.assertRaisesRegex(ValueError,'identity'):module.verify(p,scene)

if __name__=='__main__':unittest.main()
