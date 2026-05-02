// Logger Design System — Shared Components
// Loaded globally; exports to window for other scripts to use.

const COLORS = {
  bgBase: '#0d0d0f',
  bgSurface: '#111114',
  bgRaised: '#18181c',
  bgOverlay: '#1e1e23',
  borderSubtle: '#26262d',
  borderDefault: '#2e2e37',
  borderStrong: '#3a3a45',
  textPrimary: '#e8e8f0',
  textSecondary: '#8e8ea0',
  textMuted: '#6b6b7e',
  textPlaceholder: '#4d4d5c',
  accent: '#6366f1',
  accentHover: '#818cf8',
  accentSubtle: 'rgba(99,102,241,0.12)',
  accentBorder: 'rgba(99,102,241,0.35)',
  accentText: '#a5b4fc',
  surfaceHover: '#18181c',
  surfaceActive: '#1e1e23',
};

const LEVEL = {
  debug: { bg:'rgba(71,85,105,0.15)', border:'rgba(71,85,105,0.35)', text:'#94a3b8', dot:'#64748b' },
  info:  { bg:'rgba(59,130,246,0.12)', border:'rgba(59,130,246,0.30)', text:'#93c5fd', dot:'#3b82f6' },
  warn:  { bg:'rgba(245,158,11,0.12)', border:'rgba(245,158,11,0.30)', text:'#fcd34d', dot:'#f59e0b' },
  error: { bg:'rgba(239,68,68,0.12)', border:'rgba(239,68,68,0.28)', text:'#fca5a5', dot:'#ef4444' },
  fatal: { bg:'rgba(185,28,28,0.20)', border:'rgba(220,38,38,0.45)', text:'#fecaca', dot:'#dc2626' },
};

const STATUS = {
  success: { bg:'rgba(34,197,94,0.12)', border:'rgba(34,197,94,0.30)', text:'#86efac', dot:'#22c55e' },
  warning: { bg:'rgba(245,158,11,0.12)', border:'rgba(245,158,11,0.30)', text:'#fcd34d', dot:'#f59e0b' },
  danger:  { bg:'rgba(239,68,68,0.12)', border:'rgba(239,68,68,0.28)', text:'#fca5a5', dot:'#ef4444' },
  info:    { bg:'rgba(59,130,246,0.12)', border:'rgba(59,130,246,0.30)', text:'#93c5fd', dot:'#3b82f6' },
};

// ── Low-level primitives ────────────────────────────────────────────────────

function LevelBadge({ level, size = 'sm' }) {
  const c = LEVEL[level] || LEVEL.debug;
  const pad = size === 'sm' ? '1px 6px' : '2px 8px';
  const fs = size === 'sm' ? 10 : 11;
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 4,
      padding: pad, borderRadius: 4, fontSize: fs, fontWeight: 600,
      border: `1px solid ${c.border}`, background: c.bg, color: c.text,
      letterSpacing: '0.03em', textTransform: 'uppercase', fontFamily: 'inherit',
      whiteSpace: 'nowrap',
    }
  },
    React.createElement('span', { style: { width: 5, height: 5, borderRadius: '50%', background: c.dot, flexShrink: 0 } }),
    level
  );
}

function StatusBadge({ status, label }) {
  const c = STATUS[status] || STATUS.info;
  return React.createElement('span', {
    style: {
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 8px', borderRadius: 4, fontSize: 11, fontWeight: 500,
      border: `1px solid ${c.border}`, background: c.bg, color: c.text,
      fontFamily: 'inherit',
    }
  },
    React.createElement('span', { style: { width: 6, height: 6, borderRadius: '50%', background: c.dot, flexShrink: 0 } }),
    label
  );
}

function Btn({ children, variant = 'secondary', size = 'md', onClick, disabled, style: extraStyle }) {
  const [hovered, setHovered] = React.useState(false);
  const base = {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: size === 'sm' ? '0 10px' : '0 12px',
    height: size === 'sm' ? 28 : 32,
    fontSize: size === 'sm' ? 12 : 13, fontWeight: 500,
    borderRadius: 4, border: '1px solid transparent',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: 'inherit', opacity: disabled ? 0.45 : 1,
    transition: 'background 100ms, border-color 100ms, color 100ms',
    whiteSpace: 'nowrap',
  };
  const variants = {
    primary:   { background: hovered ? COLORS.accentHover : COLORS.accent, color: '#fff', borderColor: hovered ? COLORS.accentHover : COLORS.accent },
    secondary: { background: hovered ? COLORS.surfaceHover : 'transparent', color: COLORS.textPrimary, borderColor: COLORS.borderDefault },
    ghost:     { background: hovered ? COLORS.surfaceHover : 'transparent', color: hovered ? COLORS.textPrimary : COLORS.textSecondary, borderColor: 'transparent' },
    danger:    { background: hovered ? 'rgba(239,68,68,0.18)' : 'transparent', color: '#fca5a5', borderColor: 'rgba(239,68,68,0.28)' },
    link:      { background: 'transparent', color: COLORS.accentText, borderColor: 'transparent', textDecoration: 'underline', textUnderlineOffset: 2, padding: '0 4px' },
  };
  return React.createElement('button', {
    style: { ...base, ...variants[variant], ...extraStyle },
    onClick, disabled,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
  }, children);
}

function IconBtn({ children, onClick, title, active }) {
  const [hovered, setHovered] = React.useState(false);
  return React.createElement('button', {
    title, onClick,
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    style: {
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 28, height: 28, borderRadius: 4,
      border: `1px solid ${active ? COLORS.accentBorder : COLORS.borderDefault}`,
      background: active ? COLORS.accentSubtle : (hovered ? COLORS.surfaceHover : 'transparent'),
      color: active ? COLORS.accentText : (hovered ? COLORS.textPrimary : COLORS.textMuted),
      cursor: 'pointer', transition: 'all 100ms',
    }
  }, children);
}

function Input({ value, onChange, placeholder, prefix, style: extraStyle }) {
  const [focused, setFocused] = React.useState(false);
  return React.createElement('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: 6,
      height: 32, padding: '0 10px',
      background: COLORS.bgRaised,
      border: `1px solid ${focused ? COLORS.accent : COLORS.borderDefault}`,
      borderRadius: 4,
      boxShadow: focused ? `0 0 0 2px ${COLORS.bgBase}, 0 0 0 4px ${COLORS.accent}` : 'none',
      transition: 'border-color 100ms, box-shadow 100ms',
      ...extraStyle,
    }
  },
    prefix,
    React.createElement('input', {
      value, onChange: e => onChange && onChange(e.target.value),
      placeholder,
      onFocus: () => setFocused(true),
      onBlur: () => setFocused(false),
      style: {
        flex: 1, background: 'transparent', border: 'none', outline: 'none',
        fontSize: 13, color: COLORS.textPrimary, fontFamily: 'inherit',
        minWidth: 0,
        '::placeholder': { color: COLORS.textMuted },
      }
    })
  );
}

function Divider({ vertical, style: s }) {
  return React.createElement('div', {
    style: vertical
      ? { width: 1, background: COLORS.borderSubtle, alignSelf: 'stretch', flexShrink: 0, ...s }
      : { height: 1, background: COLORS.borderSubtle, ...s }
  });
}

function Avatar({ name, size = 24 }) {
  const initials = name ? name.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase() : '?';
  return React.createElement('div', {
    style: {
      width: size, height: size, borderRadius: '50%',
      background: COLORS.bgOverlay, border: `1px solid ${COLORS.borderDefault}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: size * 0.38, fontWeight: 600, color: COLORS.textSecondary,
      flexShrink: 0,
    }
  }, initials);
}

function Skeleton({ width, height = 12, style: s }) {
  return React.createElement('div', {
    style: {
      width, height, borderRadius: 3,
      background: `linear-gradient(90deg, ${COLORS.bgRaised} 25%, ${COLORS.bgOverlay} 50%, ${COLORS.bgRaised} 75%)`,
      backgroundSize: '200% 100%',
      animation: 'shimmer 1.4s infinite',
      ...s,
    }
  });
}

// SVG icon helpers
function Icon({ d, size = 14, strokeWidth = 1.5, color = 'currentColor', viewBox = '0 0 24 24' }) {
  return React.createElement('svg', {
    width: size, height: size, viewBox,
    fill: 'none', stroke: color, strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
    style: { display: 'block', flexShrink: 0 },
  }, React.createElement('path', { d }));
}

// Preset icons
const Icons = {
  Search: ({ size = 14 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 11, cy: 11, r: 8 }),
    React.createElement('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 })
  ),
  X: ({ size = 14 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
    React.createElement('line', { x1: 6, y1: 6, x2: 18, y2: 18 })
  ),
  ChevronRight: ({ size = 12 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('polyline', { points: '9 18 15 12 9 6' })
  ),
  ChevronDown: ({ size = 12 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('polyline', { points: '6 9 12 15 18 9' })
  ),
  Copy: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2 }),
    React.createElement('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' })
  ),
  Settings: ({ size = 14 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 12, cy: 12, r: 3 }),
    React.createElement('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' })
  ),
  Bell: ({ size = 14 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9' }),
    React.createElement('path', { d: 'M13.73 21a2 2 0 0 1-3.46 0' })
  ),
  File: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }),
    React.createElement('polyline', { points: '14 2 14 8 20 8' })
  ),
  Plus: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
    React.createElement('line', { x1: 5, y1: 12, x2: 19, y2: 12 })
  ),
  ExternalLink: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
    React.createElement('polyline', { points: '15 3 21 3 21 9' }),
    React.createElement('line', { x1: 10, y1: 14, x2: 21, y2: 3 })
  ),
  MoreHorizontal: ({ size = 14 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 5, cy: 12, r: 1, fill: 'currentColor' }),
    React.createElement('circle', { cx: 12, cy: 12, r: 1, fill: 'currentColor' }),
    React.createElement('circle', { cx: 19, cy: 12, r: 1, fill: 'currentColor' })
  ),
  Clock: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('circle', { cx: 12, cy: 12, r: 10 }),
    React.createElement('polyline', { points: '12 6 12 12 16 14' })
  ),
  Filter: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('polygon', { points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' })
  ),
  Key: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'm21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4' })
  ),
  Users: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('path', { d: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2' }),
    React.createElement('circle', { cx: 9, cy: 7, r: 4 }),
    React.createElement('path', { d: 'M23 21v-2a4 4 0 0 0-3-3.87' }),
    React.createElement('path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' })
  ),
  BarChart: ({ size = 13 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', style: { display: 'block', flexShrink: 0 } },
    React.createElement('line', { x1: 18, y1: 20, x2: 18, y2: 10 }),
    React.createElement('line', { x1: 12, y1: 20, x2: 12, y2: 4 }),
    React.createElement('line', { x1: 6, y1: 20, x2: 6, y2: 14 }),
    React.createElement('line', { x1: 2, y1: 20, x2: 22, y2: 20 })
  ),
};

// Inject keyframe for skeleton
const shimmerStyle = document.createElement('style');
shimmerStyle.textContent = `
  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  * { box-sizing: border-box; }
  input::placeholder { color: #4d4d5c; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #26262d; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #3a3a45; }
`;
document.head.appendChild(shimmerStyle);

// Export all to window
Object.assign(window, {
  COLORS, LEVEL, STATUS,
  LevelBadge, StatusBadge, Btn, IconBtn, Input, Divider, Avatar, Skeleton, Icon, Icons,
});
