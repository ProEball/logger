import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// pg-boss is the queue's Postgres boundary; stubbed so the suite needs no DB.
// The job registrars are deliberately NOT stubbed — running the real ones
// against the fake boss is what proves every job is still wired up.
const bossInstances = vi.hoisted(() => [] as MockBoss[]);

type MockBoss = {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    work: ReturnType<typeof vi.fn>;
    schedule: ReturnType<typeof vi.fn>;
    createQueue: ReturnType<typeof vi.fn>;
    connectionString: string;
};

vi.mock("pg-boss", () => ({
    // A class, not `vi.fn(() => …)`: worker.ts calls `new PgBoss(url)` and an
    // arrow function is not constructable.
    PgBoss: class {
        constructor(connectionString: string) {
            const instance: MockBoss = {
                start: vi.fn().mockResolvedValue(undefined),
                stop: vi.fn().mockResolvedValue(undefined),
                on: vi.fn(),
                work: vi.fn().mockResolvedValue(undefined),
                schedule: vi.fn().mockResolvedValue(undefined),
                createQueue: vi.fn().mockResolvedValue(undefined),
                connectionString,
            };
            bossInstances.push(instance);
            return instance;
        }
    },
}));

vi.mock("@/core/db/client", () => ({ db: { execute: vi.fn() } }));

import { getBoss, startWorker, stopWorker } from "./worker";
import { PARTMAN_JOB_NAME } from "@/features/ingest/jobs/partman-maintenance.job";
import { ALERT_EVALUATION_JOB } from "@/features/alerts/jobs/alert-evaluation.job";
import { ALERT_DELIVERY_JOB } from "@/features/alerts/jobs/alert-delivery.job";

const latestBoss = (): MockBoss => bossInstances[bossInstances.length - 1];

beforeEach(() => {
    bossInstances.length = 0;
});

afterEach(async () => {
    await stopWorker();
});

describe("startWorker", () => {
    it("registers every background job", async () => {
        await startWorker();

        const queues = latestBoss().work.mock.calls.map(([name]) => name);
        expect(queues).toContain(PARTMAN_JOB_NAME);
        expect(queues).toContain(ALERT_EVALUATION_JOB);
        expect(queues).toContain(ALERT_DELIVERY_JOB);
    });

    it("creates every queue before using it", async () => {
        // pg-boss 12 dropped implicit queue creation: `schedule()` and `work()`
        // against a queue that does not exist yet fail on the foreign key from
        // pgboss.schedule to pgboss.queue. Nothing catches that, so the worker
        // crash-loops — but only against a database where the queue rows are
        // missing, which means never in a long-lived dev database and always on
        // a fresh production one.
        await startWorker();

        const created = latestBoss().createQueue.mock.calls.map(([name]) => name);
        expect(created).toEqual(
            expect.arrayContaining([PARTMAN_JOB_NAME, ALERT_EVALUATION_JOB, ALERT_DELIVERY_JOB]),
        );
    });

    it("creates each queue before scheduling or working it", async () => {
        await startWorker();
        const boss = latestBoss();

        const createdAt = (name: string) =>
            boss.createQueue.mock.invocationCallOrder[
                boss.createQueue.mock.calls.findIndex(([n]) => n === name)
            ];
        const workedAt = (name: string) =>
            boss.work.mock.invocationCallOrder[
                boss.work.mock.calls.findIndex(([n]) => n === name)
            ];
        const scheduledAt = (name: string) =>
            boss.schedule.mock.invocationCallOrder[
                boss.schedule.mock.calls.findIndex(([n]) => n === name)
            ];

        for (const name of [PARTMAN_JOB_NAME, ALERT_EVALUATION_JOB, ALERT_DELIVERY_JOB]) {
            expect(createdAt(name)).toBeLessThan(workedAt(name));
        }
        for (const name of [PARTMAN_JOB_NAME, ALERT_EVALUATION_JOB]) {
            expect(createdAt(name)).toBeLessThan(scheduledAt(name));
        }
    });

    it("schedules the two cron jobs with a singleton key", async () => {
        await startWorker();

        const schedules = Object.fromEntries(
            latestBoss().schedule.mock.calls.map(([name, cron, , options]) => [
                name,
                { cron, options },
            ]),
        );
        expect(schedules[PARTMAN_JOB_NAME]).toEqual({
            cron: "0 * * * *",
            options: { singletonKey: PARTMAN_JOB_NAME },
        });
        expect(schedules[ALERT_EVALUATION_JOB]).toEqual({
            cron: "* * * * *",
            options: { singletonKey: ALERT_EVALUATION_JOB },
        });
    });

    it("is idempotent — a second call does not open a second pg-boss", async () => {
        await startWorker();
        await startWorker();

        expect(bossInstances).toHaveLength(1);
        expect(latestBoss().start).toHaveBeenCalledTimes(1);
    });

    it("exposes the running instance through getBoss", async () => {
        expect(getBoss()).toBeNull();

        await startWorker();

        expect(getBoss()).toBe(latestBoss());
    });
});

describe("stopWorker", () => {
    it("drains gracefully within the compose stop_grace_period", async () => {
        await startWorker();
        const boss = latestBoss();

        await stopWorker();

        expect(boss.stop).toHaveBeenCalledWith({
            graceful: true,
            close: true,
            timeout: 20_000,
        });
    });

    it("clears the singleton so a later start opens a fresh instance", async () => {
        await startWorker();
        await stopWorker();

        expect(getBoss()).toBeNull();

        await startWorker();

        expect(bossInstances).toHaveLength(2);
    });

    it("clears the singleton even when stopping throws", async () => {
        await startWorker();
        latestBoss().stop.mockRejectedValue(new Error("connection already gone"));

        // A failed stop must not leave startWorker believing a dead boss is live.
        await expect(stopWorker()).resolves.toBeUndefined();
        expect(getBoss()).toBeNull();
    });

    it("is a no-op when the worker was never started", async () => {
        await expect(stopWorker()).resolves.toBeUndefined();
        expect(bossInstances).toHaveLength(0);
    });
});
