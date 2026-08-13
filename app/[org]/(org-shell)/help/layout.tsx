import { HelpSearchProvider } from "@/features/help/components/HelpSearchProvider/HelpSearchProvider";
import { buildHelpSearchIndex } from "@/features/help/services/search-index.service";

interface HelpLayoutProps {
    children: React.ReactNode;
    params: Promise<{ org: string }>;
}

// Auth and org membership are already enforced by the parent (org-shell) layout — this
// layout only builds the search index once and mounts the palette so it persists (and
// keeps a single "/" keydown listener) across client-side navigation between the hub,
// an article, and the FAQ page.
export default async function HelpLayout({ children, params }: HelpLayoutProps) {
    const { org: orgSlug } = await params;
    const entries = await buildHelpSearchIndex();

    return (
        <HelpSearchProvider orgSlug={orgSlug} entries={entries}>
            {children}
        </HelpSearchProvider>
    );
}
