import { ChannelRegistry } from './channel.registry';
import { EmailChannelAdapter } from './email.adapter';
import { LineChannelAdapter } from './line.adapter';
import { SmsChannelAdapter } from './sms.adapter';
import { PushChannelAdapter } from './push.adapter';
import { ChannelAdapter, OutboundMessage, SendResult } from './channel.types';

function mkAdapter(name: ChannelAdapter['channel']): ChannelAdapter {
  return {
    channel: name,
    canSend: () => true,
    send: async (): Promise<SendResult> => ({ success: true }),
  };
}

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry;

  beforeEach(() => {
    registry = new ChannelRegistry(
      mkAdapter('email') as EmailChannelAdapter,
      mkAdapter('line') as LineChannelAdapter,
      mkAdapter('sms') as SmsChannelAdapter,
      mkAdapter('push') as PushChannelAdapter,
    );
  });

  it('lists all 4 channels', () => {
    expect(registry.listAvailable().sort()).toEqual(['email', 'line', 'push', 'sms']);
  });

  it('resolves a registered channel', () => {
    expect(registry.resolve('email')).not.toBeNull();
    expect(registry.resolve('line')).not.toBeNull();
  });

  it('returns null for unknown channel', () => {
    expect(registry.resolve('telegram')).toBeNull();
  });

  it('has() reflects registration', () => {
    expect(registry.has('sms')).toBe(true);
    expect(registry.has('whatsapp')).toBe(false);
  });
});

describe('EmailChannelAdapter.canSend', () => {
  it('validates basic email format', () => {
    const adapter = new EmailChannelAdapter({} as never);
    const msg: OutboundMessage = {
      tenantId: 't1',
      recipient: 'a@b.c',
      guestId: 'g1',
      subject: 's',
      templateKey: null,
      bodyOverride: null,
    };
    expect(adapter.canSend(msg)).toBe(true);
    expect(adapter.canSend({ ...msg, recipient: 'not-an-email' })).toBe(false);
    expect(adapter.canSend({ ...msg, recipient: '' })).toBe(false);
  });
});

describe('SmsChannelAdapter.canSend', () => {
  it('validates phone format', () => {
    const adapter = new SmsChannelAdapter();
    const base = {
      tenantId: 't1',
      guestId: 'g1',
      subject: null,
      templateKey: null,
      bodyOverride: null,
    };
    expect(adapter.canSend({ ...base, recipient: '+66812345678' })).toBe(true);
    expect(adapter.canSend({ ...base, recipient: '0812345678' })).toBe(true);
    expect(adapter.canSend({ ...base, recipient: 'abc' })).toBe(false);
    expect(adapter.canSend({ ...base, recipient: '123' })).toBe(false);
  });
});
