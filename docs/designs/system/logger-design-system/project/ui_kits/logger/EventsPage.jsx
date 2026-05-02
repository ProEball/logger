// Logger UI Kit — Events Page (Table + Filter Bar)

const SAMPLE_EVENTS = [
  { id: 'evt_01', ts: '14:32:07.421', level: 'fatal', message: 'Unhandled exception: segmentation fault in worker process at pid 14872', source: 'api-gateway', env: 'prod' },
  { id: 'evt_02', ts: '14:31:58.003', level: 'error', message: "TypeError: Cannot read properties of undefined (reading 'userId')", source: 'auth-service', env: 'prod' },
  { id: 'evt_03', ts: '14:31:44.781', level: 'error', message: 'Database connection pool exhausted after 30s — 0 connections available', source: 'db-pool', env: 'prod' },
  { id: 'evt_04', ts: '14:31:39.220', level: 'warn', message: 'Rate limit approaching: 87% of quota used (8,700 / 10,000 req/min)', source: 'rate-limiter', env: 'prod' },
  { id: 'evt_05', ts: '14:31:28.105', level: 'error', message: 'Webhook delivery failed after 3 retries: connect ECONNREFUSED 10.0.1.42:3000', source: 'webhook-svc', env: 'prod' },
  { id: 'evt_06', ts: '14:31:14.882', level: 'info', message: 'Worker process restarted successfully — uptime reset', source: 'worker-pool', env: 'prod' },
  { id: 'evt_07', ts: '14:31:02.441', level: 'info', message: 'Ingested 1,204 events in the last 60 seconds', source: 'ingestion', env: 'prod' },
  { id: 'evt_08', ts: '14:30:57.019', level: 'warn', message: 'Slow query detected: 1843ms for SELECT on events table (missing index on level)', source: 'db-pool', env: 'staging' },
  { id: 'evt_09', ts: '14:30:44.233', level: 'debug', message: 'Cache miss for key: user:session:c3f8e2a1b4d7 — fetching from primary', source: 'cache', env: 'dev' },
  { id: 'evt_10', ts: '14:30:31.701', level: 'info', message: 'Alert rule "High error rate" evaluated — threshold not met (3/10)', source: 'alert-engine', env: 'prod' },
  { id: 'evt_11', ts: '14:30:20.118', level: 'error', message: 'Failed to parse event payload: unexpected token at position 142', source: 'api-gateway', env: 'prod' },
  { id: 'evt_12', ts: '14:30:08.774', level: 'debug', message: 'Initialized connection pool with 10 workers — min:2 max:10 idle:30s', source: 'db-pool', env: 'dev' },
];

function FilterBar({ filters, onRemove, search, onSearch, timeRange, onTimeRange }) {
  const timeOptions = ['15m', '1h', '6h', '24h', '7d'];
  const [showTimeMenu, setShowTimeMenu] = React.useState(false);
  const [showAddMenu, setShowAddMenu] = React.useState(false);

  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
      padding: '8px 10px',
      background: COLORS.bgRaised,
      border: `1px solid ${COLORS.borderSubtle}`,
      borderRadius: 6,
      flexShrink: 0,
    }
  },
    // Search
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: 6,
        height: 28, padding: '0 8px',
        background: COLORS.bgOverlay,
        border: `1px solid ${COLORS.borderDefault}`,
        borderRadius: 4, minWidth: 180,
      }
    },
      React.createElement(Icons.Search, { size: 12 }),
      React.createElement('input', {
        value: search, onChange: e => onSearch(e.target.value),
        placeholder: 'Search events…',
        style: {
          background: 'transparent', border: 'none', outline: 'none',
          fontSize: 12, color: COLORS.textPrimary, fontFamily: 'inherit',
          width: 140,
        }
      })
    ),

    filters.length > 0 && React.createElement('div', { style: { width: 1, height: 20, background: COLORS.borderSubtle, flexShrink: 0 } }),

    // Filter chips
    ...filters.map(f =>
      React.createElement('span', {
        key: f.id,
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '3px 7px', borderRadius: 4, fontSize: 12, fontWeight: 500,
          border: `1px solid ${COLORS.borderDefault}`,
          color: COLORS.textSecondary, background: COLORS.bgOverlay,
          whiteSpace: 'nowrap',
        }
      },
        React.createElement('span', { style: { color: COLORS.textMuted, fontSize: 11 } }, f.key + ':'),
        React.createElement('span', { style: { color: COLORS.textPrimary } }, f.value),
        React.createElement('span', {
          onClick: () => onRemove(f.id),
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 13, height: 13, borderRadius: 2, cursor: 'pointer',
            color: COLORS.textMuted, marginLeft: 1,
          }
        }, React.createElement(Icons.X, { size: 9 }))
      )
    ),

    // Add filter
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('button', {
        onClick: () => setShowAddMenu(!showAddMenu),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 28, padding: '0 8px',
          background: 'transparent',
          border: `1px dashed ${COLORS.borderDefault}`,
          borderRadius: 4, fontSize: 12, color: COLORS.textMuted,
          cursor: 'pointer', fontFamily: 'inherit',
        }
      },
        React.createElement(Icons.Plus, { size: 11 }),
        'Add filter'
      ),
      showAddMenu && React.createElement('div', {
        style: {
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          background: COLORS.bgOverlay, border: `1px solid ${COLORS.borderDefault}`,
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          width: 160, zIndex: 100, overflow: 'hidden',
        }
      },
        ['Level', 'Environment', 'Source', 'Message contains', 'Attribute'].map(opt =>
          React.createElement('div', {
            key: opt,
            onClick: () => setShowAddMenu(false),
            style: {
              padding: '7px 12px', fontSize: 12, color: COLORS.textPrimary,
              cursor: 'pointer',
            },
            onMouseEnter: e => e.currentTarget.style.background = COLORS.surfaceHover,
            onMouseLeave: e => e.currentTarget.style.background = 'transparent',
          }, opt)
        )
      )
    ),

    React.createElement('div', { style: { flex: 1 } }),
    React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted, whiteSpace: 'nowrap' } }, `${SAMPLE_EVENTS.length} events`),

    // Time range
    React.createElement('div', { style: { position: 'relative' } },
      React.createElement('button', {
        onClick: () => setShowTimeMenu(!showTimeMenu),
        style: {
          display: 'inline-flex', alignItems: 'center', gap: 5,
          height: 28, padding: '0 10px',
          background: COLORS.bgOverlay,
          border: `1px solid ${COLORS.borderDefault}`,
          borderRadius: 4, fontSize: 12, fontWeight: 500, color: COLORS.textSecondary,
          cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap',
        }
      },
        React.createElement(Icons.Clock, { size: 12 }),
        `Last ${timeRange}`,
        React.createElement(Icons.ChevronDown, { size: 10 })
      ),
      showTimeMenu && React.createElement('div', {
        style: {
          position: 'absolute', top: 'calc(100% + 4px)', right: 0,
          background: COLORS.bgOverlay, border: `1px solid ${COLORS.borderDefault}`,
          borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          width: 120, zIndex: 100, overflow: 'hidden',
        }
      },
        timeOptions.map(t =>
          React.createElement('div', {
            key: t,
            onClick: () => { onTimeRange(t); setShowTimeMenu(false); },
            style: {
              padding: '7px 12px', fontSize: 12,
              color: t === timeRange ? COLORS.accentText : COLORS.textPrimary,
              background: t === timeRange ? COLORS.accentSubtle : 'transparent',
              cursor: 'pointer',
            },
            onMouseEnter: e => { if (t !== timeRange) e.currentTarget.style.background = COLORS.surfaceHover; },
            onMouseLeave: e => { if (t !== timeRange) e.currentTarget.style.background = 'transparent'; },
          }, `Last ${t}`)
        )
      )
    )
  );
}

function EventsTable({ events, selectedId, onSelect, loading }) {
  const cols = [
    { key: 'ts', label: 'Timestamp', width: 110 },
    { key: 'level', label: 'Level', width: 75 },
    { key: 'message', label: 'Message', flex: 1 },
    { key: 'source', label: 'Source', width: 110 },
    { key: 'env', label: 'Env', width: 70 },
    { key: 'chevron', label: '', width: 28 },
  ];

  return React.createElement('div', { style: { flex: 1, overflow: 'auto' } },
    React.createElement('table', {
      style: { width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }
    },
      React.createElement('thead', null,
        React.createElement('tr', {
          style: {
            background: COLORS.bgRaised,
            borderBottom: `1px solid ${COLORS.borderDefault}`,
            position: 'sticky', top: 0, zIndex: 10,
          }
        },
          ...cols.map(col =>
            React.createElement('th', {
              key: col.key,
              style: {
                padding: '0 10px', height: 34,
                fontSize: 11, fontWeight: 600, color: COLORS.textMuted,
                textAlign: 'left', whiteSpace: 'nowrap',
                letterSpacing: '0.04em', textTransform: 'uppercase',
                borderRight: `1px solid ${COLORS.borderSubtle}`,
                width: col.width, ...(col.flex ? { width: 'auto' } : {}),
              }
            }, col.label)
          )
        )
      ),
      React.createElement('tbody', null,
        loading ? Array(6).fill(0).map((_, i) =>
          React.createElement('tr', { key: i, style: { height: 34, borderBottom: `1px solid ${COLORS.borderSubtle}` } },
            React.createElement('td', { colSpan: 6, style: { padding: '0 10px' } },
              React.createElement('div', {
                style: {
                  height: 10, borderRadius: 3, width: `${60 + Math.random() * 30}%`,
                  background: `linear-gradient(90deg, ${COLORS.bgRaised} 25%, ${COLORS.bgOverlay} 50%, ${COLORS.bgRaised} 75%)`,
                  backgroundSize: '200% 100%', animation: 'shimmer 1.4s infinite',
                }
              })
            )
          )
        ) :
        events.map(ev => {
          const isSelected = ev.id === selectedId;
          const lc = LEVEL[ev.level];
          return React.createElement('tr', {
            key: ev.id,
            onClick: () => onSelect(ev),
            style: {
              height: 34,
              borderBottom: `1px solid ${COLORS.borderSubtle}`,
              cursor: 'pointer',
              background: isSelected
                ? COLORS.accentSubtle
                : (ev.level === 'fatal' ? 'rgba(185,28,28,0.08)' : ev.level === 'error' ? 'rgba(239,68,68,0.05)' : 'transparent'),
              transition: 'background 80ms',
            },
            onMouseEnter: e => { if (!isSelected) e.currentTarget.style.background = COLORS.surfaceHover; },
            onMouseLeave: e => { if (!isSelected) e.currentTarget.style.background = ev.level === 'fatal' ? 'rgba(185,28,28,0.08)' : ev.level === 'error' ? 'rgba(239,68,68,0.05)' : 'transparent'; },
          },
            React.createElement('td', { style: { padding: '0 10px', fontFamily: 'Geist Mono, monospace', fontSize: 11, color: COLORS.textMuted, borderRight: `1px solid ${COLORS.borderSubtle}`, whiteSpace: 'nowrap' } }, ev.ts),
            React.createElement('td', { style: { padding: '0 10px', borderRight: `1px solid ${COLORS.borderSubtle}` } },
              React.createElement(LevelBadge, { level: ev.level })
            ),
            React.createElement('td', { style: { padding: '0 10px', fontFamily: 'Geist Mono, monospace', fontSize: 12, color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRight: `1px solid ${COLORS.borderSubtle}` } }, ev.message),
            React.createElement('td', { style: { padding: '0 10px', fontSize: 12, color: COLORS.textSecondary, borderRight: `1px solid ${COLORS.borderSubtle}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, ev.source),
            React.createElement('td', { style: { padding: '0 10px', borderRight: `1px solid ${COLORS.borderSubtle}` } },
              React.createElement('span', {
                style: {
                  display: 'inline-block', padding: '1px 6px', borderRadius: 4,
                  fontSize: 10, fontWeight: 500,
                  border: `1px solid ${COLORS.borderDefault}`,
                  color: COLORS.textMuted, background: COLORS.bgOverlay,
                }
              }, ev.env)
            ),
            React.createElement('td', { style: { padding: '0 6px', textAlign: 'center' } },
              React.createElement(Icons.ChevronRight, { size: 12 })
            )
          );
        })
      )
    )
  );
}

function EventsPage({ project, onSelectEvent, selectedEventId }) {
  const [search, setSearch] = React.useState('');
  const [timeRange, setTimeRange] = React.useState('1h');
  const [filters, setFilters] = React.useState([
    { id: 'f1', key: 'level', value: 'error, fatal' },
    { id: 'f2', key: 'env', value: 'prod' },
  ]);

  const filtered = SAMPLE_EVENTS.filter(e => {
    if (search && !e.message.toLowerCase().includes(search.toLowerCase()) && !e.source.includes(search)) return false;
    return true;
  });

  return React.createElement('div', {
    style: {
      display: 'flex', flexDirection: 'column', height: '100%',
      overflow: 'hidden',
    }
  },
    React.createElement('div', { style: { padding: '12px 16px', flexShrink: 0 } },
      React.createElement(FilterBar, {
        filters, onRemove: id => setFilters(f => f.filter(x => x.id !== id)),
        search, onSearch: setSearch,
        timeRange, onTimeRange: setTimeRange,
      })
    ),
    React.createElement(EventsTable, {
      events: filtered, selectedId: selectedEventId,
      onSelect: onSelectEvent,
    }),
    // Pagination
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 16px', borderTop: `1px solid ${COLORS.borderSubtle}`,
        flexShrink: 0, background: COLORS.bgSurface,
      }
    },
      React.createElement('span', { style: { fontSize: 12, color: COLORS.textMuted } }, `${filtered.length} events`),
      React.createElement('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
        ...[null, 1, 2, 3, '…', 24, null].map((p, i) => {
          if (p === null) return React.createElement('button', {
            key: i,
            disabled: i === 0,
            style: {
              width: 28, height: 28, borderRadius: 4, border: `1px solid ${COLORS.borderSubtle}`,
              background: 'transparent', color: COLORS.textSecondary, cursor: i === 0 ? 'not-allowed' : 'pointer',
              opacity: i === 0 ? 0.3 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }
          }, React.createElement(i === 0 ? 'span' : 'span', null,
            i === 0
              ? React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }, React.createElement('polyline', { points: '15 18 9 12 15 6' }))
              : React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }, React.createElement('polyline', { points: '9 18 15 12 9 6' }))
          ));
          if (p === '…') return React.createElement('span', { key: i, style: { fontSize: 12, color: COLORS.textMuted, padding: '0 4px' } }, '…');
          return React.createElement('button', {
            key: i,
            style: {
              width: 28, height: 28, borderRadius: 4, fontSize: 12,
              border: `1px solid ${p === 1 ? COLORS.accentBorder : COLORS.borderSubtle}`,
              background: p === 1 ? COLORS.accentSubtle : 'transparent',
              color: p === 1 ? COLORS.accentText : COLORS.textSecondary,
              cursor: 'pointer', fontWeight: p === 1 ? 500 : 400,
            }
          }, p);
        })
      )
    )
  );
}

Object.assign(window, { EventsPage, SAMPLE_EVENTS });
