"use client";

import { useState, useId } from 'react';
import { cx } from '@/shared/utils/cx';
import styles from './Combobox.module.scss';

export interface ComboboxOption {
    value: string;
    label: string;
    color?: string;
    meta?: string;
}

export interface ComboboxGroup {
    label: string;
    options: ComboboxOption[];
}

export interface ComboboxProps {
    groups: ComboboxGroup[];
    value?: string[];
    onChange?: (value: string[]) => void;
    placeholder?: string;
    className?: string;
}

export function Combobox({ groups, value = [], onChange, placeholder = 'Search…', className }: ComboboxProps) {
    const [query, setQuery] = useState('');
    const inputId = useId();

    const filtered = groups.map((g) => ({
        ...g,
        options: g.options.filter((o) =>
            o.label.toLowerCase().includes(query.toLowerCase())
        ),
    })).filter((g) => g.options.length > 0);

    const toggle = (optionValue: string) => {
        if (!onChange) return;
        const next = value.includes(optionValue)
            ? value.filter((v) => v !== optionValue)
            : [...value, optionValue];
        onChange(next);
    };

    return (
        <div className={cx(styles.root, className)} role="listbox" aria-multiselectable="true">
            <div className={styles.searchRow}>
                <svg className={styles.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                    id={inputId}
                    className={styles.searchInput}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    autoComplete="off"
                />
                <kbd className={styles.kbdHint}>⌘F</kbd>
            </div>

            <div className={styles.list}>
                {filtered.map((group) => (
                    <div key={group.label} className={styles.group}>
                        <div className={styles.groupLabel}>{group.label}</div>
                        {group.options.map((opt) => {
                            const selected = value.includes(opt.value);
                            return (
                                <button
                                    key={opt.value}
                                    type="button"
                                    role="option"
                                    aria-selected={selected}
                                    className={cx(styles.option, selected && styles.optionSelected)}
                                    onClick={() => toggle(opt.value)}
                                >
                                    {opt.color ? (
                                        <span className={styles.dot} style={{ background: opt.color }} aria-hidden="true" />
                                    ) : null}
                                    <span className={styles.optionLabel}>{opt.label}</span>
                                    {opt.meta ? <span className={styles.optionMeta}>{opt.meta}</span> : null}
                                    {selected ? (
                                        <svg className={styles.check} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                    ) : null}
                                </button>
                            );
                        })}
                    </div>
                ))}
                {filtered.length === 0 ? (
                    <div className={styles.empty}>No results</div>
                ) : null}
            </div>
        </div>
    );
}
