import { describe, it, expect } from "vitest";
import { t } from "@/core/i18n/t";

describe("t()", () => {
    it("returns translation for valid key", () => {
        expect(t("common.save")).toBe("Save");
    });

    it("returns key string for missing key in prod (fallback)", () => {
        // @ts-expect-error - testing runtime fallback for unknown keys
        expect(t("common.nonexistent")).toBe("common.nonexistent");
    });
});
