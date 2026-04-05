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
