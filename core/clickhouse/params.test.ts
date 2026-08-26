import { describe, expect, it } from "vitest";
import { ParamBag } from "./params";

describe("ParamBag", () => {
    it("returns a placeholder naming the type it was given", () => {
        const bag = new ParamBag();
        expect(bag.add("x", "String")).toBe("{p0:String}");
    });

    it("numbers placeholders positionally, so the same value can be bound twice", () => {
        const bag = new ParamBag();
        expect(bag.add(300, "UInt32")).toBe("{p0:UInt32}");
        expect(bag.add(300, "UInt32")).toBe("{p1:UInt32}");
        expect(bag.params).toEqual({ p0: 300, p1: 300 });
    });

    it("keeps the value unconverted, so the client decides how to serialise it", () => {
        const bag = new ParamBag();
        const date = new Date("2026-08-26T10:00:00.000Z");
        bag.add(date, "DateTime64(3, 'UTC')");
        bag.add(["a", "b"], "Array(String)");
        expect(bag.params.p0).toBe(date);
        expect(bag.params.p1).toEqual(["a", "b"]);
    });

    it("starts empty", () => {
        expect(new ParamBag().params).toEqual({});
    });

    it("gives two bags independent counters, which is why they must not share a query", () => {
        // The property this documents is a hazard, not a feature: interpolating
        // two bags into one query collides on `p0`. Named here so the next
        // caller reads it as a rule rather than discovering it as a wrong row
        // count.
        const a = new ParamBag();
        const b = new ParamBag();
        expect(a.add("first", "String")).toBe("{p0:String}");
        expect(b.add("second", "String")).toBe("{p0:String}");
    });
});
