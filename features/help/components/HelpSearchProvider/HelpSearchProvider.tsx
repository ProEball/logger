"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette, type CommandGroup } from "@/shared/components";
import type { HelpSearchEntry } from "@/features/help/services/search-index.service";
import { getHelpCategory } from "@/features/help/content/categories";
import { CategoryIcon } from "@/features/help/components/icons";

interface HelpSearchContextValue {
    openSearch: () => void;
}

const HelpSearchContext = createContext<HelpSearchContextValue | null>(null);

export function useHelpSearch(): HelpSearchContextValue {
    const ctx = useContext(HelpSearchContext);
    if (!ctx) throw new Error("useHelpSearch must be used within HelpSearchProvider");
    return ctx;
}

export interface HelpSearchProviderProps {
    orgSlug: string;
    entries: HelpSearchEntry[];
    children: ReactNode;
}

/** Mounted once per Help route (see app/[org]/(org-shell)/help/layout.tsx) so the "/" shortcut
 * and search palette are available on every Help page, not just the hub. */
export function HelpSearchProvider({ orgSlug, entries, children }: HelpSearchProviderProps) {
    const [open, setOpen] = useState(false);
    const router = useRouter();

    const openSearch = useCallback(() => setOpen(true), []);
    const closeSearch = useCallback(() => setOpen(false), []);

    useEffect(() => {
        function handleKeydown(e: KeyboardEvent) {
            if (e.key !== "/") return;
            const target = e.target as HTMLElement | null;
            const tag = target?.tagName;
            if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
            e.preventDefault();
            setOpen(true);
        }
        window.addEventListener("keydown", handleKeydown);
        return () => window.removeEventListener("keydown", handleKeydown);
    }, []);

    const groups = useMemo<CommandGroup[]>(() => {
        const byCategory = new Map<string, HelpSearchEntry[]>();
        for (const entry of entries) {
            const list = byCategory.get(entry.cat) ?? [];
            list.push(entry);
            byCategory.set(entry.cat, list);
        }

        const result: CommandGroup[] = [];
        for (const [catSlug, catEntries] of byCategory) {
            const category = getHelpCategory(catSlug);
            if (!category) continue;
            result.push({
                label: category.label,
                items: catEntries.map((entry) => ({
                    id: entry.id,
                    label: entry.title,
                    description: entry.kind === "faq" ? "FAQ" : undefined,
                    icon: <CategoryIcon icon={category.icon} />,
                    onSelect: () => {
                        const href = entry.kind === "faq"
                            ? `/${orgSlug}/help/faq`
                            : `/${orgSlug}/help/${entry.cat}${entry.anchor ? `#${entry.anchor}` : ""}`;
                        router.push(href);
                    },
                })),
            });
        }
        return result;
    }, [entries, orgSlug, router]);

    return (
        <HelpSearchContext.Provider value={{ openSearch }}>
            {children}
            <CommandPalette
                groups={groups}
                open={open}
                onClose={closeSearch}
                placeholder="Search docs and FAQ…"
            />
        </HelpSearchContext.Provider>
    );
}
