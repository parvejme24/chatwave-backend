import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { OWNER_ONLY } from './admin.constants';
import { OwnerGuard } from './owner.guard';

function ctx(isOwner: boolean | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        authUser: isOwner === undefined ? undefined : { id: '64a000000000000000000001', isOwner },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('OwnerGuard', () => {
  const guard = new OwnerGuard();

  it('allows the owner', () => {
    expect(guard.canActivate(ctx(true))).toBe(true);
  });

  it('returns 403 for a non-owner', () => {
    try {
      guard.canActivate(ctx(false));
      throw new Error('expected ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toEqual({ error: OWNER_ONLY });
    }
  });
});
