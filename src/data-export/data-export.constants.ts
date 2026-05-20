export const DATA_EXPORT_QUEUE = 'data-export';

export const DATA_EXPORT_JOBS = {
  PROCESS_EXPORT: 'process-export',
  PROCESS_ERASURE: 'process-erasure',
} as const;

export interface DataExportJobData {
  requestId: string;
  tenantId: string;
  userId?: string;
  kind: 'export' | 'erasure';
}
