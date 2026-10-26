/** สร้างไฟล์ .glb เล็กที่สุดสำหรับเทสต์ — JSON chunk อย่างเดียว (ไม่มี BIN) */
export function makeGlb(json: Record<string, unknown>, opts: { version?: number } = {}): Buffer {
  let text = JSON.stringify(json);
  while (Buffer.byteLength(text) % 4) text += ' ';
  const body = Buffer.from(text, 'utf8');
  const header = Buffer.alloc(20);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(opts.version ?? 2, 4);
  header.writeUInt32LE(20 + body.length, 8);
  header.writeUInt32LE(body.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  return Buffer.concat([header, body]);
}
