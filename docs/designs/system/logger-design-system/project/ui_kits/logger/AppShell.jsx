// Logger UI Kit — App Shell (Sidebar + Topbar)

function AppShell({ children, activePage, activeProject, onNavigate, projects = [] }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const sw = collapsed ? 56 : 240;

  const navItems = [
    { id: 'events', label: 'Events', icon: React.createElement(Icons.Filter) },
    { id: 'dashboard', label: 'Dashboard', icon: React.createElement(Icons.BarChart) },
    { id: 'alerts', label: 'Alerts', icon: React.createElement(Icons.Bell) },
  ];

  return React.createElement('div', {
    style: { display: 'flex', height: '100vh', background: COLORS.bgBase, overflow: 'hidden', fontFamily: 'Geist, Inter, sans-serif' }
  },
    // Sidebar
    React.createElement('div', {
      style: {
        width: sw, flexShrink: 0,
        background: COLORS.bgSurface,
        borderRight: `1px solid ${COLORS.borderSubtle}`,
        display: 'flex', flexDirection: 'column',
        transition: 'width 200ms cubic-bezier(0,0,0.2,1)',
        overflow: 'hidden',
      }
    },
      // Org switcher
      React.createElement('div', {
        style: { padding: '10px 10px 8px', borderBottom: `1px solid ${COLORS.borderSubtle}`, flexShrink: 0 }
      },
        React.createElement('div', {
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '5px 6px', borderRadius: 4, cursor: 'pointer',
          },
          onClick: () => setCollapsed(!collapsed),
        },
          React.createElement('div', {
            style: {
              width: 22, height: 22, borderRadius: 4,
              background: COLORS.accentSubtle,
              border: `1px solid ${COLORS.accentBorder}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 11, fontWeight: 700, color: COLORS.accentText, flexShrink: 0,
            }
          }, 'A'),
          !collapsed && React.createElement(React.Fragment, null,
            React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, flex: 1 } }, 'acme-org'),
            React.createElement(Icons.ChevronDown, { size: 12 })
          )
        )
      ),

      // Projects
      React.createElement('div', { style: { flex: 1, overflowY: 'auto', padding: '6px 0' } },
        !collapsed && React.createElement('div', {
          style: { fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '6px 12px 3px' }
        }, 'Projects'),
        projects.map(p =>
          React.createElement('div', {
            key: p.id,
            onClick: () => onNavigate && onNavigate('events', p.id),
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              padding: collapsed ? '7px 0' : '6px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              fontSize: 13, cursor: 'pointer',
              background: activeProject === p.id ? COLORS.accentSubtle : 'transparent',
              color: activeProject === p.id ? COLORS.accentText : COLORS.textSecondary,
              borderRight: activeProject === p.id ? `2px solid ${COLORS.accent}` : '2px solid transparent',
              transition: 'background 100ms, color 100ms',
            },
            onMouseEnter: e => { if (activeProject !== p.id) e.currentTarget.style.background = COLORS.surfaceHover; },
            onMouseLeave: e => { if (activeProject !== p.id) e.currentTarget.style.background = 'transparent'; },
          },
            React.createElement(Icons.File, { size: 13 }),
            !collapsed && React.createElement('span', null, p.name)
          )
        ),

        // Nav items
        !collapsed && React.createElement('div', {
          style: { fontSize: 10, fontWeight: 600, color: COLORS.textMuted, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '10px 12px 3px', marginTop: 4, borderTop: `1px solid ${COLORS.borderSubtle}` }
        }, 'Sections'),
        navItems.map(item =>
          React.createElement('div', {
            key: item.id,
            onClick: () => onNavigate && onNavigate(item.id, activeProject),
            style: {
              display: 'flex', alignItems: 'center', gap: 8,
              padding: collapsed ? '7px 0' : '6px 12px',
              justifyContent: collapsed ? 'center' : 'flex-start',
              fontSize: 13, cursor: 'pointer',
              background: activePage === item.id ? COLORS.accentSubtle : 'transparent',
              color: activePage === item.id ? COLORS.accentText : COLORS.textSecondary,
              borderRight: activePage === item.id ? `2px solid ${COLORS.accent}` : '2px solid transparent',
              transition: 'background 100ms',
            },
            onMouseEnter: e => { if (activePage !== item.id) e.currentTarget.style.background = COLORS.surfaceHover; },
            onMouseLeave: e => { if (activePage !== item.id) e.currentTarget.style.background = 'transparent'; },
          },
            item.icon,
            !collapsed && React.createElement('span', null, item.label)
          )
        )
      ),

      // Settings link
      React.createElement('div', { style: { borderTop: `1px solid ${COLORS.borderSubtle}`, padding: '6px 0' } },
        React.createElement('div', {
          onClick: () => onNavigate && onNavigate('settings', activeProject),
          style: {
            display: 'flex', alignItems: 'center', gap: 8,
            padding: collapsed ? '7px 0' : '6px 12px',
            justifyContent: collapsed ? 'center' : 'flex-start',
            fontSize: 13, cursor: 'pointer', color: COLORS.textMuted,
            transition: 'color 100ms',
          },
          onMouseEnter: e => { e.currentTarget.style.color = COLORS.textPrimary; },
          onMouseLeave: e => { e.currentTarget.style.color = COLORS.textMuted; },
        },
          React.createElement(Icons.Settings, { size: 13 }),
          !collapsed && 'Settings'
        )
      )
    ),

    // Main area
    React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // Topbar
      React.createElement('div', {
        style: {
          height: 48, flexShrink: 0,
          background: COLORS.bgSurface,
          borderBottom: `1px solid ${COLORS.borderSubtle}`,
          display: 'flex', alignItems: 'center',
          padding: '0 16px', gap: 8,
        }
      },
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textSecondary } }, activeProject || 'Logger'),
        React.createElement('span', { style: { color: COLORS.textMuted, fontSize: 11 } }, '›'),
        React.createElement('span', { style: { fontSize: 13, fontWeight: 500, color: COLORS.textPrimary, textTransform: 'capitalize' } }, activePage),
        React.createElement('div', { style: { flex: 1 } }),
        React.createElement(Icons.Bell, { size: 14 }),
        React.createElement('div', {
          style: {
            marginLeft: 4, width: 26, height: 26, borderRadius: '50%',
            background: COLORS.bgOverlay, border: `1px solid ${COLORS.borderDefault}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 600, color: COLORS.textSecondary, cursor: 'pointer',
          }
        }, 'JD')
      ),

      // Content
      React.createElement('div', { style: { flex: 1, overflow: 'hidden' } }, children)
    )
  );
}

Object.assign(window, { AppShell });
