import type { HelpIconKey } from "@/features/help/content/categories";

// Inline icons matching the hand-drawn style already used in AppSidebar
// (16x16 viewBox, strokeWidth 1.25, stroke currentColor, fill none).

export function IconBookOpen() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 3.5c1.5-.7 3-.7 4.5 0v9c-1.5-.7-3-.7-4.5 0v-9zM14 3.5c-1.5-.7-3-.7-4.5 0v9c1.5-.7 3-.7 4.5 0v-9z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
    );
}

export function IconLayers() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2 2 5l6 3 6-3-6-3z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M2 8l6 3 6-3M2 11l6 3 6-3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconNetwork() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="6" y="1.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.25" />
            <rect x="1.5" y="10.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.25" />
            <rect x="10.5" y="10.5" width="4" height="4" rx="0.75" stroke="currentColor" strokeWidth="1.25" />
            <path d="M3.5 10.5V9a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v1.5M8 5.5V8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

export function IconTerminal() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.25" stroke="currentColor" strokeWidth="1.25" />
            <path d="M4 6l2.5 2L4 10M8 10h4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconUsers() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="6" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.25" />
            <path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <circle cx="11.5" cy="5.5" r="2" stroke="currentColor" strokeWidth="1.25" />
            <path d="M13.5 13c0-1.8-1-3-2.5-3.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

export function IconActivity() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <polyline points="2 8 5 4 8 10 11 6 14 8" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconShield() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2a3 3 0 100 6 3 3 0 000-6zM4 11c0-2.2 1.8-4 4-4h0c2.2 0 4 1.8 4 4v1H4v-1z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
        </svg>
    );
}

export function IconSettings() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.25" />
            <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.5 3.5l1 1M11.5 11.5l1 1M3.5 12.5l1-1M11.5 4.5l1-1" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

export function IconHelp() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
            <path d="M6 6.2c0-1.1.9-1.9 2-1.9s2 .7 2 1.7c0 1.3-1.7 1.4-1.9 2.7" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <circle cx="8" cy="11.3" r="0.6" fill="currentColor" />
        </svg>
    );
}

export function IconSearch() {
    return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.25" />
            <path d="M14 14l-3.3-3.3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

export function IconSearchOff() {
    return (
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.25" />
            <path d="M14 14l-3.3-3.3M5.3 5.3l3.4 3.4M8.7 5.3l-3.4 3.4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

export function IconChevronRight() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M6 3.5L10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}

export function IconFileText() {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M4 1.5h5l3 3v10H4v-13z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M9 1.5v3h3M5.5 8.5h5M5.5 11h5" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
        </svg>
    );
}

export function IconAlert() {
    return (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2 14.5 13.5H1.5L8 2z" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
            <path d="M8 6.5v3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
            <circle cx="8" cy="11.3" r="0.6" fill="currentColor" />
        </svg>
    );
}

export const CATEGORY_ICONS: Record<HelpIconKey, () => React.ReactElement> = {
    "book-open": IconBookOpen,
    layers: IconLayers,
    network: IconNetwork,
    terminal: IconTerminal,
    users: IconUsers,
    activity: IconActivity,
    shield: IconShield,
    settings: IconSettings,
};

export function CategoryIcon({ icon }: { icon: HelpIconKey }) {
    const Icon = CATEGORY_ICONS[icon];
    return <Icon />;
}
