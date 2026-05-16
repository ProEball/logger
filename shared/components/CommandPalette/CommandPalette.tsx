"use client";

import { useState, useEffect, useCallback, useId } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './CommandPalette.module.scss';

export interface CommandItem {
    id: string;
    label: string;
    description?: string;
    icon?: React.ReactNode;
    kbd?: string[];
    onSelect: () => void;
}

export interface CommandGroup {
    label: string;
    items: CommandItem[];
}

export interface CommandPaletteProps {
    groups: CommandGroup[];
    open?: boolean;
    onClose?: () => void;
    placeholder?: string;
}

export function CommandPalette({ groups, open, onClose, placeholder = 'Search commands…' }: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(0);
    const inputId = useId();

    const filtered = groups.map((g) => ({
        ...g,
        items: g.items.filter(
            (item) =>
                item.label.toLowerCase().includes(query.toLowerCase()) ||
                (item.description?.toLowerCase().includes(query.toLowerCase()) ?? false)
        ),
    })).filter((g) => g.items.length > 0);

    const allItems = filtered.flatMap((g) => g.items);

    const handleClose = useCallback(() => {
        setQuery('');
        setActiveIndex(0);
        onClose?.();
    }, [onClose]);

    const handleSelect = useCallback((item: CommandItem) => {
        item.onSelect();
        handleClose();
    }, [handleClose]);

    const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(e.target.value);
        setActiveIndex(0);
    };

    useEffect(() => {
        const handleKey = (e: KeyboardEvent) => {
            if (!open) return;
            if (e.key === 'Escape') { handleClose(); return; }
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((i) => Math.min(i + 1, allItems.length - 1));
            }
            if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((i) => Math.max(i - 1, 0));
            }
            if (e.key === 'Enter' && allItems[activeIndex]) {
                e.preventDefault();
                handleSelect(allItems[activeIndex]);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [open, allItems, activeIndex, handleClose, handleSelect]);

    if (!open) return null;

    let itemCounter = 0;

    return (
        <div className={styles.backdrop} onClick={handleClose} aria-modal="true" role="dialog" aria-label="Command palette">
            <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
                {/* Head */}
                <div className={styles.head}>
                    <svg className={styles.searchIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        id={inputId}
                        className={styles.input}
                        type="text"
                        value={query}
                        onChange={handleQueryChange}
                        placeholder={placeholder}
                        autoFocus
                        aria-label={placeholder}
                        autoComplete="off"
                    />
                    <kbd className={styles.escBadge}>ESC</kbd>
                </div>

                {/* Results */}
                <div className={styles.results} role="listbox">
                    {filtered.map((group) => (
                        <div key={group.label} className={styles.group}>
                            <div className={styles.groupLabel}>{group.label}</div>
                            {group.items.map((item) => {
                                const idx = itemCounter++;
                                const isActive = idx === activeIndex;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        role="option"
                                        aria-selected={isActive}
                                        className={cx(styles.item, isActive && styles.itemActive)}
                                        onClick={() => handleSelect(item)}
                                        onMouseEnter={() => setActiveIndex(idx)}
                                    >
                                        {item.icon ? <span className={styles.itemIcon}>{item.icon}</span> : null}
                                        <span className={styles.itemBody}>
                                            <span className={styles.itemLabel}>{item.label}</span>
                                            {item.description ? <span className={styles.itemDesc}>{item.description}</span> : null}
                                        </span>
                                        {item.kbd ? (
                                            <span className={styles.itemKbds}>
                                                {item.kbd.map((k) => <kbd key={k} className={styles.kbdKey}>{k}</kbd>)}
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}
                        </div>
                    ))}
                    {filtered.length === 0 ? (
                        <div className={styles.empty}>No results for &ldquo;{query}&rdquo;</div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className={styles.footer}>
                    <span className={styles.footerHint}><kbd className={styles.kbdKey}>↑</kbd><kbd className={styles.kbdKey}>↓</kbd> navigate</span>
                    <span className={styles.footerHint}><kbd className={styles.kbdKey}>↵</kbd> select</span>
                    <span className={styles.footerHint}><kbd className={styles.kbdKey}>ESC</kbd> close</span>
                </div>
            </div>
        </div>
    );
}
