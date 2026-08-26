import { ContactsService } from './contacts.service';
import { UsersDirectoryController } from './users-directory.controller';

describe('UsersDirectoryController', () => {
  it('lists every user with a following flag for follow/unfollow', async () => {
    const contacts = {
      list: jest.fn().mockResolvedValue({
        contacts: [{ id: 'u2', name: 'Nadia', following: false }],
        total: 1,
        onlineCount: 0,
      }),
    };
    const controller = new UsersDirectoryController(contacts as unknown as ContactsService);
    const viewer = { id: 'u1', isOwner: false };
    await expect(controller.list(viewer, { limit: 200 })).resolves.toEqual({
      users: [{ id: 'u2', name: 'Nadia', following: false }],
      total: 1,
      onlineCount: 0,
    });
    expect(contacts.list).toHaveBeenCalledWith(viewer, undefined, undefined, 200);
  });
});
