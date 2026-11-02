#!/usr/bin/env python3
"""Audit PNG structure, decompressed scanlines, both DPI axes and physical width.

Python standard library only. Rejects missing/duplicate pHYs, unitless or
nonpositive resolution, CRC errors, incomplete images and broken IDAT data.
Pixel rounding and integer pixels/metre metadata quantization are distinct.
This validates the exported canvas, not effective source-image detail.
Exit codes: 0 valid, 1 failed audit, 2 invalid CLI/file access.
"""
import argparse
import math
import struct
import sys
import zlib

PNG_SIG = b"\x89PNG\r\n\x1a\n"
HALF_PPM_DPI = 0.0254 / 2
MAX_DECODED_BYTES = 512 * 1024 * 1024


def iter_chunks(data):
    if data[:8] != PNG_SIG:
        raise ValueError("not a PNG file (bad signature)")
    offset = 8
    ended = False
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError("truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError("truncated PNG chunk payload")
        kind = data[offset+4:offset+8]
        payload = data[offset+8:offset+8+length]
        crc = struct.unpack_from(">I", data, offset+8+length)[0]
        if zlib.crc32(kind+payload) & 0xffffffff != crc:
            raise ValueError(f"invalid CRC in {kind!r}")
        yield kind, payload, crc
        offset = end
        if kind == b"IEND":
            if length:
                raise ValueError("IEND must be empty")
            ended = True
            if offset != len(data):
                raise ValueError("unexpected bytes after IEND")
            break
    if not ended:
        raise ValueError("missing IEND")


def _paeth(a, b, c):
    prediction = a+b-c
    da, db, dc = abs(prediction-a), abs(prediction-b), abs(prediction-c)
    return a if da <= db and da <= dc else b if db <= dc else c


def _check_scanlines(raw, passes, bits_per_pixel, depth, palette_size=None):
    """Reverse PNG filters; indexed images also require valid palette indices."""
    offset = 0
    bpp = max(1, (bits_per_pixel+7)//8)
    for width, height in passes:
        row_bytes = (width*bits_per_pixel+7)//8
        previous = bytearray(row_bytes)
        for _ in range(height):
            filter_type = raw[offset]
            if filter_type > 4:
                raise ValueError("invalid scanline filter")
            # For non-indexed colors every filtered byte sequence maps to legal samples.
            # Only indexed pixels need full unfiltering to validate palette bounds.
            if palette_size is None:
                offset += row_bytes+1
                continue
            row = bytearray(raw[offset+1:offset+1+row_bytes])
            if filter_type:
                for index in range(row_bytes):
                    left = row[index-bpp] if index >= bpp else 0
                    above = previous[index]
                    upper_left = previous[index-bpp] if index >= bpp else 0
                    prediction = (left if filter_type == 1 else above if filter_type == 2
                                  else (left+above)//2 if filter_type == 3 else _paeth(left,above,upper_left))
                    row[index] = (row[index]+prediction) & 255
            if palette_size is not None:
                mask = (1 << depth)-1
                for x in range(width):
                    value = (row[x*depth//8] >> (8-depth-(x*depth % 8))) & mask
                    if value >= palette_size:
                        raise ValueError("indexed pixel exceeds PLTE palette")
            previous = row
            offset += row_bytes+1


def audit_png(data, width_mm=None, expect_dpi=None):
    for value, label in ((width_mm,"width-mm"),(expect_dpi,"expect-dpi")):
        if value is not None and (not math.isfinite(value) or value <= 0):
            raise ValueError(f"{label} must be positive and finite")
    chunks = list(iter_chunks(data))
    if not chunks or chunks[0][0] != b"IHDR" or len(chunks[0][1]) != 13:
        raise ValueError("PNG must begin with a 13-byte IHDR")
    kinds = [kind for kind, _, _ in chunks]
    if kinds.count(b"IHDR") != 1 or kinds.count(b"IEND") != 1:
        raise ValueError("duplicate or missing required chunks")
    width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", chunks[0][1])
    legal_depths = {0:(1,2,4,8,16), 2:(8,16), 3:(1,2,4,8), 4:(8,16), 6:(8,16)}
    if not (0 < width < 2**31 and 0 < height < 2**31):
        raise ValueError("invalid dimensions")
    if depth not in legal_depths.get(color, ()) or compression or filtering or interlace not in (0,1):
        raise ValueError("invalid IHDR encoding")
    for kind in kinds:
        if len(kind) != 4 or not all(65 <= n <= 90 or 97 <= n <= 122 for n in kind):
            raise ValueError("invalid PNG chunk type")
        if not kind[0] & 32 and kind not in (b"IHDR",b"PLTE",b"IDAT",b"IEND"):
            raise ValueError(f"unknown critical chunk {kind!r}")
    if b"IDAT" not in kinds:
        raise ValueError("missing image data (IDAT)")
    first, last = kinds.index(b"IDAT"), len(kinds)-1-kinds[::-1].index(b"IDAT")
    if any(kind != b"IDAT" for kind in kinds[first:last+1]):
        raise ValueError("IDAT chunks must be consecutive")
    palettes = [payload for kind,payload,_ in chunks if kind == b"PLTE"]
    palette_size = None
    if len(palettes) > 1 or (palettes and kinds.index(b"PLTE") > first):
        raise ValueError("duplicate or misplaced PLTE")
    if palettes:
        if not len(palettes[0]) or len(palettes[0]) % 3 or len(palettes[0]) > 768 or color in (0,4):
            raise ValueError("invalid PLTE")
        if color == 3:
            palette_size = len(palettes[0])//3
            if palette_size > 2**depth:
                raise ValueError("palette exceeds indexed bit depth")
    if color == 3 and palette_size is None:
        raise ValueError("indexed PNG requires PLTE")
    if kinds.count(b"pHYs") != 1:
        raise ValueError("PNG requires exactly one pHYs resolution chunk")
    phys_index = kinds.index(b"pHYs")
    phys_data = chunks[phys_index][1]
    if phys_index > first or len(phys_data) != 9:
        raise ValueError("pHYs must be 9 bytes and precede IDAT")
    x_ppm, y_ppm, unit = struct.unpack(">IIB", phys_data)
    if unit != 1 or not x_ppm or not y_ppm:
        raise ValueError("pHYs must declare positive resolution on both axes, in metres (unit=1)")
    if x_ppm != y_ppm:
        raise ValueError("horizontal and vertical DPI differ")
    channels = {0:1,2:3,3:1,4:2,6:4}[color]
    bits = channels*depth
    passes = [(width,height)]
    if interlace:
        passes = []
        for x,y,dx,dy in ((0,0,8,8),(4,0,8,8),(0,4,4,8),(2,0,4,4),(0,2,2,4),(1,0,2,2),(0,1,1,2)):
            pw, ph = max(0,(width-x+dx-1)//dx), max(0,(height-y+dy-1)//dy)
            if pw and ph:
                passes.append((pw,ph))
    expected_bytes = sum((((pw*bits+7)//8)+1)*ph for pw,ph in passes)
    if expected_bytes > MAX_DECODED_BYTES:
        raise ValueError("decoded PNG exceeds audit limit of 512 MiB")
    compressed = b"".join(payload for kind,payload,_ in chunks if kind == b"IDAT")
    inflater = zlib.decompressobj()
    try:
        raw = inflater.decompress(compressed, expected_bytes+1)
    except zlib.error as error:
        raise ValueError(f"invalid compressed image data: {error}") from error
    if len(raw) != expected_bytes or not inflater.eof or inflater.unused_data or inflater.unconsumed_tail:
        raise ValueError("incomplete, excess or invalid decompressed image data")
    _check_scanlines(raw, passes, bits, depth, palette_size)
    dpi_x, dpi_y = x_ppm*0.0254, y_ppm*0.0254
    if expect_dpi is not None and any(abs(dpi-expect_dpi) > HALF_PPM_DPI+1e-8 for dpi in (dpi_x,dpi_y)):
        raise ValueError(f"DPI mismatch: {dpi_x:g} x {dpi_y:g}; expected {expect_dpi:g}")
    if width_mm is not None:
        if expect_dpi is not None:
            expected_width = math.floor(width_mm/25.4*expect_dpi+0.5)
            matches = width == expected_width
        else:
            expected_width = width_mm/25.4*dpi_x
            # Unknown intended DPI: allow both half-pixel raster rounding and half-ppm metadata rounding.
            matches = abs(width-expected_width) <= 0.5+width_mm/25.4*HALF_PPM_DPI+1e-8
        if not matches:
            raise ValueError(f"pixel-width mismatch: {width}; expected {expected_width:g}")
    return {"width":width,"height":height,"dpi_x":dpi_x,"dpi_y":dpi_y,
            "width_mm":width/dpi_x*25.4,"height_mm":height/dpi_y*25.4}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("png")
    parser.add_argument("--width-mm", type=float)
    parser.add_argument("--expect-dpi", type=float)
    args = parser.parse_args()
    try:
        with open(args.png,"rb") as stream:
            result = audit_png(stream.read(), args.width_mm, args.expect_dpi)
    except OSError as error:
        print(f"ERROR: {error}",file=sys.stderr)
        return 2
    except (ValueError,struct.error,OverflowError) as error:
        print(f"FAILED: {error}",file=sys.stderr)
        return 1
    print(f"pixels        : {result['width']} x {result['height']}")
    print(f"DPI (x/y)     : {result['dpi_x']:.6f} x {result['dpi_y']:.6f}")
    print(f"implied mm    : {result['width_mm']:.4f} x {result['height_mm']:.4f}")
    print("RESULT: OK — PNG decoded, CRCs and resolution valid. Canvas sampling does not prove source-image detail.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
