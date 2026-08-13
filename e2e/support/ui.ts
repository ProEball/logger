import type { Locator, Page } from "@playwright/test";

/**
 * Custom-styled Checkbox/Switch components render a decorative <span> on top
 * of the native input, which intercepts a direct click on the input itself.
 * `force: true` skips that interception check but can then land on whatever
 * sits at the input's raw bounding box — clicking the wrapping <label>
 * instead is what a real user does, and is unambiguous.
 */
export function labelFor(page: Page, control: Locator): Locator {
    return page.locator("label").filter({ has: control });
}
