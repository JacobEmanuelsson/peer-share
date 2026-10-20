import { randomUUID } from "node:crypto";

export type Invitation = Readonly<{
    id: string;
    senderUserId: string;
    senderConnectionId: string;
    recipientUserId: string;
    createdAt: number;
    expiresAt: number;
    status: "pending" | "accepted";
    receiverConnectionId?: string;
}>;

type CreateInvitationInput = {
    senderUserId: string;
    senderConnectionId: string;
    recipientUserId: string;
};

export function createInvitationStore() {
    // Created once per store. Returned methods retain access to this private Map.
    const invitations = new Map<string, Invitation>();

    return {
        create(input: CreateInvitationInput): Invitation {
            const now = Date.now();
            const invitation: Invitation = Object.freeze({
                id: randomUUID(),
                senderUserId: input.senderUserId,
                senderConnectionId: input.senderConnectionId,
                recipientUserId: input.recipientUserId,
                createdAt: now,
                expiresAt: now + 5 * 60 * 1000,
                status: "pending",
            });
            invitations.set(invitation.id, invitation);
            return invitation;
        },
        getById(id: string): Invitation | undefined {
            const invitation = invitations.get(id);
            if (invitation && invitation.expiresAt <= Date.now()) {
                invitations.delete(id);
                return undefined;
            }
            return invitation;
        },
        remove(id: string): boolean {
            return invitations.delete(id);
        },
        removeForSender(connectionId: string): void {
            for (const [id, invitation] of invitations) {
                if (invitation.senderConnectionId === connectionId) invitations.delete(id);
            }
        },
        removeExpired(): void {
            const now = Date.now();
            for (const [id, invitation] of invitations) {
                if (invitation.expiresAt <= now) invitations.delete(id);
            }
        },
        acceptInv(
            id: string,
            userId: string,
            connectionId: string,
        ): boolean {
            const invitation = invitations.get(id);

            if (!invitation || invitation.expiresAt <= Date.now()) {
                return false;
            }

            if (userId !== invitation.recipientUserId) {
                return false;
            }

            if (invitation.status !== "pending") {
                return false;
            }

            if (invitation.senderConnectionId === connectionId) {
                return false;
            }

            invitations.set(id, Object.freeze({
                ...invitation,
                status: "accepted",
                receiverConnectionId: connectionId,
            }));

            return true;
        }
    };
}
