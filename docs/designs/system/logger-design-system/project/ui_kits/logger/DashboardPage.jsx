// Logger UI Kit — Dashboard, Alerts, Settings, Auth pages

// ── Mini sparkline chart ───────────────────────────────────────────────────
function Sparkline({ data, color = COLORS.accent, height = 40, width = 120 }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x},${y}`;
  }).join(' ');
  return React.createElement('svg', { width, height, style: { display: 'block' } },
    React.createElement('polyline', { points: pts, fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('polyline', { points: `0,${height} ${pts} ${width},${height}`, fill: color, fillOpacity: 0.1, stroke: 'none' })
  );
}

// ── KPI stat card ───────────────────────────────────────────────────────────
function StatCard({ label, value, delta, deltaDir, sparkData, color }) {
  return React.createElement('div', {
    style: {
      background: COLORS.bgRaised, border: `1px solid ${COLORS.borderSubtle}`,
      borderRadius: 6, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, flex: 1,
    }
  },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } },
      React.createElement('span', { style: { fontSize: 12, color: COLORS.textMuted, fontWeight: 500 } }, label),
      delta && React.createElement('span', {
        style: { fontSize: 11, color: deltaDir === 'up' ? LEVEL.error.text : LEVEL.info.text, fontWeight: 500 }
      }, `${deltaDir === 'up' ? '↑' : '↓'} ${delta}`)
    ),
    React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' } },
      React.createElement('span', { style: { fontSize: 28, fontWeight: 600, color: COLORS.textPrimary, lineHeight: 1 } }, value),
      sparkData && React.createElement(Sparkline, { data: sparkData, color: color || COLORS.accent, height: 36, width: 80 })
    )
  );
}

// ── Mini bar chart ──────────────────────────────────────────────────────────
function MiniBarChart({ data }) {
  const max = Math.max(...data.map(d => d.value));
  return React.createElement('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 } },
    data.map((d, i) =>
      React.createElement('div', { key: i, style: { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 } },
        React.createElement('div', {
          style: {
            width: '100%', background: d.color || COLORS.accent,
            borderRadius: '2px 2px 0 0', opacity: 0.8,
            height: `${(d.value / max) * 52}px`, minHeight: 2,
            transition: 'height 300ms',
          }
        }),
        React.createElement('span', { style: { fontSize: 9, color: COLORS.textMuted, whiteSpace: 'nowrap' } }, d.label)
      )
    )
  );
}

function DashboardPage() {
  const epmData = [12, 18, 14, 22, 19, 35, 28, 42, 38, 55, 48, 61, 45, 38, 42, 38, 44, 52, 58, 71, 65, 82, 78, 94];
  const errData = [2, 3, 1, 4, 3, 8, 6, 12, 9, 15, 11, 18, 13, 10, 12, 9, 11, 14, 16, 21, 18, 25, 22, 28];

  const levelBreakdown = [
    { label: 'FATAL', value: 3, color: LEVEL.fatal.dot },
    { label: 'ERROR', value: 47, color: LEVEL.error.dot },
    { label: 'WARN', value: 124, color: LEVEL.warn.dot },
    { label: 'INFO', value: 891, color: LEVEL.info.dot },
    { label: 'DEBUG', value: 417, color: LEVEL.debug.dot },
  ];

  const topErrors = [
    { message: "TypeError: Cannot read properties of undefined (reading 'userId')", count: 142, level: 'error' },
    { message: 'Database connection pool exhausted', count: 38, level: 'error' },
    { message: 'Webhook delivery failed after 3 retries', count: 27, level: 'error' },
    { message: 'Unhandled exception: segmentation fault in worker', count: 3, level: 'fatal' },
    { message: 'Rate limit exceeded for project api-gateway', count: 19, level: 'warn' },
  ];

  return React.createElement('div', {
    style: { padding: '16px', overflow: 'auto', height: '100%', display: 'flex', flexDirection: 'column', gap: 14 }
  },
    // Stats row
    React.createElement('div', { style: { display: 'flex', gap: 12 } },
      React.createElement(StatCard, { label: 'Events / min', value: '94', delta: '↑ 23%', deltaDir: 'up', sparkData: epmData }),
      React.createElement(StatCard, { label: 'Errors (1h)', value: '213', delta: '↑ 41%', deltaDir: 'up', sparkData: errData, color: LEVEL.error.dot }),
      React.createElement(StatCard, { label: 'Fatal (1h)', value: '3', delta: '', sparkData: null }),
      React.createElement(StatCard, { label: 'Alerts firing', value: '2', sparkData: null }),
    ),

    // Charts row
    React.createElement('div', { style: { display: 'flex', gap: 12 } },
      // Level breakdown
      React.createElement('div', {
        style: { background: COLORS.bgRaised, border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 6, padding: '14px 16px', width: 220, flexShrink: 0 }
      },
        React.createElement('div', { style: { fontSize: 12, fontWeight: 500, color: COLORS.textMuted, marginBottom: 12 } }, 'Level breakdown'),
        React.createElement(MiniBarChart, { data: levelBreakdown }),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 12 } },
          levelBreakdown.map(l =>
            React.createElement('div', { key: l.label, style: { display: 'flex', alignItems: 'center', gap: 8 } },
              React.createElement('div', { style: { width: 6, height: 6, borderRadius: '50%', background: l.color, flexShrink: 0 } }),
              React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted, flex: 1 } }, l.label),
              React.createElement('span', { style: { fontSize: 11, color: COLORS.textSecondary, fontFamily: 'monospace' } }, l.value.toLocaleString())
            )
          )
        )
      ),

      // Top errors
      React.createElement('div', {
        style: { flex: 1, background: COLORS.bgRaised, border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 6, padding: '14px 16px', overflow: 'hidden' }
      },
        React.createElement('div', { style: { fontSize: 12, fontWeight: 500, color: COLORS.textMuted, marginBottom: 10 } }, 'Top messages (1h)'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
          topErrors.map((e, i) =>
            React.createElement('div', {
              key: i,
              style: {
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 0', borderBottom: i < topErrors.length - 1 ? `1px solid ${COLORS.borderSubtle}` : 'none',
              }
            },
              React.createElement(LevelBadge, { level: e.level }),
              React.createElement('span', { style: { flex: 1, fontSize: 12, fontFamily: 'Geist Mono, monospace', color: COLORS.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, e.message),
              React.createElement('span', { style: { fontSize: 12, fontFamily: 'monospace', color: COLORS.textMuted, flexShrink: 0 } }, e.count.toLocaleString())
            )
          )
        )
      )
    )
  );
}

// ── Alerts Page ─────────────────────────────────────────────────────────────
function AlertsPage() {
  const alerts = [
    { id: 'a1', name: 'High error rate', status: 'firing', condition: 'count(error) ≥ 10 within 5m', channel: 'Slack #alerts', lastFired: '2m ago' },
    { id: 'a2', name: 'Fatal events', status: 'firing', condition: 'count(fatal) ≥ 1 within 1m', channel: 'PagerDuty', lastFired: '7m ago' },
    { id: 'a3', name: 'Warn spike', status: 'ok', condition: 'count(warn) ≥ 50 within 15m', channel: 'Slack #ops', lastFired: '3h ago' },
    { id: 'a4', name: 'API timeout', status: 'ok', condition: 'message ~ "timeout" count ≥ 5 within 5m', channel: 'Webhook', lastFired: 'Never' },
  ];

  return React.createElement('div', { style: { padding: '16px', overflow: 'auto', height: '100%' } },
    React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 } },
      React.createElement('div', null,
        React.createElement('div', { style: { fontSize: 16, fontWeight: 600, color: COLORS.textPrimary } }, 'Alert rules'),
        React.createElement('div', { style: { fontSize: 12, color: COLORS.textMuted, marginTop: 2 } }, '4 rules · 2 firing')
      ),
      React.createElement(Btn, { variant: 'primary', size: 'sm' },
        React.createElement(Icons.Plus, { size: 12 }), 'New alert rule'
      )
    ),
    React.createElement('div', { style: { border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 6, overflow: 'hidden' } },
      alerts.map((a, i) =>
        React.createElement('div', {
          key: a.id,
          style: {
            display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px',
            borderBottom: i < alerts.length - 1 ? `1px solid ${COLORS.borderSubtle}` : 'none',
            background: a.status === 'firing' ? 'rgba(239,68,68,0.04)' : 'transparent',
          }
        },
          React.createElement('div', {
            style: {
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              background: a.status === 'firing' ? LEVEL.error.dot : STATUS.success.dot,
              boxShadow: a.status === 'firing' ? `0 0 6px ${LEVEL.error.dot}` : 'none',
            }
          }),
          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
            React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, marginBottom: 2 } }, a.name),
            React.createElement('div', { style: { fontSize: 11, fontFamily: 'Geist Mono, monospace', color: COLORS.textMuted } }, a.condition)
          ),
          React.createElement('div', { style: { fontSize: 11, color: COLORS.textMuted, flexShrink: 0 } }, a.channel),
          React.createElement(StatusBadge, { status: a.status === 'firing' ? 'danger' : 'success', label: a.status === 'firing' ? 'Firing' : 'OK' }),
          React.createElement('div', { style: { fontSize: 11, color: COLORS.textMuted, width: 60, textAlign: 'right', flexShrink: 0 } }, a.lastFired),
          React.createElement(IconBtn, { title: 'More' }, React.createElement(Icons.MoreHorizontal, { size: 14 }))
        )
      )
    )
  );
}

// ── Settings Page ───────────────────────────────────────────────────────────
function SettingsPage({ section = 'general' }) {
  const [activeSection, setActiveSection] = React.useState(section);

  const sections = [
    { id: 'general', label: 'General' },
    { id: 'members', label: 'Members' },
    { id: 'apikeys', label: 'API keys' },
    { id: 'alerts', label: 'Alert channels' },
  ];

  return React.createElement('div', { style: { display: 'flex', height: '100%', overflow: 'hidden' } },
    // Sub-sidebar
    React.createElement('div', {
      style: {
        width: 180, flexShrink: 0, borderRight: `1px solid ${COLORS.borderSubtle}`,
        padding: '12px 0', background: COLORS.bgSurface,
      }
    },
      React.createElement('div', { style: { fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '0 14px 8px' } }, 'Project settings'),
      sections.map(s =>
        React.createElement('div', {
          key: s.id,
          onClick: () => setActiveSection(s.id),
          style: {
            padding: '7px 14px', fontSize: 13, cursor: 'pointer',
            color: activeSection === s.id ? COLORS.textPrimary : COLORS.textSecondary,
            background: activeSection === s.id ? COLORS.accentSubtle : 'transparent',
            borderRight: activeSection === s.id ? `2px solid ${COLORS.accent}` : '2px solid transparent',
            fontWeight: activeSection === s.id ? 500 : 400,
          },
          onMouseEnter: e => { if (activeSection !== s.id) e.currentTarget.style.background = COLORS.surfaceHover; },
          onMouseLeave: e => { if (activeSection !== s.id) e.currentTarget.style.background = 'transparent'; },
        }, s.label)
      )
    ),

    // Content
    React.createElement('div', { style: { flex: 1, padding: '20px 24px', overflow: 'auto' } },
      activeSection === 'general' && React.createElement('div', null,
        React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 20, marginTop: 0 } }, 'General'),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 } },
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textSecondary } }, 'Project name'),
            React.createElement('div', {
              style: { height: 32, padding: '0 10px', background: COLORS.bgRaised, border: `1px solid ${COLORS.borderDefault}`, borderRadius: 4, fontSize: 13, color: COLORS.textPrimary, display: 'flex', alignItems: 'center' }
            }, 'api-gateway')
          ),
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
            React.createElement('label', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textSecondary } }, 'Project ID'),
            React.createElement('div', {
              style: { height: 32, padding: '0 10px', background: COLORS.bgOverlay, border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 4, fontSize: 12, color: COLORS.textMuted, fontFamily: 'Geist Mono, monospace', display: 'flex', alignItems: 'center', cursor: 'not-allowed' }
            }, 'proj_01HX7K2M3N4P5Q')
          )
        )
      ),

      activeSection === 'apikeys' && React.createElement('div', null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
          React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: 0 } }, 'API keys'),
          React.createElement(Btn, { variant: 'primary', size: 'sm' },
            React.createElement(Icons.Plus, { size: 12 }), 'Create key'
          )
        ),
        React.createElement('div', { style: { border: `1px solid ${COLORS.borderSubtle}`, borderRadius: 6, overflow: 'hidden' } },
          [
            { name: 'Production ingest', key: 'lgr_sk_••••••••••••4f2a', created: 'Jan 10, 2024', lastUsed: '2m ago' },
            { name: 'Staging ingest', key: 'lgr_sk_••••••••••••8c1d', created: 'Jan 5, 2024', lastUsed: '1h ago' },
          ].map((k, i) =>
            React.createElement('div', {
              key: i,
              style: { display: 'flex', alignItems: 'center', gap: 14, padding: '12px 14px', borderBottom: i === 0 ? `1px solid ${COLORS.borderSubtle}` : 'none' }
            },
              React.createElement(Icons.Key, { size: 14 }),
              React.createElement('div', { style: { flex: 1 } },
                React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, marginBottom: 2 } }, k.name),
                React.createElement('div', { style: { fontSize: 11, fontFamily: 'Geist Mono, monospace', color: COLORS.textMuted } }, k.key)
              ),
              React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted } }, `Used ${k.lastUsed}`),
              React.createElement(IconBtn, { title: 'Revoke key' },
                React.createElement(Icons.X, { size: 13 })
              )
            )
          )
        )
      ),

      activeSection === 'members' && React.createElement('div', null,
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 } },
          React.createElement('h2', { style: { fontSize: 16, fontWeight: 600, color: COLORS.textPrimary, margin: 0 } }, 'Members'),
          React.createElement(Btn, { variant: 'secondary', size: 'sm' }, 'Invite member')
        ),
        [
          { name: 'Jane Doe', email: 'jane@acme.com', role: 'Admin', status: 'active' },
          { name: 'Bob Smith', email: 'bob@acme.com', role: 'Member', status: 'active' },
          { name: 'carol@acme.com', email: 'carol@acme.com', role: 'Member', status: 'invited' },
        ].map((m, i) =>
          React.createElement('div', {
            key: i,
            style: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: `1px solid ${COLORS.borderSubtle}` }
          },
            React.createElement(Avatar, { name: m.name, size: 28 }),
            React.createElement('div', { style: { flex: 1 } },
              React.createElement('div', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textPrimary } }, m.name),
              React.createElement('div', { style: { fontSize: 12, color: COLORS.textMuted } }, m.email)
            ),
            m.status === 'invited' && React.createElement('span', { style: { fontSize: 11, color: COLORS.textMuted, fontStyle: 'italic' } }, 'Invited'),
            React.createElement('span', {
              style: { fontSize: 11, fontWeight: 500, padding: '2px 7px', borderRadius: 4, border: `1px solid ${COLORS.borderDefault}`, color: COLORS.textMuted, background: COLORS.bgOverlay }
            }, m.role)
          )
        )
      )
    )
  );
}

// ── Auth Page ───────────────────────────────────────────────────────────────
function AuthPage({ mode = 'login' }) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');

  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100%', background: COLORS.bgBase,
    }
  },
    React.createElement('div', {
      style: {
        width: 360, background: COLORS.bgSurface,
        border: `1px solid ${COLORS.borderDefault}`,
        borderRadius: 8, padding: '32px 28px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }
    },
      // Logo / wordmark
      React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 } },
        React.createElement('div', {
          style: {
            width: 28, height: 28, borderRadius: 6,
            background: COLORS.accentSubtle, border: `1px solid ${COLORS.accentBorder}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }
        }, React.createElement('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: COLORS.accentText, strokeWidth: 1.5, strokeLinecap: 'round' },
          React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
          React.createElement('polyline', { points: '14 2 14 8 20 8' }),
          React.createElement('line', { x1: 8, y1: 13, x2: 16, y2: 13 }),
          React.createElement('line', { x1: 8, y1: 17, x2: 14, y2: 17 })
        )),
        React.createElement('span', { style: { fontSize: 16, fontWeight: 600, color: COLORS.textPrimary } }, 'Logger')
      ),

      mode === 'invite' && React.createElement('div', {
        style: {
          background: COLORS.accentSubtle, border: `1px solid ${COLORS.accentBorder}`,
          borderRadius: 5, padding: '10px 12px', marginBottom: 20, fontSize: 13, color: COLORS.accentText, lineHeight: 1.5,
        }
      },
        React.createElement('strong', null, 'Jane Doe'),
        ' invited you to join ',
        React.createElement('strong', null, 'acme-org'),
        ' on Logger.'
      ),

      React.createElement('h1', {
        style: { fontSize: 18, fontWeight: 600, color: COLORS.textPrimary, margin: '0 0 4px' }
      }, mode === 'login' ? 'Sign in' : 'Accept invitation'),
      React.createElement('p', {
        style: { fontSize: 13, color: COLORS.textMuted, margin: '0 0 24px' }
      }, mode === 'login' ? 'Sign in to your Logger account.' : 'Create a password to get started.'),

      React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          React.createElement('label', { style: { fontSize: 12, fontWeight: 500, color: COLORS.textSecondary } }, 'Email'),
          React.createElement('input', {
            type: 'email', value: email, onChange: e => setEmail(e.target.value),
            placeholder: 'you@company.com',
            style: {
              height: 34, padding: '0 10px', background: COLORS.bgRaised,
              border: `1px solid ${COLORS.borderDefault}`, borderRadius: 4,
              fontSize: 13, color: COLORS.textPrimary, fontFamily: 'inherit', outline: 'none',
            }
          })
        ),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 5 } },
          React.createElement('label', { style: { fontSize: 12, fontWeight: 500, color: COLORS.textSecondary } }, 'Password'),
          React.createElement('input', {
            type: 'password', value: password, onChange: e => setPassword(e.target.value),
            placeholder: '••••••••',
            style: {
              height: 34, padding: '0 10px', background: COLORS.bgRaised,
              border: `1px solid ${COLORS.borderDefault}`, borderRadius: 4,
              fontSize: 13, color: COLORS.textPrimary, fontFamily: 'inherit', outline: 'none',
            }
          })
        ),
        React.createElement(Btn, {
          variant: 'primary',
          style: { width: '100%', justifyContent: 'center', height: 36, fontSize: 14 },
        }, mode === 'login' ? 'Sign in' : 'Create account'),
      ),

      mode === 'login' && React.createElement('div', {
        style: { textAlign: 'center', marginTop: 16, fontSize: 12, color: COLORS.textMuted }
      }, "Don't have an account? ",
        React.createElement('span', { style: { color: COLORS.accentText, cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 2 } }, 'Request access')
      )
    )
  );
}

Object.assign(window, { DashboardPage, AlertsPage, SettingsPage, AuthPage });
