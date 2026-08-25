import { describe, it, expect } from "vitest";
import { liveRate } from "./live-rate";

describe("liveRate", () => {
    it("shows two decimals below one, so a slow trickle is not rounded to zero", () => {
        expect(liveRate(0)).toBe("0.00");
        expect(liveRate(0.5)).toBe("0.50");
    });

    it("rounds and separates at one and above", () => {
        expect(liveRate(1)).toBe("1");
        expect(liveRate(1.4)).toBe("1");
        expect(liveRate(2_500)).toBe((2500).toLocaleString());
    });

    /**
     * The boundary itself. `0.999` is below one and formats as `1.00`, which is
     * the two-decimal branch reporting a value that rounds up — not the
     * integer branch. Getting this backwards would print `1.00` and `1` for
     * indistinguishable traffic.
     */
    it("switches branch at exactly one, not around it", () => {
        expect(liveRate(0.999)).toBe("1.00");
        expect(liveRate(1)).toBe("1");
    });
});
