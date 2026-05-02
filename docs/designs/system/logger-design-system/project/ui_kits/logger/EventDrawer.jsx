// Logger UI Kit — Event Detail Drawer

function EventDrawer({ event, onClose }) {
  const [activeTab, setActiveTab] = React.useState('details');
  const [copied, setCopied] = React.useState(false);

  if (!event) return null;

  const tabs = ['Details', 'Attributes', 'Stack trace'];

  function handleCopy() {
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const stackFrames = [
    { num: 1, fn: 'processRequest', loc: 'app/handlers/events.ts', line: '142:18', internal: false },
    { num: 2, fn: 'Router.handle', loc: 'node_modules/express/lib/router/index.js', line: '284:12', internal: true },
    { num: 3, fn: 'next', loc: 'node_modules/express/lib/router/index.js', line: '260:14', internal: true },
    { num: 4, fn: 'Layer.handle', loc: 'node_modules/express/lib/router/layer.js', line: '95:5', internal: true },
    { num: 5, fn: 'processParams', loc: 'node_modules/express/lib/router/index.js', line: '335:12', internal: true },
  ];

  const attributes = [
    { key: 'event_id', value: 'evt_01HX7K2M3N', type: 'string' },
    { key: 'level', value: event.level, type: 'string' },
    { key: 'project', value: event.source, type: 'string' },
    { key: 'environment', value: event.env, type: 'string' },
    { key: 'request_id', value: 'req_01HX7K2M3N4P5Q6R', type: 'string' },
    { key: 'status_code', value: '500', type: 'number' },
    { key: 'duration_ms', value: '1843', type: 'number' },
    { key: 'user_agent', value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', type: 'string' },
    { key: 'ip', value: '10.0.1.42', type: 'string' },
  ];

  const syntaxColors = { string: '#f1fa8c', number: '#bd93f9', fn: '#50fa7b', path: '#8be9fd', comment: '#6272a4' };

  return React.createElement('div', {
    style: {
      width: 520, flexShrink: 0,
      background: COLORS.bgSurface,
      borderLeft: `1px solid ${COLORS.borderDefault}`,
      display: 'flex', flexDirection: 'column',
      height: '100%',
      boxShadow: '-4px 0 20px rgba(0,0,0,0.3)',
      animation: 'slideIn 200ms cubic-bezier(0,0,0.2,1)',
    }
  },
    // Header
    React.createElement('div', {
      style: { padding: '14px 16px 12px', borderBottom: `1px solid ${COLORS.borderSubtle}`, flexShrink: 0 }
    },
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
        React.createElement(LevelBadge, { level: event.level }),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement(IconBtn, { title: 'Copy as JSON', onClick: handleCopy },
          copied
            ? React.createElement('svg', { width: 13, height: 13, viewBox: '0 0 24 24', fill: 'none', stroke: '#86efac', strokeWidth: 2, strokeLinecap: 'round' }, React.createElement('polyline', { points: '20 6 9 17 4 12' }))
            : React.createElement(Icons.Copy, { size: 13 })
        ),
        React.createElement(IconBtn, { title: 'Open in new tab' }, React.createElement(Icons.ExternalLink, { size: 13 })),
        React.createElement('button', {
          onClick: onClose,
          style: {
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 26, height: 26, borderRadius: 4, border: 'none',
            background: 'transparent', color: COLORS.textMuted, cursor: 'pointer', marginLeft: 2,
          },
          onMouseEnter: e => { e.currentTarget.style.background = COLORS.surfaceHover; e.currentTarget.style.color = COLORS.textPrimary; },
          onMouseLeave: e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = COLORS.textMuted; },
        }, React.createElement(Icons.X, { size: 14 }))
      ),
      React.createElement('div', {
        style: { fontFamily: 'Geist Mono, monospace', fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, lineHeight: 1.45, marginBottom: 8 }
      }, event.message),
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
        React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted, fontFamily: 'Geist Mono, monospace' } }, `2024-01-15 ${event.ts} UTC`),
        React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted } }, event.source),
        React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted } }, event.env),
      )
    ),

    // Tabs
    React.createElement('div', {
      style: { display: 'flex', borderBottom: `1px solid ${COLORS.borderSubtle}`, padding: '0 16px', flexShrink: 0 }
    },
      tabs.map(t =>
        React.createElement('div', {
          key: t,
          onClick: () => setActiveTab(t.toLowerCase().replace(' ', '_')),
          style: {
            padding: '8px 12px', fontSize: 13, cursor: 'pointer',
            color: activeTab === t.toLowerCase().replace(' ', '_') ? COLORS.textPrimary : COLORS.textMuted,
            borderBottom: `2px solid ${activeTab === t.toLowerCase().replace(' ', '_') ? COLORS.accent : 'transparent'}`,
            marginBottom: -1, fontWeight: activeTab === t.toLowerCase().replace(' ', '_') ? 500 : 400,
            transition: 'color 100ms',
          }
        }, t)
      )
    ),

    // Body
    React.createElement('div', { style: { flex: 1, overflow: 'auto', padding: '14px 16px' } },

      // Details tab
      activeTab === 'details' && React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 } }, 'Event details'),
        React.createElement('div', {
          style: { border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 5, overflow: 'hidden' }
        },
          attributes.slice(0, 7).map(attr =>
            React.createElement('div', {
              key: attr.key,
              style: {
                display: 'flex', alignItems: 'baseline', gap: 8,
                padding: '6px 12px', borderBottom: `1px solid ${COLORS.borderSubtle}`,
              }
            },
              React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: COLORS.textMuted, fontFamily: 'Geist Mono, monospace', width: 120, flexShrink: 0 } }, attr.key),
              React.createElement('span', {
                style: {
                  fontSize: 12, fontFamily: 'Geist Mono, monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                  color: attr.type === 'number' ? '#bd93f9' : attr.type === 'string' ? '#f1fa8c' : COLORS.textPrimary,
                }
              }, attr.value)
            )
          )
        )
      ),

      // Attributes tab
      activeTab === 'attributes' && React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 8 } }, 'All attributes'),
        React.createElement('div', {
          style: { border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 5, overflow: 'hidden' }
        },
          attributes.map(attr =>
            React.createElement('div', {
              key: attr.key,
              style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '6px 12px', borderBottom: `1px solid ${COLORS.borderSubtle}` }
            },
              React.createElement('span', { style: { fontSize: 12, fontWeight: 500, color: COLORS.textMuted, fontFamily: 'Geist Mono, monospace', width: 120, flexShrink: 0 } }, attr.key),
              React.createElement('span', { style: { fontSize: 12, fontFamily: 'Geist Mono, monospace', color: attr.type === 'number' ? '#bd93f9' : '#f1fa8c' } }, attr.value)
            )
          )
        )
      ),

      // Stack trace tab
      activeTab === 'stack_trace' && React.createElement('div', null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 } },
          React.createElement('div', { style: { fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase' } }, 'Stack trace'),
          React.createElement(Btn, { variant: 'ghost', size: 'sm' }, 'Expand all')
        ),
        React.createElement('div', { style: { background: '#141417', border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 5, overflow: 'hidden', fontFamily: 'Geist Mono, monospace' } },
          stackFrames.map((frame, i) =>
            React.createElement('div', {
              key: i,
              style: {
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 12px',
                borderBottom: i < stackFrames.length - 1 ? `1px solid ${COLORS.borderSubtle}` : 'none',
                background: frame.internal ? 'transparent' : 'rgba(255,255,255,0.02)',
              }
            },
              React.createElement('span', { style: { fontSize: 10, color: '#6272a4', width: 18, textAlign: 'right', flexShrink: 0, paddingTop: 2 } }, frame.num),
              React.createElement('div', null,
                React.createElement('div', { style: { fontSize: 12, color: '#50fa7b', fontWeight: 500, marginBottom: 2 } }, frame.fn),
                React.createElement('div', { style: { fontSize: 11, color: frame.internal ? '#6272a4' : '#8be9fd' } }, `${frame.loc}:${frame.line}`)
              )
            )
          )
        )
      )
    )
  );
}

// Inject slide-in animation
const drawerStyle = document.createElement('style');
drawerStyle.textContent = `@keyframes slideIn { from { transform: translateX(40px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
document.head.appendChild(drawerStyle);

Object.assign(window, { EventDrawer });
