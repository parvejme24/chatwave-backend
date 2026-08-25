import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { PublicUser } from '../auth.constants';

export type AuthedRequest = {
  authUser: PublicUser;
  sessionId: string;
};

export const CurrentUser = createParamDecorator(
  (field: 'sessionId' | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return field === 'sessionId' ? req.sessionId : req.authUser;
  },
);
