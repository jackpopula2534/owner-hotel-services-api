export const CRM_CAMPAIGN_QUEUE = 'crm-campaigns';

export const CAMPAIGN_JOB = {
  DISPATCH: 'dispatch',
  DELIVER_ONE: 'deliver-one',
} as const;

export interface DispatchJobData {
  campaignId: string;
  tenantId: string;
}

export interface DeliverOneJobData {
  deliveryId: string;
  campaignId: string;
  tenantId: string;
}
