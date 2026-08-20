/**
 * Reduce a batch of events to the distinct environments it mentions.
 *
 * `null` (an event that carried no environment) is a value like any other
 * here: absence is one of the options the overview's dropdown offers, shown
 * as "(unset)". Collapsing it away would make that option disappear from a
 * project whose events never set one.
 */
export function distinctEnvironments(
    events: Array<{ environment?: string | null }>,
): Array<string | null> {
    const seen = new Set<string | null>();
    for (const event of events) {
        seen.add(event.environment ?? null);
    }
    return [...seen];
}
