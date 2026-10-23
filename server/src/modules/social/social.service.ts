import { randomUUID } from 'node:crypto';
import type { SocialRepository, Group } from './social.repository.js';

export class SocialError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}
export function createSocialService(repo: SocialRepository) {
  const accessListeners = new Set<(ids: string[]) => void>();
  const canConnect = async (a: string, b: string) => a !== b && !(await repo.isBlocked(a, b));
  const listeners = new Set<(event: { groupId: string; userId?: string }) => void>();
  function changed(event: { groupId: string; userId?: string }) { for (const listener of listeners) listener(event); }
  async function groupForMember(id: string, userId: string): Promise<Group> {
    const group = await repo.getGroup(id);
    if (!group || !group.memberIds.includes(userId)) throw new SocialError(404, 'Group is unavailable.');
    return group;
  }
  return {
    groupForMember,
    canConnect,
    onUserAccessChanged(listener: (ids: string[]) => void) { accessListeners.add(listener); return () => { accessListeners.delete(listener); }; },
    async block(userId: string, target: string) {
      if (userId === target) throw new SocialError(400, 'You cannot block yourself.');
      if (!(await repo.profiles([target])).length) throw new SocialError(404, 'Account is unavailable.');
      if ((await repo.listBlocks(userId)).length >= 500) throw new SocialError(409, 'Block list is full.');
      await repo.block(userId, target);
      for (const listener of accessListeners) listener([userId, target]);
    },
    async unblock(userId: string, target: string) { await repo.unblock(userId, target); },
    async removeAccount(userId: string) {
      const groups = await repo.listGroups(userId);
      await repo.removeAccount(userId);
      for (const group of groups) changed({ groupId: group._id, ...(group.ownerId === userId ? {} : { userId }) });
      for (const listener of accessListeners) listener([userId]);
    },
    onGroupAccessChanged(listener: (event: { groupId: string; userId?: string }) => void) {
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    async list(userId: string) {
      const [friends, groups, blocks] = await Promise.all([repo.listFriends(userId), repo.listGroups(userId), repo.listBlocks(userId)]);
      const ids = [...new Set([userId, ...blocks.map(block => block.target), ...friends.flatMap(friend => friend.members), ...groups.flatMap(group => group.memberIds)])];
      const profiles = new Map((await repo.profiles(ids)).map(profile => [profile.id, profile]));
      const profile = (id: string) => profiles.get(id) ?? { id, name: 'Unavailable account' };
      return {
        blocks: blocks.map(block => ({ id: block.target, name: profiles.get(block.target)?.name ?? "Blocked account" })),
        friends: friends.map(friend => ({ id: friend._id, status: friend.status, incoming: friend.recipientId === userId, peer: profile(friend.members.find(id => id !== userId)!) })),
        groups: groups.map(group => ({ id: group._id, name: group.name, ownerId: group.ownerId, members: group.memberIds.map(profile) })),
      };
    },
    async requestFriend(userId: string, recipientId: string) {
      if (userId === recipientId) throw new SocialError(400, 'You cannot add yourself as a friend.');
      if (!(await canConnect(userId, recipientId))) throw new SocialError(404, 'Account is unavailable.');
      if (!(await repo.profiles([recipientId])).length) throw new SocialError(404, 'Account is unavailable.');
      if ((await repo.listFriends(userId)).length >= 100 || (await repo.listFriends(recipientId)).length >= 100) throw new SocialError(409, 'Friend list is full.');
      const members = [userId, recipientId].sort();
      let added = false;
      try {
        added = await repo.addFriend({ _id: randomUUID(), pairKey: JSON.stringify(members), members, senderId: userId, recipientId, status: 'pending' });
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 11000)) throw error;
      }
      if (!added) throw new SocialError(409, 'A friendship or request already exists.');
    },
    async acceptFriend(userId: string, id: string) {
      const friend = await repo.getFriend(id);
      if (friend && !(await canConnect(friend.senderId, friend.recipientId))) throw new SocialError(404, 'Friend request is unavailable.');
      if (!(await repo.acceptFriend(id, userId))) throw new SocialError(404, 'Friend request is unavailable.');
    },
    async removeFriend(userId: string, id: string) {
      if (!(await repo.removeFriend(id, userId))) throw new SocialError(404, 'Friendship is unavailable.');
    },
    async createGroup(userId: string, name: string, memberIds: string[]) {
      const unique = [...new Set(memberIds)];
      if (unique.length !== memberIds.length || unique.includes(userId) || unique.length < 1 || unique.length > 5) throw new SocialError(400, 'Choose one to five different friends.');
      const friends = await repo.listFriends(userId);
      if (!unique.every(id => friends.some(friend => friend.status === 'accepted' && friend.members.includes(id)))) throw new SocialError(403, 'Only accepted friends can be added.');
      if ((await repo.profiles(unique)).length !== unique.length) throw new SocialError(400, 'A selected account is unavailable.');
      if ((await repo.listGroups(userId)).length >= 50) throw new SocialError(409, 'Group list is full.');
      const all = [userId, ...unique];
      for (const a of all) for (const b of all) if (a !== b && !(await canConnect(a, b))) throw new SocialError(403, 'Selected members cannot share a group.');
      const group = { _id: randomUUID(), ownerId: userId, name, memberIds: [userId, ...unique] };
      await repo.addGroup(group);
      return { id: group._id };
    },
    async deleteGroup(userId: string, id: string) {
      if (!(await repo.removeGroup(id, userId))) throw new SocialError(404, 'Only the owner can delete this group.');
      changed({ groupId: id });
    },
    async leaveGroup(userId: string, id: string) {
      await groupForMember(id, userId);
      if (!(await repo.leaveGroup(id, userId))) throw new SocialError(400, 'The owner must delete the group instead.');
      changed({ groupId: id, userId });
    },
  };
}
export type SocialService = ReturnType<typeof createSocialService>;