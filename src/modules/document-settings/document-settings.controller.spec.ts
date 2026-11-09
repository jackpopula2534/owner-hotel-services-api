import { Reflector } from '@nestjs/core';
import { DocumentSettingsController } from './document-settings.controller';
import { ALLOW_SYSTEMS_KEY, SystemContext } from '@/common/decorators/allow-systems.decorator';

/**
 * `SystemGuard` is global and default-deny: a POS token reaches only the
 * handlers that name 'pos' in `@AllowSystems`. The POS asks for document
 * settings on every screen — the receipt has to carry the registered entity's
 * legal name, tax id and branch — and while that call was refused the terminal
 * showed "คุณไม่มีสิทธิ์เข้าถึงส่วนนี้" on top of a working till.
 *
 * The read is opened; the writes stay shut. A cashier's tablet must never be
 * able to rewrite the tax identity that gets printed on invoices.
 */
describe('DocumentSettingsController — POS allowlist', () => {
  const reflector = new Reflector();

  const allowedSystems = (handler: unknown): SystemContext[] | undefined =>
    reflector.get<SystemContext[]>(ALLOW_SYSTEMS_KEY, handler as () => unknown);

  it('lets a POS token read the settings', () => {
    expect(allowedSystems(DocumentSettingsController.prototype.get)).toEqual(['pos']);
  });

  it.each([
    ['update', DocumentSettingsController.prototype.update],
    ['uploadLogo', DocumentSettingsController.prototype.uploadLogo],
    ['removeLogo', DocumentSettingsController.prototype.removeLogo],
  ])('keeps %s closed to POS tokens', (_name, handler) => {
    // Undecorated is the deny state — no allowlist means the guard refuses.
    expect(allowedSystems(handler)).toBeUndefined();
  });

  it('does not open the whole controller', () => {
    // Class-level metadata would hand the POS the writes as well.
    expect(reflector.get<SystemContext[]>(ALLOW_SYSTEMS_KEY, DocumentSettingsController)).toBe(
      undefined,
    );
  });
});
