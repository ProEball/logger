import { hasPermission, type Membership } from "./check";
import type { Permission } from "./registry";

export class ForbiddenError extends Error {
    readonly status = 403;

    constructor(message = "Forbidden") {
        super(message);
        this.name = "ForbiddenError";
    }
}

export function assertPermission(
    membership: Membership | null | undefined,
    perm: Permission,
): asserts membership is Membership {
    if (!membership || !hasPermission(membership, perm)) {
        throw new ForbiddenError(`Missing permission: ${perm}`);
    }
}

export function assertOwner(
    membership: Membership | null | undefined,
): asserts membership is Membership & { isOwner: true } {
    if (!membership || !membership.isOwner) {
        throw new ForbiddenError("Owner access required");
    }
}
