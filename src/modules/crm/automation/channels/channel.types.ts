/**
 * Common types for outbound channel adapters.
 * Each adapter implements ChannelAdapter and is keyed by ChannelName.
 */
export type ChannelName = 'email' | 'line' | 'sms' | 'push';

export interface OutboundMessage {
  tenantId: string;
  recipient: string; // email address / LINE userId / phone / FCM token (depends on channel)
  guestId: string | null;
  subject: string | null;
  templateKey: string | null;
  bodyOverride: string | null;
  context?: Record<string, unknown>;
}

export interface SendResult {
  success: boolean;
  providerMessageId?: string;
  errorMessage?: string;
}

export interface ChannelAdapter {
  readonly channel: ChannelName;
  /** Returns true if the message can be sent through this adapter. */
  canSend(message: OutboundMessage): boolean;
  /** Send a single message. MUST NOT throw — always return SendResult. */
  send(message: OutboundMessage): Promise<SendResult>;
}
