#!/usr/bin/env python3
"""
validate_dpi.py - audit the real resolution of a PNG exported by
Clinical Panel Figure Builder (or any PNG).

It independently decodes the raw PNG bytes - no image library, no trust in
the exporting program - and reports:

  * the true pixel dimensions          (from the IHDR chunk)
  * the embedded physical resolution   (from the pHYs chunk), converted to DPI
  * the physical size that pixels + DPI imply
  * whether the pHYs chunk's CRC is valid (i.e. the metadata isn't corrupt)

With --width-mm it verifies the round trip that the tool promises:
    pixels == round(width_mm / 25.4 * dpi)
i.e. the file genuinely *is* the resolution it claims, at the physical
width you intended. With --expect-dpi it checks the embedded DPI value.

Exit code is 0 when everything is self-consistent, 1 on any mismatch.
Python 3 standard library only.

Examples:
    python validate_dpi.py Figure-complete-600dpi.png
    python validate_dpi.py Figure-complete-600dpi.png --width-mm 174 --expect-dpi 600
"""
import argparse
import struct
import sys
import zlib

PNG_SIG = b"\x89PNG\r\n\x1a\n"


def iter_chunks(data):
    """Yield (type, data, declared_crc) for every chunk in a PNG byte string."""
    if data[:8] != PNG_SIG:
        raise ValueError("not a PNG file (bad 8-byte signature)")
    off = 8
    while off + 8 <= len(data):
        (length,) = struct.unpack(">I", data[off:off + 4])
        ctype = data[off + 4:off + 8]
        cdata = data[off + 8:off + 8 + length]
        (crc,) = struct.unpack(">I", data[off + 8 + length:off + 12 + length])
        yield ctype, cdata, crc
        off += 12 + length
        if ctype == b"IEND":
            break


def main():
    ap = argparse.ArgumentParser(
        description="Audit a PNG's real pixel count and embedded DPI.")
    ap.add_argument("png", help="path to the PNG file to inspect")
    ap.add_argument("--width-mm", type=float, default=None,
                    help="intended physical width (mm); checks "
                         "pixels == round(width_mm/25.4*dpi)")
    ap.add_argument("--expect-dpi", type=float, default=None,
                    help="expected DPI; checks the embedded pHYs value matches")
    args = ap.parse_args()

    with open(args.png, "rb") as f:
        data = f.read()

    ihdr = None
    phys = None
    phys_crc_ok = None
    for ctype, cdata, crc in iter_chunks(data):
        if ctype == b"IHDR":
            ihdr = struct.unpack(">II", cdata[:8])           # width, height
        elif ctype == b"pHYs":
            ppu_x, ppu_y = struct.unpack(">II", cdata[:8])
            unit = cdata[8]
            phys = (ppu_x, ppu_y, unit)
            phys_crc_ok = (zlib.crc32(ctype + cdata) & 0xffffffff) == crc

    if not ihdr:
        print("ERROR: no IHDR chunk - not a valid PNG", file=sys.stderr)
        sys.exit(2)

    px_w, px_h = ihdr
    ok = True
    dpi_x = dpi_y = None

    print(f"file          : {args.png}")
    print(f"pixels (IHDR) : {px_w} x {px_h} px")

    if phys is None:
        print("pHYs chunk    : ABSENT - no embedded resolution "
              "(viewers fall back to a guess, usually 72 dpi)")
        ok = False
    else:
        ppu_x, ppu_y, unit = phys
        if unit == 1:                                        # 1 = pixels per metre
            dpi_x = ppu_x * 0.0254
            dpi_y = ppu_y * 0.0254
            print(f"pHYs          : {ppu_x} x {ppu_y} px/metre  ->  "
                  f"{dpi_x:.1f} x {dpi_y:.1f} dpi")
        else:
            print(f"pHYs          : {ppu_x} x {ppu_y} px/unit "
                  f"(unit code {unit}: aspect only, no absolute scale)")
        print(f"pHYs CRC      : {'valid' if phys_crc_ok else 'INVALID (corrupt)'}")
        ok = ok and bool(phys_crc_ok)
        if dpi_x:
            mm_w = px_w / dpi_x * 25.4
            mm_h = px_h / dpi_y * 25.4
            print(f"implied size  : {mm_w:.2f} x {mm_h:.2f} mm "
                  f"at the embedded resolution")

    if args.expect_dpi is not None and dpi_x is not None:
        match = abs(dpi_x - args.expect_dpi) < 0.5
        print(f"expect-dpi    : {args.expect_dpi:g} dpi  ->  "
              f"{'MATCH' if match else 'MISMATCH'}")
        ok = ok and match

    if args.width_mm is not None and dpi_x is not None:
        expected_px = round(args.width_mm / 25.4 * dpi_x)
        match = expected_px == px_w
        print(f"width check   : round({args.width_mm:g}/25.4 * {dpi_x:.0f}) "
              f"= {expected_px} px  vs  actual {px_w} px  ->  "
              f"{'MATCH' if match else 'MISMATCH'}")
        ok = ok and match

    print()
    print("RESULT        :",
          "OK - pixels and embedded DPI are self-consistent."
          if ok else "FAILED - see mismatch(es) above.")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
