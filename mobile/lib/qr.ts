import qrcode from 'qrcode-generator';

// The QR as a square grid of dark/light modules. Pure JavaScript (no native
// module, no SVG dependency), so it renders anywhere React Native does and
// is straightforward to test.
export function qrMatrix(payload: string): boolean[][] {
  // Type number 0 = pick the smallest that fits; 'M' error correction
  // survives a scuffed or glared screen far better than 'L'.
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const size = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < size; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < size; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}
