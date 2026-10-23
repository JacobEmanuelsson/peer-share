import { ObjectId, type Db } from 'mongodb';
export type Friendship = { _id: string; pairKey: string; members: string[]; senderId: string; recipientId: string; status: 'pending' | 'accepted' };
export type Group = { _id: string; name: string; ownerId: string; memberIds: string[] };
export type Profile = { id: string; name: string };

export function createSocialRepository(db: Db) {
  const friends = db.collection<Friendship>('friendships');
  const groups = db.collection<Group>('sharing_groups');
  const blocks = db.collection<{ actor: string; target: string }>('user_blocks');
  return {
    async init() {
      await Promise.all([
        blocks.createIndex({ actor: 1, target: 1 }, { unique: true }),
        friends.createIndex({ pairKey: 1 }, { unique: true }),
        friends.createIndex({ members: 1 }),
        groups.createIndex({ memberIds: 1 }),
      ]);
    },
    listBlocks: (actor: string) => blocks.find({ actor }).limit(500).toArray(),
    isBlocked: async (a: string, b: string) => !!await blocks.findOne({ $or: [{ actor: a, target: b }, { actor: b, target: a }] }),
    async block(actor: string, target: string) {
      await blocks.updateOne({ actor, target }, { $setOnInsert: { actor, target } }, { upsert: true });
      await friends.deleteMany({ members: { $all: [actor, target] } });
    },
    async unblock(actor: string, target: string) { await blocks.deleteOne({ actor, target }); },
    async removeAccount(userId: string) {
      await friends.deleteMany({ members: userId });
      await groups.deleteMany({ ownerId: userId });
      await groups.updateMany({ memberIds: userId }, { $pull: { memberIds: userId } });
      await blocks.deleteMany({ $or: [{ actor: userId }, { target: userId }] });
    },
    async profiles(ids: string[]): Promise<Profile[]> {
      const keys = ids.flatMap(id => ObjectId.isValid(id) ? [id, new ObjectId(id)] : [id]);
      const users = await db.collection<{ _id: string | ObjectId; name: string }>('user')
        .find({ _id: { $in: keys } }, { projection: { _id: 1, name: 1 } }).toArray();
      return users.map(user => ({ id: user._id.toString(), name: user.name }));
    },
    listFriends: (userId: string) => friends.find({ members: userId }).limit(200).toArray(),
    getFriend: (id: string) => friends.findOne({ _id: id }),
    async addFriend(friend: Friendship) {
      const result = await friends.updateOne({ pairKey: friend.pairKey }, { $setOnInsert: friend }, { upsert: true });
      return result.upsertedCount === 1;
    },
    async acceptFriend(id: string, userId: string) {
      return (await friends.updateOne({ _id: id, recipientId: userId, status: 'pending' }, { $set: { status: 'accepted' } })).modifiedCount === 1;
    },
    async removeFriend(id: string, userId: string) {
      return (await friends.deleteOne({ _id: id, members: userId })).deletedCount === 1;
    },
    listGroups: (userId: string) => groups.find({ memberIds: userId }).limit(100).toArray(),
    getGroup: (id: string) => groups.findOne({ _id: id }),
    async addGroup(group: Group) { await groups.insertOne(group); },
    async removeGroup(id: string, ownerId: string) { return (await groups.deleteOne({ _id: id, ownerId })).deletedCount === 1; },
    async leaveGroup(id: string, userId: string) {
      return (await groups.updateOne({ _id: id, ownerId: { $ne: userId }, memberIds: userId }, { $pull: { memberIds: userId } })).modifiedCount === 1;
    },
  };
}
export type SocialRepository = ReturnType<typeof createSocialRepository>;