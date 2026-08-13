"use client";

import { useSyncExternalStore } from "react";

// The store never changes, so `subscribe` hands back a no-op unsubscribe.
const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * `false` on the server and during the hydrating render, `true` from the first
 * post-hydration render onward.
 *
 * Replaces the `useState(false)` + `useEffect(() => setMounted(true))` idiom:
 * same two-phase behaviour, but React drives it through the store instead of a
 * cascading render triggered from an effect body.
 *
 * Use it to keep the hydrating render byte-identical to the SSR output when a
 * value is only correct on the client — e.g. a Redux preference that lands
 * after mount, or a portal target that does not exist on the server.
 */
export function useIsHydrated(): boolean {
    return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
