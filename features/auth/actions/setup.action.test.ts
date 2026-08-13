import { describe, it, expect, vi, beforeEach } from "vitest";

const { transaction, signInEmail, redirect, seedSystemRoles, hashPassword, userCount } = vi.hoisted(() => ({
    transaction: vi.fn(),
    signInEmail: vi.fn(),
    redirect: vi.fn(),
    seedSystemRoles: vi.fn(),
    hashPassword: vi.fn(),
    userCount: { value: 0 },
}));

vi.mock("@/core/db/client", () => ({ db: { transaction } }));
vi.mock("@/core/auth/config", () => ({ auth: { api: { signInEmail } } }));
vi.mock("@/features/roles/utils/seed-system-roles", () => ({ seedSystemRoles }));
vi.mock("@better-auth/utils/password", () => ({ hashPassword }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/core/db/schema", () => ({
    users: {},
    accounts: {},
    organizations: {},
    organizationMembers: {},
}));

import { setupAction } from "./setup.action";

const FORM = {
    orgName: "Acme Corp",
    name: "Alice",
    email: "alice@example.com",
    password: "hunter2-hunter2",
};

/** Records everything the action does inside the transaction. */
function makeTx() {
    const executed: string[] = [];
    const inserted: Record<string, unknown>[] = [];

    const tx = {
        execute: vi.fn(async (fragment: unknown) => {
            const chunks = (fragment as { queryChunks?: unknown[] })?.queryChunks ?? [];
            executed.push(
                chunks
                    .map((c) =>
                        typeof c === "object" && c !== null && "value" in c
                            ? String((c as { value: unknown }).value)
                            : String(c),
                    )
                    .join(" "),
            );
        }),
        select: () => ({ from: async () => [{ count: userCount.value }] }),
        insert: () => ({
            values: (v: Record<string, unknown>) => {
                inserted.push(v);
                return { returning: async () => [{ id: "org-1" }] };
            },
        }),
    };

    return { tx, executed, inserted };
}

describe("setupAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        userCount.value = 0;
        hashPassword.mockResolvedValue("hashed");
        seedSystemRoles.mockResolvedValue({ adminRoleId: "role-admin" });
        signInEmail.mockResolvedValue(undefined);
    });

    describe("the already-complete guard", () => {
        it("refuses when a user already exists", async () => {
            userCount.value = 1;
            const { tx } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            const result = await setupAction(FORM);

            expect(result.error).toBe("Setup is already complete. Please sign in.");
            expect(redirect).not.toHaveBeenCalled();
            expect(signInEmail).not.toHaveBeenCalled();
        });

        it("takes the advisory lock before counting users", async () => {
            // Without pg_advisory_xact_lock two simultaneous submits both pass
            // the COUNT check and both create an owner. See PLAN.md §17.
            const { tx, executed } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            expect(executed[0]).toContain("pg_advisory_xact_lock");
        });

        it("runs the whole bootstrap inside one transaction", async () => {
            const { tx } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            expect(transaction).toHaveBeenCalledTimes(1);
        });
    });

    describe("on a clean database", () => {
        it("hashes the password rather than storing it", async () => {
            const { tx, inserted } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            expect(hashPassword).toHaveBeenCalledWith(FORM.password);
            const account = inserted.find((v) => "providerId" in v);
            expect(account?.password).toBe("hashed");
            expect(JSON.stringify(inserted)).not.toContain(FORM.password);
        });

        it("makes the first user an owner", async () => {
            const { tx, inserted } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            const membership = inserted.find((v) => "isOwner" in v);
            expect(membership?.isOwner).toBe(true);
            expect(membership?.roleId).toBe("role-admin");
        });

        it("seeds the system roles with the new org, inside the transaction", async () => {
            const { tx } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            expect(seedSystemRoles).toHaveBeenCalledWith("org-1", tx);
        });

        it("slugifies the organization name", async () => {
            const { tx } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            expect(redirect).toHaveBeenCalledWith("/acme-corp");
        });

        it.each([
            ["  Spaced  Out  ", "/spaced-out"],
            ["Ünïcødé & Co.", "/n-c-d-co"],
            ["---Dashes---", "/dashes"],
        ])("slugifies %j to %s", async (orgName, expected) => {
            const { tx } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction({ ...FORM, orgName });

            expect(redirect).toHaveBeenCalledWith(expected);
        });

        it("signs the new owner in before redirecting", async () => {
            const { tx } = makeTx();
            transaction.mockImplementation(async (fn: (t: unknown) => Promise<unknown>) => fn(tx));

            await setupAction(FORM);

            expect(signInEmail).toHaveBeenCalledWith(
                expect.objectContaining({ body: { email: FORM.email, password: FORM.password } }),
            );
        });
    });

    describe("on transaction failure", () => {
        it("returns a generic error and does not sign anyone in", async () => {
            transaction.mockRejectedValue(new Error("deadlock detected"));

            const result = await setupAction(FORM);

            expect(result.error).toBe("Something went wrong. Please try again.");
            expect(signInEmail).not.toHaveBeenCalled();
            expect(redirect).not.toHaveBeenCalled();
        });

        it("does not leak the database error", async () => {
            transaction.mockRejectedValue(new Error("relation organizations does not exist"));

            const result = await setupAction(FORM);

            expect(result.error).not.toContain("organizations");
        });
    });
});
