import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type { AuthViewer } from '../../users/users.constants';

export type AuthedRequest = {
  authUser: AuthViewer;
  sessionId: string;
};

export const CurrentUser = createParamDecorator(
  (field: 'sessionId' | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return field === 'sessionId' ? req.sessionId : req.authUser;
  },
);
