import {
    AppShell,
    Avatar,
    Breadcrumbs,
    Button,
    Checkbox,
    CodeBlock,
    Divider,
    FormField,
    IconButton,
    Input,
    JsonTree,
    KeyValue,
    LevelBadge,
    Radio,
    Select,
    Sidebar,
    SidebarDivider,
    SidebarItem,
    SidebarSection,
    Skeleton,
    StatusBadge,
    Switch,
    Tabs,
    Textarea,
    Topbar,
} from '@/shared/components';
import { HeavyDemos } from './_demo/HeavyDemos';
import { OverlayDemos } from './_demo/OverlayDemos';
import styles from './page.module.scss';

function FileIcon() {
    return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
        </svg>
    );
}

export default function Home() {
    return (
        <main className={styles.page}>
            <header className={styles.header}>
                <h1 className={styles.title}>Logger</h1>
                <p className={styles.subtitle}>
                    Self-hosted log aggregation. Design system preview.
                </p>
            </header>

            <Divider />

            <section className={styles.section}>
                <h2 className={styles.heading}>Buttons</h2>
                <div className={styles.row}>
                    <Button variant="primary">Send event</Button>
                    <Button variant="secondary">Cancel</Button>
                    <Button variant="ghost">Skip</Button>
                    <Button variant="danger">Delete project</Button>
                    <Button variant="link">View docs</Button>
                </div>
                <div className={styles.row}>
                    <Button variant="primary" size="sm">Save</Button>
                    <Button variant="secondary" size="sm">Cancel</Button>
                    <Button variant="primary" disabled>Disabled</Button>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Icon buttons</h2>
                <div className={styles.row}>
                    <IconButton aria-label="Settings">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="3" />
                        </svg>
                    </IconButton>
                    <IconButton aria-label="Filter" active>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                        </svg>
                    </IconButton>
                    <IconButton aria-label="Close" size="sm">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                        </svg>
                    </IconButton>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Log levels</h2>
                <div className={styles.row}>
                    <LevelBadge level="debug" />
                    <LevelBadge level="info" />
                    <LevelBadge level="warn" />
                    <LevelBadge level="error" />
                    <LevelBadge level="fatal" />
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Status</h2>
                <div className={styles.row}>
                    <StatusBadge status="success" label="Healthy" />
                    <StatusBadge status="warning" label="Degraded" />
                    <StatusBadge status="danger" label="Down" />
                    <StatusBadge status="info" label="Pending" />
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Text fields</h2>
                <div className={styles.row}>
                    <FormField label="Search" helper="Searches across event message and stack trace.">
                        <Input placeholder="connection timeout" />
                    </FormField>
                    <FormField label="Email" error="Enter a valid email address" required>
                        <Input type="email" placeholder="invalid@" invalid />
                    </FormField>
                    <FormField label="Disabled">
                        <Input placeholder="Disabled input" disabled />
                    </FormField>
                </div>
                <div className={styles.row}>
                    <FormField label="Webhook description">
                        <Textarea placeholder="Webhook fires when error count exceeds threshold within the given window." />
                    </FormField>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Select</h2>
                <div className={styles.row}>
                    <FormField label="Environment">
                        <Select defaultValue="production">
                            <option value="production">production</option>
                            <option value="staging">staging</option>
                            <option value="development">development</option>
                        </Select>
                    </FormField>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Checkbox, Radio, Switch</h2>
                <div className={styles.row}>
                    <div className={styles.col}>
                        <Checkbox label="Receive alerts" defaultChecked />
                        <Checkbox label="Disabled option" disabled />
                    </div>
                    <div className={styles.col}>
                        <Radio name="levels" label="Error & Fatal only" defaultChecked />
                        <Radio name="levels" label="All levels" />
                    </div>
                    <div className={styles.col}>
                        <Switch label="Notifications enabled" defaultChecked />
                        <Switch label="Pause alerts" />
                    </div>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Skeleton</h2>
                <div className={styles.col}>
                    <Skeleton width={240} height={14} />
                    <Skeleton width={180} height={14} />
                    <Skeleton width={300} height={14} />
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Overlays</h2>
                <OverlayDemos />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Key-value (event attributes)</h2>
                <KeyValue
                    rows={[
                        { key: 'request_id', value: 'req_01HX7K2M3N4P5Q6R7S8T9UVWX', variant: 'string' },
                        { key: 'status_code', value: 500, variant: 'number' },
                        { key: 'duration_ms', value: 1843, variant: 'number' },
                        { key: 'user_agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
                        { key: 'url', value: '/api/v2/events?project=api-gateway', variant: 'url' },
                        { key: 'environment', value: 'production', variant: 'string' },
                    ]}
                />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Code block</h2>
                <CodeBlock
                    language="typescript"
                    highlightLines={[4]}
                    code={`import { Logger } from '@logger/sdk';

const log = new Logger({ project: 'api-gateway' });
log.error('Connection failed', { retries: 3, host: 'db.prod' });`}
                />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>JSON tree</h2>
                <JsonTree
                    expandDepth={2}
                    data={{
                        event_id: 'evt_01HX7K2M3N',
                        level: 'fatal',
                        timestamp: '2024-01-15T14:32:07.421Z',
                        attributes: {
                            request_id: 'req_01HX7K2M3N4P5Q6R',
                            status_code: 500,
                            duration_ms: 1843,
                            tags: ['api', 'prod', 'p1'],
                        },
                        stack: [
                            { fn: 'processRequest', file: 'app/handlers/events.ts', line: 142 },
                            { fn: 'Router.handle', file: 'node_modules/express/lib/router/index.js', line: 284 },
                        ],
                        retried: false,
                        cause: null,
                    }}
                />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Breadcrumbs</h2>
                <Breadcrumbs
                    items={[
                        { label: 'acme-org', href: '#' },
                        { label: 'api-gateway', href: '#' },
                        { label: 'Events' },
                    ]}
                />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Tabs</h2>
                <Tabs
                    ariaLabel="Project sections"
                    items={[
                        { id: 'events', label: 'Events', count: 1482, active: true },
                        { id: 'dashboard', label: 'Dashboard', href: '#dashboard' },
                        { id: 'alerts', label: 'Alerts', count: 3, href: '#alerts' },
                        { id: 'settings', label: 'Settings', href: '#settings' },
                        { id: 'archive', label: 'Archive', disabled: true },
                    ]}
                />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>App shell</h2>
                <div className={styles.shellPreview}>
                    <AppShell
                        sidebar={
                            <Sidebar
                                top={
                                    <SidebarItem
                                        icon={
                                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="3" /></svg>
                                        }
                                        label="acme-org"
                                    />
                                }
                                bottom={
                                    <SidebarSection>
                                        <SidebarItem
                                            icon={
                                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                                            }
                                            label="Settings"
                                        />
                                    </SidebarSection>
                                }
                            >
                                <SidebarSection label="Projects">
                                    <SidebarItem
                                        icon={<FileIcon />}
                                        label="api-gateway"
                                        active
                                    />
                                    <SidebarItem icon={<FileIcon />} label="auth-service" />
                                    <SidebarItem icon={<FileIcon />} label="worker-pool" />
                                </SidebarSection>
                                <SidebarDivider />
                                <SidebarSection label="Org">
                                    <SidebarItem
                                        icon={
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                                        }
                                        label="Members"
                                        badge={12}
                                    />
                                </SidebarSection>
                            </Sidebar>
                        }
                        topbar={
                            <Topbar
                                left={
                                    <Breadcrumbs
                                        items={[
                                            { label: 'api-gateway', href: '#' },
                                            { label: 'Events' },
                                        ]}
                                    />
                                }
                                right={
                                    <>
                                        <IconButton aria-label="Notifications">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                                        </IconButton>
                                        <Avatar name="Jane Doe" size={24} />
                                    </>
                                }
                            />
                        }
                    >
                        <div className={styles.tabContent}>
                            <Tabs
                                ariaLabel="Event detail tabs"
                                items={[
                                    { id: 'details', label: 'Details', active: true },
                                    { id: 'attrs', label: 'Attributes', href: '#attrs' },
                                    { id: 'stack', label: 'Stack trace', href: '#stack' },
                                ]}
                            />
                            <p style={{ marginTop: 'var(--space-3)', color: 'var(--text-muted)' }}>
                                Content area — feature components mount here.
                            </p>
                        </div>
                    </AppShell>
                </div>
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Events table + filter bar + drawer</h2>
                <HeavyDemos />
            </section>

            <section className={styles.section}>
                <h2 className={styles.heading}>Avatar</h2>
                <div className={styles.row}>
                    <Avatar name="Anya Petrov" />
                    <Avatar name="Boris Karpov" size={32} />
                    <Avatar name="Cyril Sokolov" size={40} />
                    <Avatar />
                </div>
            </section>
        </main>
    );
}
