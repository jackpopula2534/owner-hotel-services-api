import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '@/common/decorators/roles.decorator';
import { RolesGuard } from '@/common/guards/roles.guard';
import { SuppliersController } from '../suppliers.controller';

/**
 * The controller used to stop at JwtAuthGuard + AddonGuard, so any signed-in
 * tenant user (housekeeper included) could create, edit or delete vendors.
 * Writes are now limited to the roles that hold `supplier.manage`; reads stay open.
 */
describe('SuppliersController roles', () => {
  const rolesOf = (method: keyof SuppliersController): string[] | undefined =>
    Reflect.getMetadata(ROLES_KEY, SuppliersController.prototype[method]);

  it('runs RolesGuard on the controller', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SuppliersController)).toContain(RolesGuard);
  });

  it.each(['create', 'update', 'remove'] as const)('%s is limited to supplier managers', (method) => {
    const roles = rolesOf(method);
    expect(roles).toEqual(
      expect.arrayContaining(['procurement_manager', 'admin', 'tenant_admin', 'manager']),
    );
    expect(roles).not.toContain('buyer');
    expect(roles).not.toContain('staff');
  });

  it.each(['findAll', 'findOne'] as const)('%s stays open to every tenant role', (method) => {
    expect(rolesOf(method)).toBeUndefined();
  });
});
