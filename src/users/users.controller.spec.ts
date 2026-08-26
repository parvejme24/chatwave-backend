import { ModuleRef } from '@nestjs/core';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController directory', () => {
  it('lists every user with a following flag for follow/unfollow', async () => {
    const contacts = {
      list: jest.fn().mockResolvedValue({
        contacts: [{ id: 'u2', name: 'Nadia', following: false }],
        total: 1,
        onlineCount: 0,
      }),
    };
    const moduleRef = { get: jest.fn().mockReturnValue(contacts) };
    const controller = new UsersController(
      {} as UsersService,
      moduleRef as unknown as ModuleRef,
    );
    const viewer = { id: 'u1', isOwner: false };
    await expect(controller.list(viewer, { limit: 200 })).resolves.toEqual({
      users: [{ id: 'u2', name: 'Nadia', following: false }],
      total: 1,
      onlineCount: 0,
    });
    expect(contacts.list).toHaveBeenCalledWith(viewer, undefined, undefined, 200);
  });
});
