export function normalizePagination(
  pageInput: unknown,
  limitInput: unknown,
  defaultLimit = 20,
  maxLimit = 100,
): { page: number; limit: number; skip: number } {
  const parsedPage =
    typeof pageInput === 'number' ? pageInput : Number.parseInt(String(pageInput ?? ''), 10);
  const parsedLimit =
    typeof limitInput === 'number' ? limitInput : Number.parseInt(String(limitInput ?? ''), 10);

  const page = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  const limit =
    Number.isFinite(parsedLimit) && parsedLimit > 0
      ? Math.min(maxLimit, Math.floor(parsedLimit))
      : defaultLimit;

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

/**
 * ห่อผลลัพธ์รายการแบบแบ่งหน้าให้มี `meta` ด้วย — apiClient ฝั่งหน้าเว็บแกะ `{ success, data }`
 * ทิ้งเหลือแค่ array ถ้าไม่มี `meta` ตัวเลข `total` จึงหายไปเงียบ ๆ (การ์ดสถิติ/เลขหน้าเป็น 0)
 * คง `total/page/limit` ไว้ที่ระดับบนด้วยเพื่อไม่ให้ผู้เรียกเดิมพัง
 */
export function withPaginationMeta<T extends { data: unknown; total: number }>(
  result: T & { page?: number; limit?: number },
): T & { success: true; meta: { total: number; page?: number; limit?: number } } {
  return {
    success: true,
    ...result,
    meta: { total: result.total, page: result.page, limit: result.limit },
  };
}
