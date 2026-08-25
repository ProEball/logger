import { describe, it, expect } from "vitest";
import {
    generateCorpus,
    mulberry32,
    buildMessage,
    buildAttributes,
    weightedProject,
    projectId,
    fnv1a,
    PROJECT_ATTRIBUTES,
    ATTRIBUTES_PER_PROJECT,
    TEMPLATES,
    DEFAULTS,
} from "./corpus.mjs";

/**
 * These assert the corpus's **premises**, not its contents.
 *
 * Each experiment in `docs/features/09-clickhouse.md` §13 assumes something
 * about the data: that attribute keys identify a project, that template hashes
 * describe templates, that traces group. If an assumption quietly stops
 * holding, the lab keeps producing numbers and the numbers stop meaning what
 * the table headings say. A run is cheap; a wrong `ORDER BY` is not.
 */

const SAMPLE = 20_000;

function take(n, options = {}) {
    const out = [];
    for (const row of generateCorpus({ ...options, rows: n })) out.push(row);
    return out;
}

describe("determinism", () => {
    it("produces an identical corpus for the same seed", () => {
        const a = take(500);
        const b = take(500);
        expect(a).toEqual(b);
    });

    it("produces a different corpus for a different seed", () => {
        const a = take(500, { seed: 1 });
        const b = take(500, { seed: 2 });
        expect(a).not.toEqual(b);
    });
});

describe("per-project attribute shapes (R2)", () => {
    it("carries enough keys per project for the Map comparison to mean anything", () => {
        // A Map pays for every key in the row to read one. At three keys there
        // is nothing to skip past, and the 2026-08-26 run measured a case that
        // does not occur. This asserts the corpus stays in the band real
        // projects sit in — see the note on PROJECT_ATTRIBUTES.
        for (const [i, schema] of PROJECT_ATTRIBUTES.entries()) {
            const n = Object.keys(schema).length;
            expect(n, `project ${i} has ${n} keys`).toBe(ATTRIBUTES_PER_PROJECT);
        }
        expect(ATTRIBUTES_PER_PROJECT).toBeGreaterThanOrEqual(15);
        expect(ATTRIBUTES_PER_PROJECT).toBeLessThanOrEqual(20);
    });

    it("keeps a usable spread of types in every project", () => {
        // Q4-json reads a String path; the Map fallback splits across attr_str
        // and attr_num. A project that was all one type would leave one of the
        // two Map columns empty and make the comparison lopsided.
        for (const [i, schema] of PROJECT_ATTRIBUTES.entries()) {
            const types = Object.values(schema);
            for (const t of ["string", "number", "boolean"]) {
                expect(types.filter((x) => x === t).length, `project ${i} has no ${t}`).toBeGreaterThan(2);
            }
        }
    });

    it("declares pairwise disjoint key sets", () => {
        // Experiment 4 attributes `GROUP BY attributes.order_id` to exactly one
        // project. A shared key would silently widen it to several.
        const seen = new Map();
        PROJECT_ATTRIBUTES.forEach((schema, index) => {
            for (const key of Object.keys(schema)) {
                expect(seen.has(key), `"${key}" appears in projects ${seen.get(key)} and ${index}`).toBe(false);
                seen.set(key, index);
            }
        });
    });

    it("emits only its own project's keys", () => {
        const random = mulberry32(7);
        for (let i = 0; i < PROJECT_ATTRIBUTES.length; i++) {
            const keys = Object.keys(buildAttributes(i, random)).sort();
            expect(keys).toEqual(Object.keys(PROJECT_ATTRIBUTES[i]).sort());
        }
    });

    it("keeps one type per key across many draws, as the registry requires", () => {
        // `attribute_key_types` records the first-seen type and rejects any
        // other forever. A corpus that drifts would be rejected at ingest by
        // the real app, so it must not drift here either.
        const random = mulberry32(11);
        const types = new Map();
        for (let n = 0; n < 2000; n++) {
            const bag = buildAttributes(n % PROJECT_ATTRIBUTES.length, random);
            for (const [key, value] of Object.entries(bag)) {
                const t = typeof value;
                if (types.has(key)) expect(types.get(key)).toBe(t);
                else types.set(key, t);
            }
        }
        expect(types.size).toBe(PROJECT_ATTRIBUTES.flatMap((s) => Object.keys(s)).length);
    });

    it("mirrors the JSON bag into the Map columns, so experiment 4 compares like with like", () => {
        for (const row of take(400)) {
            const fromMaps = { ...row.attr_str, ...row.attr_num };
            const expected = Object.fromEntries(
                Object.entries(row.attributes).filter(([, v]) => typeof v !== "boolean"),
            );
            expect(fromMaps).toEqual(expected);
        }
    });
});

describe("message templates", () => {
    it("returns the template alongside the rendered message", () => {
        const random = mulberry32(3);
        const all = Object.values(TEMPLATES).flat();
        for (let i = 0; i < 500; i++) {
            const { message, template } = buildMessage(random);
            expect(all).toContain(template);
            expect(message).not.toMatch(/\{[a-z_]+\}/);
        }
    });

    it("hashes the template, not the message — so distinct hashes stay bounded", () => {
        // The premise of experiment 5. Distinct template hashes must be a small
        // constant while distinct messages grow with the corpus; if they track
        // each other, `events_by_template` compresses nothing and the sizing
        // in §6.3 is wrong.
        const rows = take(SAMPLE);
        const hashes = new Set(rows.map((r) => r.template_hash));
        const messages = new Set(rows.map((r) => r.message));

        const templateCount = Object.values(TEMPLATES).flat().length;
        expect(hashes.size).toBe(templateCount);
        expect(messages.size).toBeGreaterThan(hashes.size * 20);
    });

    it("covers all three cardinality classes", () => {
        const rows = take(SAMPLE);
        const counts = new Map();
        for (const r of rows) counts.set(r.message, (counts.get(r.message) ?? 0) + 1);

        const repeatedALot = [...counts.values()].filter((c) => c > SAMPLE / 100).length;
        const seenOnce = [...counts.values()].filter((c) => c === 1).length;

        expect(repeatedALot, "no verbatim-repeat class").toBeGreaterThan(0);
        expect(seenOnce, "no near-unique class").toBeGreaterThan(SAMPLE / 20);
    });

    it("fnv1a is stable and distinguishes the fixtures", () => {
        expect(fnv1a("Health check passed")).toBe(fnv1a("Health check passed"));
        expect(fnv1a("Health check passed")).not.toBe(fnv1a("Configuration reloaded"));
    });
});

describe("traces (R4)", () => {
    const rows = take(SAMPLE);

    it("groups several events under one trace id", () => {
        const sizes = new Map();
        for (const r of rows) sizes.set(r.trace_id, (sizes.get(r.trace_id) ?? 0) + 1);
        const mean = rows.length / sizes.size;
        expect(mean).toBeGreaterThan(2);
        expect(mean).toBeLessThan(DEFAULTS.traceSize * 2);
    });

    it("keeps a trace inside one project", () => {
        // Q5 is `project_id = ? AND trace_id = ?`. A trace spanning projects
        // would make the timeline experiment measure a query nobody runs.
        const owner = new Map();
        for (const r of rows) {
            if (owner.has(r.trace_id)) expect(owner.get(r.trace_id)).toBe(r.project_id);
            else owner.set(r.trace_id, r.project_id);
        }
    });

    it("keeps a trace contiguous in time", () => {
        const first = new Map();
        const last = new Map();
        rows.forEach((r, i) => {
            if (!first.has(r.trace_id)) first.set(r.trace_id, i);
            last.set(r.trace_id, i);
        });
        for (const [trace, start] of first) {
            const span = last.get(trace) - start + 1;
            const size = rows.filter((r) => r.trace_id === trace).length;
            if (size > 1) expect(span).toBe(size);
            break; // one is enough; the invariant is structural
        }
    });
});

describe("row shape", () => {
    const rows = take(5000);

    it("emits timestamps in ascending order inside the requested window", () => {
        for (let i = 1; i < rows.length; i++) {
            expect(rows[i].timestamp >= rows[i - 1].timestamp).toBe(true);
        }
    });

    it("uses every level", () => {
        const levels = new Set(rows.map((r) => r.level));
        expect([...levels].sort()).toEqual(["debug", "error", "fatal", "info", "warn"]);
    });

    it("carries an error_type only on error and fatal", () => {
        for (const r of rows) {
            const isError = r.level === "error" || r.level === "fatal";
            expect(r.error_type === "").toBe(!isError);
        }
    });

    it("uses empty string, never null, for absent values", () => {
        // The schema has no `Nullable` column; a null here would fail the
        // insert and look like a ClickHouse problem rather than a corpus one.
        for (const r of rows) {
            for (const [key, value] of Object.entries(r)) {
                expect(value, `${key} is null`).not.toBeNull();
                expect(value, `${key} is undefined`).not.toBeUndefined();
            }
        }
    });

    it("formats timestamps the way DateTime64(3) parses them", () => {
        expect(rows[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    });
});

describe("project volume skew", () => {
    it("is skewed, not uniform", () => {
        // A uniform corpus is the friendliest possible case for a key led by
        // `project_id` and would flatter both candidates equally.
        const random = mulberry32(5);
        const counts = new Array(10).fill(0);
        for (let i = 0; i < 50_000; i++) counts[weightedProject(random, 10)]++;
        expect(counts[0]).toBeGreaterThan(counts[9] * 5);
    });

    it("uses all requested projects and no others", () => {
        const ids = new Set(take(SAMPLE).map((r) => r.project_id));
        expect(ids.size).toBe(10);
        for (const id of ids) expect(id).toMatch(/^00000000-0000-4000-8000-[0-9a-f]{12}$/);
        expect(ids.has(projectId(0))).toBe(true);
    });
});
