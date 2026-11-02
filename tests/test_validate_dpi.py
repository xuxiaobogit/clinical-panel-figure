import importlib.util
import struct
import unittest
import zlib
from pathlib import Path

spec = importlib.util.spec_from_file_location('validate_dpi',Path(__file__).resolve().parents[1]/'validate_dpi.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def chunk(kind, payload):
    return struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)&0xffffffff)


def png(width=4110, height=2, x=23622, y=23622, unit=1, pixels=True,
        duplicate=False, raw=None):
    ihdr=struct.pack('>IIBBBBB',width,height,8,2,0,0,0)
    phys=chunk(b'pHYs',struct.pack('>IIB',x,y,unit))
    return (module.PNG_SIG+chunk(b'IHDR',ihdr)+phys+(phys if duplicate else b'')+
            (chunk(b'IDAT',zlib.compress(raw if raw is not None else (b'\x00'+b'\xff\x00\x00'*width)*height)) if pixels else b'')+
            chunk(b'IEND',b''))


class AuditTests(unittest.TestCase):
    def test_correct_default(self):
        self.assertEqual(module.audit_png(png(),174,600)['width'],4110)

    def test_quantized_metadata_does_not_reject_valid_rounding(self):
        for mm,dpi,width in [(168,600,3969),(84,1200,3969),(209,300,2469),(100,72,283)]:
            ppm=int(dpi/.0254+.5)
            self.assertEqual(module.audit_png(png(width=width,x=ppm,y=ppm),mm,dpi)['width'],width)
            self.assertEqual(module.audit_png(png(width=width,x=ppm,y=ppm),mm)['width'],width)

    def test_invalid_resolution_and_structure_rejected(self):
        for data in [png(unit=0),png(y=11811),png(x=0),png(y=0),png(pixels=False),
                     png(duplicate=True),png()[:-12],png()+b'x',png(raw=b'\0'),
                     png(raw=b'\x05'+b'\0'*(4110*3)+(b'\0'+b'\0'*(4110*3)))]:
            with self.subTest(data_length=len(data)):
                with self.assertRaises(ValueError): module.audit_png(data,174,600)

    def test_crc_corruption_rejected(self):
        data=bytearray(png());data[30]^=1
        with self.assertRaises(ValueError): module.audit_png(bytes(data))

    def test_actual_wrong_width_and_dpi_rejected(self):
        for kwargs in [{'width_mm':173,'expect_dpi':600},{'expect_dpi':300},{'width_mm':0}]:
            with self.assertRaises(ValueError):module.audit_png(png(),**kwargs)

    def test_palette_index_is_validated(self):
        header=struct.pack('>IIBBBBB',1,1,8,3,0,0,0)
        data=(module.PNG_SIG+chunk(b'IHDR',header)+chunk(b'PLTE',b'\0\0\0')+
              chunk(b'pHYs',struct.pack('>IIB',23622,23622,1))+
              chunk(b'IDAT',zlib.compress(b'\0\x01'))+chunk(b'IEND',b''))
        with self.assertRaisesRegex(ValueError,'palette'):module.audit_png(data)


if __name__=='__main__':unittest.main()
