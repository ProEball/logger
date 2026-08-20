import { describe, it, expect, vi, beforeEach } from "vitest";

const {
    getCurrentUserMock,
    getOrgBySlugMock,
    getMembershipMock,
    getProjectBySlugMock,
    getFacetCountsMock,
    assertPermissionMock,
} = vi.hoisted(() => ({
    getCurrentUserMock: vi.fn(),
    getOrgBySlugMock: vi.fn(),
    getMembershipMock: vi.fn(),
    getProjectBySlugMock: vi.fn(),
    getFacetCountsMock: vi.fn(),
    assertPermissionMock: vi.fn(),
}));

vi.mock("@/core/auth/server", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/features/organizations/services/organizations.service", () => ({
    getOrgBySlug: getOrgBySlugMock,
    getMembership: getMembershipMock,
}));
vi.mock("@/features/projects/services/projects.service", () => ({
    getProjectBySlug: getProjectBySlugMock,
}));
vi.mock("@/features/events/services/events-query.service", () => ({
    getFacetCounts: getFacetCountsMock,
}));
vi.mock("@/shared/permissions/guards", () => ({ assertPermission: assertPermissionMock }));

import { getFacetCountsAction } from "@/features/events/actions/get-facet-counts.action";

const EMPTY_FACETS = {
    levels: [],
    environments: [],
    sources: [],
    releases: [],
    errorTypes: [],
};

/** Every dependency satisfied — the happy path each test then breaks one part of. */
function grantEverything() {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    getOrgBySlugMock.mockResolvedValue({ id: "org-1", slug: "acme" });
    getMembershipMock.mockResolvedValue({ userId: "user-1", organizationId: "org-1" });
    assertPermissionMock.mockReturnValue(undefined);
    getProjectBySlugMock.mockResolvedValue({ id: "project-1", slug: "web" });
    getFacetCountsMock.mockResolvedValue(EMPTY_FACETS);
}

beforeEach(() => {
    vi.clearAllMocks();
    grantEverything();
});

describe("getFacetCountsAction — authorization", () => {
    it("refuses an unauthenticated caller without touching the database", async () => {
        getCurrentUserMock.mockResolvedValue(null);

        expect(await getFacetCountsAction("acme", "web", "")).toEqual({ error: "Not authenticated." });
        expect(getFacetCountsMock).not.toHaveBeenCalled();
    });

    it("requires the events.read permission", async () => {
        // A Server Action is a public endpoint: the page's own membership check
        // protects the page, not this.
        assertPermissionMock.mockImplementation(() => {
            throw new Error("forbidden");
        });

        const result = await getFacetCountsAction("acme", "web", "");

        expect(result).toEqual({ error: "You don't have permission to read events." });
        expect(getFacetCountsMock).not.toHaveBeenCalled();
    });

    it("checks the permission against the caller's membership of that org", async () => {
        await getFacetCountsAction("acme", "web", "");
        expect(assertPermissionMock).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: "org-1" }),
            "events.read",
        );
    });

    it("reports an unknown organization without revealing anything else", async () => {
        getOrgBySlugMock.mockResolvedValue(null);
        expect(await getFacetCountsAction("nope", "web", "")).toEqual({ error: "Organization not found." });
    });

    it("reports an unknown project", async () => {
        getProjectBySlugMock.mockResolvedValue(null);
        expect(await getFacetCountsAction("acme", "nope", "")).toEqual({ error: "Project not found." });
        expect(getFacetCountsMock).not.toHaveBeenCalled();
    });

    it("looks the project up inside the caller's organization, not globally", async () => {
        await getFacetCountsAction("acme", "web", "");
        expect(getProjectBySlugMock).toHaveBeenCalledWith("org-1", "web");
    });
});

describe("getFacetCountsAction — input", () => {
    it("rejects an empty org slug", async () => {
        expect(await getFacetCountsAction("", "web", "")).toEqual({ error: "Invalid input." });
        expect(getCurrentUserMock).not.toHaveBeenCalled();
    });

    it("rejects an empty project slug", async () => {
        expect(await getFacetCountsAction("acme", "", "")).toEqual({ error: "Invalid input." });
    });

    it("rejects an oversized query string rather than parsing it", async () => {
        expect(await getFacetCountsAction("acme", "web", "x".repeat(4097))).toEqual({
            error: "Invalid input.",
        });
        expect(getFacetCountsMock).not.toHaveBeenCalled();
    });

    it("accepts an empty query string as 'no filters'", async () => {
        const result = await getFacetCountsAction("acme", "web", "");
        expect(result).toEqual({ ok: true, facetCounts: EMPTY_FACETS });
    });

    it("parses the query string into filters and scopes the query by project", async () => {
        await getFacetCountsAction("acme", "web", "levels=error,fatal&env=production");

        expect(getFacetCountsMock).toHaveBeenCalledWith(
            "project-1",
            expect.objectContaining({ levels: ["error", "fatal"] }),
        );
    });

    it("does not throw on a malformed query string", async () => {
        // `parseFilters` drops what it cannot read rather than raising, so a
        // stale or hand-edited URL still yields counts instead of an error.
        const result = await getFacetCountsAction("acme", "web", "levels=&range=nonsense&%%%");
        expect("ok" in result).toBe(true);
    });
});

describe("getFacetCountsAction — results", () => {
    it("returns the counts the service produced", async () => {
        const counts = {
            levels: [{ value: "error", count: 12 }],
            environments: [{ value: "production", count: 12 }],
            sources: [],
            releases: [],
            errorTypes: [],
        };
        getFacetCountsMock.mockResolvedValue(counts);

        expect(await getFacetCountsAction("acme", "web", "")).toEqual({ ok: true, facetCounts: counts });
    });

    it("turns a query failure into a typed error rather than throwing at the client", async () => {
        getFacetCountsMock.mockRejectedValue(new Error("connection terminated"));

        expect(await getFacetCountsAction("acme", "web", "")).toEqual({
            error: "Failed to load filter counts.",
        });
    });

    it("does not leak the underlying error message", async () => {
        getFacetCountsMock.mockRejectedValue(new Error("relation \"events\" does not exist"));

        const result = await getFacetCountsAction("acme", "web", "");
        expect(JSON.stringify(result)).not.toContain("relation");
    });
});
