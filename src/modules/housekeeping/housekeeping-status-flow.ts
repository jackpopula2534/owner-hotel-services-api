/**
 * ลำดับสถานะงานแม่บ้านบนกระดาน: pending → in_progress → completed → inspected
 *
 * ย้อนได้ทีละ 1 ขั้นเท่านั้น — ข้ามขั้นจะทิ้งข้อมูลที่ขั้นกลางสร้างไว้
 * (เวลาเริ่ม/เวลาเสร็จ/ผลตรวจ) แบบที่ไม่มีใครตั้งใจ
 */
export const HK_REVERT_TO: Readonly<Record<string, string>> = Object.freeze({
  in_progress: 'pending',
  completed: 'in_progress',
  inspected: 'completed',
});

export type HkStatusAction = 'start' | 'complete' | 'inspect' | 'revert' | 'cancel' | 'update';

/** ฟิลด์ที่ต้องล้างเมื่อย้อนออกจากสถานะนั้น — ให้การ์ดกลับไปหน้าตาเหมือนตอนอยู่ขั้นก่อน */
export const revertClearFields = (fromStatus: string): Record<string, null> => {
  switch (fromStatus) {
    case 'in_progress':
      return { actualStartTime: null, startTime: null };
    case 'completed':
      return {
        actualEndTime: null,
        endTime: null,
        actualDuration: null,
        completionPercentage: null,
        roomReadyAt: null,
      };
    case 'inspected':
      return {
        rating: null,
        inspectionNotes: null,
        inspectedById: null,
        inspectedByName: null,
        inspectedAt: null,
      };
    default:
      return {};
  }
};
