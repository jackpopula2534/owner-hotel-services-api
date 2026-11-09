import { isUserUsable, UserStatus, USER_STATUS_VALUES } from './user-status.enum';

describe('user-status helpers', () => {
  it('USER_STATUS_VALUES contains all four statuses', () => {
    expect(USER_STATUS_VALUES).toEqual(
      expect.arrayContaining(['active', 'inactive', 'suspended', 'expired']),
    );
  });

  describe('isUserUsable', () => {
    it('returns true for active user without expiration', () => {
      expect(isUserUsable({ status: UserStatus.ACTIVE, expiresAt: null })).toBe(true);
    });

    it('returns true for active user with future expiration', () => {
      expect(
        isUserUsable({
          status: UserStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ).toBe(true);
    });

    it('returns false when expiresAt is in the past', () => {
      expect(
        isUserUsable({
          status: UserStatus.ACTIVE,
          expiresAt: new Date(Date.now() - 60_000),
        }),
      ).toBe(false);
    });

    it.each([UserStatus.SUSPENDED, UserStatus.INACTIVE, UserStatus.EXPIRED])(
      'returns false for status=%s',
      (status) => {
        expect(isUserUsable({ status, expiresAt: null })).toBe(false);
      },
    );

    it('returns false for null user', () => {
      expect(isUserUsable(null as any)).toBe(false);
    });
  });
});
