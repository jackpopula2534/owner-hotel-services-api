import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '@/common/guards/roles.guard';
import { PaymentSettingsController } from './payment-settings.controller';

/** บัญชี PromptPay คือปลายทางเงินของลูกค้า — พนักงานทั่วไปต้องแก้ไม่ได้ */
describe('PaymentSettingsController roles', () => {
  const guard = new RolesGuard(new Reflector());
  const ctx = (handler: (...args: never[]) => unknown, role: string) =>
    ({
      getHandler: () => handler,
      getClass: () => PaymentSettingsController,
      switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
    }) as unknown as ExecutionContext;
  const proto = PaymentSettingsController.prototype;

  it.each(['tenant_admin', 'admin', 'manager', 'owner', 'hotel_manager'])('lets %s save', (role) => {
    expect(guard.canActivate(ctx(proto.save, role))).toBe(true);
  });

  it.each(['receptionist', 'housekeeper', 'accountant', 'staff', 'cashier'])('blocks %s from saving', (role) => {
    const run = () => guard.canActivate(ctx(proto.save, role));
    // role ไม่มีอันดับ → guard คืน false; role มีอันดับแต่ต่ำ → 403
    try {
      expect(run()).toBe(false);
    } catch (e) {
      expect(e).toBeInstanceOf(ForbiddenException);
    }
  });

  it('still lets any signed-in role read the settings (POS needs channels)', () => {
    expect(guard.canActivate(ctx(proto.get, 'cashier'))).toBe(true);
  });
});
