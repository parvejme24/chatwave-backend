import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';

import type { AuthedRequest } from '../auth/decorators/current-user.decorator';
import { OWNER_ONLY } from './admin.constants';

@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (!request.authUser?.isOwner) {
      throw new ForbiddenException({ error: OWNER_ONLY });
    }
    return true;
  }
}
