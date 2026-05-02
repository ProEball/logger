'use client';

import { useState } from 'react';
import {
    Button,
    Drawer,
    FilterBar,
    FilterChip,
    KeyValue,
    LevelBadge,
    Table,
    type LogLevel,
    type SortDirection,
    type TableColumn,
    type TableRowMeta,
} from '@/shared/components';

interface EventRow extends TableRowMeta {
    timestamp: string;
    level: LogLevel;
    message: string;
    source: string;
    env: string;
}

interface ChipState {
    id: string;
    filterKey: string;
    value: string;
    operator?: string;
}

const INITIAL_CHIPS: ChipState[] = [
    { id: 'level', filterKey: 'level', value: 'error, fatal' },
    { id: 'env', filterKey: 'env', value: 'prod' },
    { id: 'msg', filterKey: 'message', value: '"timeout"', operator: '~' },
];

const initialRows: EventRow[] = [
    {
        id: '1',
        timestamp: '14:32:07.421',
        level: 'fatal',
        message: 'Unhandled exception: segmentation fault in worker',
        source: 'api-gateway',
        env: 'prod',
        variant: 'fatal',
    },
    {
        id: '2',
        timestamp: '14:31:58.003',
        level: 'error',
        message: "TypeError: Cannot read properties of undefined (reading 'userId')",
        source: 'auth-service',
        env: 'prod',
        variant: 'error',
    },
    {
        id: '3',
        timestamp: '14:31:44.781',
        level: 'warn',
        message: 'Rate limit approaching: 87% of quota used',
        source: 'rate-limiter',
        env: 'prod',
    },
    {
        id: '4',
        timestamp: '14:31:39.220',
        level: 'info',
        message: 'Worker process restarted successfully after 3 retries',
        source: 'worker-pool',
        env: 'staging',
    },
    {
        id: '5',
        timestamp: '14:31:22.119',
        level: 'debug',
        message: 'Cache miss for key: user:session:c3f8e2a1b4d7',
        source: 'cache-layer',
        env: 'dev',
    },
];

export function HeavyDemos() {
    const [selectedId, setSelectedId] = useState<string | null>('1');
    const [sortKey, setSortKey] = useState<string>('timestamp');
    const [sortDir, setSortDir] = useState<SortDirection>('desc');
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [chips, setChips] = useState<ChipState[]>(INITIAL_CHIPS);

    const rows = initialRows.map((r) => ({ ...r, selected: r.id === selectedId }));
    const selected = initialRows.find((r) => r.id === selectedId) ?? null;

    const columns: TableColumn<EventRow>[] = [
        {
            key: 'timestamp',
            header: 'Timestamp',
            width: 130,
            sortable: true,
            render: (r) => <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{r.timestamp}</span>,
        },
        {
            key: 'level',
            header: 'Level',
            width: 90,
            sortable: true,
            render: (r) => <LevelBadge level={r.level} size="sm" />,
        },
        {
            key: 'message',
            header: 'Message',
            render: (r) => <span style={{ fontFamily: 'var(--font-mono)' }}>{r.message}</span>,
        },
        {
            key: 'source',
            header: 'Source',
            width: 120,
            render: (r) => <span style={{ color: 'var(--text-secondary)' }}>{r.source}</span>,
        },
        {
            key: 'env',
            header: 'Env',
            width: 80,
            render: (r) => <span>{r.env}</span>,
        },
    ];

    const handleSort = (key: string) => {
        if (key === sortKey) {
            setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const removeChip = (id: string) => {
        setChips((prev) => prev.filter((c) => c.id !== id));
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FilterBar>
                {chips.map((c) => (
                    <FilterChip
                        key={c.id}
                        filterKey={c.filterKey}
                        operator={c.operator ?? ':'}
                        value={c.value}
                        onRemove={() => removeChip(c.id)}
                    />
                ))}
                <Button variant="ghost" size="sm" onClick={() => setChips(INITIAL_CHIPS)}>
                    + Reset filters
                </Button>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                    {initialRows.length} events
                </span>
            </FilterBar>

            <Table
                ariaLabel="Events"
                columns={columns}
                rows={rows}
                sortKey={sortKey}
                sortDirection={sortDir}
                onSort={handleSort}
                onRowClick={(r) => {
                    setSelectedId(r.id);
                    setDrawerOpen(true);
                }}
            />

            <Drawer
                open={drawerOpen}
                onClose={() => setDrawerOpen(false)}
                title={selected?.message ?? 'Event'}
                footer={
                    <>
                        <Button variant="ghost" onClick={() => setDrawerOpen(false)}>
                            Close
                        </Button>
                        <Button variant="primary">Open in new tab</Button>
                    </>
                }
            >
                {selected ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <LevelBadge level={selected.level} />
                            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {selected.timestamp}
                            </span>
                        </div>
                        <KeyValue
                            keyWidth={120}
                            rows={[
                                { key: 'event_id', value: `evt_${selected.id}`, variant: 'string' },
                                { key: 'level', value: selected.level },
                                { key: 'project', value: selected.source },
                                { key: 'environment', value: selected.env, variant: 'string' },
                            ]}
                        />
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

