import { Injectable } from '@nestjs/common';
import { EmailChannelAdapter } from './email.adapter';
import { LineChannelAdapter } from './line.adapter';
import { SmsChannelAdapter } from './sms.adapter';
import { PushChannelAdapter } from './push.adapter';
import { ChannelAdapter, ChannelName } from './channel.types';

/**
 * Single lookup point for outbound adapters.
 * Campaign processor calls registry.resolve(channel).send(message).
 */
@Injectable()
export class ChannelRegistry {
  private readonly adapters: Map<ChannelName, ChannelAdapter>;

  constructor(
    email: EmailChannelAdapter,
    line: LineChannelAdapter,
    sms: SmsChannelAdapter,
    push: PushChannelAdapter,
  ) {
    this.adapters = new Map<ChannelName, ChannelAdapter>([
      ['email', email],
      ['line', line],
      ['sms', sms],
      ['push', push],
    ]);
  }

  resolve(channel: string): ChannelAdapter | null {
    return this.adapters.get(channel as ChannelName) ?? null;
  }

  has(channel: string): boolean {
    return this.adapters.has(channel as ChannelName);
  }

  listAvailable(): ChannelName[] {
    return Array.from(this.adapters.keys());
  }
}
