/**
 * ตรวจไฟล์โมเดล .glb (glTF 2.0 binary) ที่ผู้ใช้อัปโหลด — ไม่โหลด geometry จริง
 * อ่านแค่ header + JSON chunk เพื่อกัน 3 อย่าง:
 *  1) ไฟล์ปลอม/เสีย (magic, version, ความยาวไม่ตรง)
 *  2) uri ภายนอก — buffers/images ที่ชี้ไป URL อื่นทำให้เบราว์เซอร์ของแขกไปดึงไฟล์จากที่อื่น
 *  3) ส่วนขยายที่ต้องมีตัวถอดรหัสเพิ่ม (draco/meshopt) — หน้าเว็บเราไม่ได้โหลดไว้ จะเปิดไม่ขึ้น
 */

export class GlbValidationError extends Error {}

const GLB_MAGIC = 0x46546c67; // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
/** ส่วนขยายที่ three GLTFLoader อ่านได้เองโดยไม่ต้องตั้งตัวถอดรหัสเพิ่ม */
const UNSUPPORTED_REQUIRED = new Set([
  'KHR_draco_mesh_compression',
  'EXT_meshopt_compression',
  'KHR_texture_basisu',
]);

export interface GlbSummary {
  meshes: number;
  nodes: number;
}

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function assertEmbedded(list: unknown, kind: string): void {
  if (list === undefined) return;
  if (!Array.isArray(list)) throw new GlbValidationError(`ไฟล์โมเดลเสีย (${kind})`);
  for (const item of list) {
    if (!isObj(item) || item.uri === undefined) continue;
    if (typeof item.uri !== 'string' || !item.uri.startsWith('data:')) {
      throw new GlbValidationError(
        'โมเดลอ้างไฟล์ภายนอก — export เป็น .glb แบบรวมไฟล์ในตัว (embedded) แล้วอัปโหลดใหม่',
      );
    }
  }
}

/** @throws GlbValidationError ข้อความภาษาไทยที่แสดงให้ผู้ใช้ได้ */
export function validateGlb(buf: Buffer): GlbSummary {
  if (buf.length < HEADER_BYTES + CHUNK_HEADER_BYTES || buf.readUInt32LE(0) !== GLB_MAGIC) {
    throw new GlbValidationError('ไม่ใช่ไฟล์ .glb (glTF binary)');
  }
  if (buf.readUInt32LE(4) !== 2) throw new GlbValidationError('รองรับเฉพาะ glTF 2.0');
  if (buf.readUInt32LE(8) !== buf.length) throw new GlbValidationError('ไฟล์โมเดลไม่ครบหรือเสีย');

  const jsonLength = buf.readUInt32LE(HEADER_BYTES);
  const jsonStart = HEADER_BYTES + CHUNK_HEADER_BYTES;
  if (buf.readUInt32LE(HEADER_BYTES + 4) !== CHUNK_JSON || jsonStart + jsonLength > buf.length) {
    throw new GlbValidationError('ไฟล์โมเดลเสีย (ไม่พบส่วน JSON)');
  }

  let json: unknown;
  try {
    json = JSON.parse(buf.subarray(jsonStart, jsonStart + jsonLength).toString('utf8'));
  } catch {
    throw new GlbValidationError('ไฟล์โมเดลเสีย (JSON อ่านไม่ได้)');
  }
  if (!isObj(json)) throw new GlbValidationError('ไฟล์โมเดลเสีย (JSON อ่านไม่ได้)');

  assertEmbedded(json.buffers, 'buffers');
  assertEmbedded(json.images, 'images');

  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  const blocked = required.filter(
    (e): e is string => typeof e === 'string' && UNSUPPORTED_REQUIRED.has(e),
  );
  if (blocked.length) {
    throw new GlbValidationError(
      `โมเดลถูกบีบอัดด้วย ${blocked.join(', ')} ซึ่งยังไม่รองรับ — export ใหม่โดยปิดการบีบอัด`,
    );
  }

  const meshes = Array.isArray(json.meshes) ? json.meshes.length : 0;
  if (meshes === 0) throw new GlbValidationError('ไฟล์โมเดลไม่มีชิ้นงาน 3D (mesh)');
  return { meshes, nodes: Array.isArray(json.nodes) ? json.nodes.length : 0 };
}
