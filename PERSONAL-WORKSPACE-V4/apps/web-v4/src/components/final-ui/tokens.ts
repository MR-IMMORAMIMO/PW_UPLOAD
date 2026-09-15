// ── Colours ──────────────────────────────────────────────────────────────────

export const C = {
  // Brand
  teal: 'var(--v4-action-primary)',
  tealLight: 'var(--v4-accent-soft)',
  tealBorder: 'var(--v4-accent)',

  // Page / layout
  pageBg: 'var(--v4-surface-base)',
  white: 'var(--v4-surface-raised)',
  cardBg: 'var(--v4-surface-subtle)',
  lightBg: 'var(--v4-surface-muted)',
  modalBg: 'var(--v4-surface-floating)',
  tableHeader: 'var(--v4-surface-subtle)',
  selectedRow: 'var(--v4-accent-selected)',

  // Borders
  border: 'var(--v4-border-subtle)',
  borderLight: 'var(--v4-border-subtle)',
  formBorder: 'var(--v4-border-control)',

  // Text — light theme
  text: 'var(--v4-text-primary)',
  textStrong: 'var(--v4-text-primary)',
  textDark: 'var(--v4-text-secondary)',
  textMedium: 'var(--v4-text-secondary)',
  textSub: 'var(--v4-text-muted)',
  textLabel: 'var(--v4-text-secondary)',
  textMid: 'var(--v4-text-muted)',
  textMuted: 'var(--v4-text-disabled)',
  textFaint: 'var(--v4-text-disabled)',
  inputText: 'var(--v4-text-primary)',

  // Semantic
  green: '#22c55e',
  greenRunning: '#16a34a',
  red: '#ef4444',
  redBorder: '#fca5a5',
  orange: '#f97316',
  orangeAlt: '#ea580c',
  blue: '#3b82f6',
  blueAlt: '#2563eb',
  indigo: '#6366f1',
  indigoAlt: '#4338ca',
  purple: '#7c3aed',
  yellow: '#ca8a04',

  // Tint backgrounds
  redLight: '#fee2e2',
  redBorderTint: '#fecaca',
  orangeLight: '#fff7ed',
  orangeLight2: '#ffedd5',
  orangeBorder: '#fed7aa',
  yellowLight: '#fef9c3',
  yellowBorder: '#fde047',
  blueLight: '#dbeafe',
  blueBorder: '#bfdbfe',
  indigoLight: '#e0e7ff',
  indigoBorder: '#c7d2fe',
  purpleLight: '#f5f3ff',
  purpleBorder: '#ddd6fe',
  neutralLight: 'var(--v4-surface-muted)',
  neutralBorder: 'var(--v4-border-control)',
  greenLight: '#dcfce7',
  greenBorder: '#bbf7d0',

  // Dashboard KPI icon backgrounds — deliberate tinted solids for icon contrast
  kpiTeal: 'rgb(66,152,152)',
  kpiOrange: 'rgba(192,90,31,0.93)',
  kpiPurple: 'rgba(91,45,158,0.89)',
  kpiBlue: 'rgba(29,78,216,0.85)',

  // Extended palette — additional shades used in project & workflow statuses
  amber: '#f59e0b', // amber-400  — warnings, stars, revision dots
  amberLight: '#fffbeb', // amber-50   — Revision Required bg
  amberBorder: '#fde68a', // amber-200
  amberDark: '#92400e', // amber-800  — Revision Required text
  violet: '#8b5cf6', // violet-500 — Client Review dot
  violetLight: '#f5f3ff', // violet-50  — Client Review bg (= purpleLight)
  violetDark: '#6d28d9', // violet-700 — Client Review text
  blueDeep: '#1d4ed8', // blue-700   — In Progress text
  greenMid: '#10b981', // green-500  — Completed dot
  greenMidLight: '#ecfdf5', // green-50   — Completed bg
  greenDeep: '#065f46', // green-900  — Completed text
};

// ── Status system ─────────────────────────────────────────────────────────────
// Unified semantic status colors used for badges, chips, and highlights

export const STATUS = {
  success: { bg: C.greenLight, border: C.greenBorder, text: C.greenRunning },
  warning: { bg: C.yellowLight, border: C.yellowBorder, text: C.yellow },
  danger: { bg: C.redLight, border: C.redBorderTint, text: C.red },
  info: { bg: C.blueLight, border: C.blueBorder, text: C.blueAlt },
  orange: { bg: C.orangeLight, border: C.orangeBorder, text: C.orangeAlt },
  purple: { bg: C.purpleLight, border: C.purpleBorder, text: C.purple },
  neutral: { bg: C.neutralLight, border: C.neutralBorder, text: C.textMid },
  mapped: { bg: C.blueLight, border: C.blueBorder, text: C.blueAlt },
  // Project workflow statuses
  inProgress: { bg: C.blueLight, border: C.blueBorder, text: C.blueDeep },
  review: { bg: C.violetLight, border: C.purpleBorder, text: C.violetDark },
  revision: { bg: C.amberLight, border: C.amberBorder, text: C.amberDark },
  onHold: { bg: C.cardBg, border: C.neutralBorder, text: C.textMedium },
  completed: { bg: C.greenMidLight, border: C.greenBorder, text: C.greenDeep },
};

// ── Radius (px) ───────────────────────────────────────────────────────────────
// All components should reference these — do not use ad-hoc values

export const RADIUS = {
  control: 8, // inputs, buttons, small controls  (Tailwind: rounded-lg)
  card: 12, // cards, panels                    (Tailwind: rounded-xl)
  section: 14, // large page-level cards
  icon: 26, // icon containers (rounded circle-ish for KPI icons)
  modal: 20, // modals, drawers
  full: 9999, // pills, badges
};

// ── Gaps / spacing (px) ──────────────────────────────────────────────────────

export const GAP = {
  xs: 4,
  sm: 6,
  base: 8,
  md: 10,
  lg: 12,
  xl: 16,
  xxl: 20,
  xxxl: 24,
};

// ── Layout layout aliases ─────────────────────────────────────────────────────

export const LAYOUT = {
  pagePadding: 16, // px-4 horizontal padding on page body
  sectionGap: 15, // gap between cards/sections (the "15px system")
  cardGap: 12, // gap within card groups
  toolbarGap: 8, // gap between toolbar items
};

// ── Shadows ──────────────────────────────────────────────────────────────────

export const SHADOW = {
  card: '0 1px 3px rgba(0,0,0,0.06)',
  popover: '0 8px 24px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)',
  tooltip: '0 4px 12px rgba(0,0,0,0.15)',
  overlay: '0 24px 48px rgba(0,0,0,0.20)',
  modal: '0 28px 80px rgba(0,0,0,0.2), 0 4px 16px rgba(0,0,0,0.08)',
  newProj: '0 32px 80px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.08)',
};

// ── Motion ────────────────────────────────────────────────────────────────────

export const MOTION = {
  fast: '140ms',
  standard: '240ms',
  medium: '320ms',
  slow: '480ms',
  ease: 'cubic-bezier(0.16,1,0.3,1)',
  easeIn: 'ease-in',
  easeOut: 'ease-out',
};

// ── Icon standard sizes (px) ─────────────────────────────────────────────────
// strokeStd is the standard stroke width for outline icons

export const ICON = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  kpi: 26,
  strokeStd: 1.5,
  strokeMd: 1.6,
  strokeHvy: 2.0,
};

// ── Typography (font-size px) ─────────────────────────────────────────────────

export const TYPE = {
  pageTitle: 20,
  sectionTitle: 16,
  body: 13,
  bodyStrong: 13,
  table: 12,
  label: 11,
  caption: 10,
  tiny: 9,
};

// ── Border ────────────────────────────────────────────────────────────────────

export const BORDER = {
  width: 1,
  color: C.border,
  colorLight: C.borderLight,
  colorForm: C.formBorder,
  colorFocus: C.teal,
};

// ── Dimensions (px) ──────────────────────────────────────────────────────────

export const DIM = {
  sidebarWidth: 290,
  workSessionWidth: 366,
  rowHeight: 62,
  bannerHeight: 52,
  sectionRadius: 14, // kept for backward compat — prefer RADIUS.section
  cardRadius: 12, // kept for backward compat — prefer RADIUS.card
  modalRadius: 20, // kept for backward compat — prefer RADIUS.modal
};
