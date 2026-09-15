import * as FinalGlyphs from '../../common/SctIcons';
import { C, RADIUS, MOTION } from '../tokens';

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon';
type BtnSize = 'sm' | 'md' | 'lg';

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  loading?: boolean;
  children?: React.ReactNode;
}

const VAR_STYLES: Record<BtnVariant, React.CSSProperties> = {
  primary: { background: C.teal, color: '#fff', border: 'none' },
  secondary: { background: C.white, color: C.textDark, border: `1px solid ${C.border}` },
  ghost: { background: 'transparent', color: C.textMid, border: 'none' },
  danger: { background: C.red, color: '#fff', border: 'none' },
  icon: { background: 'transparent', color: C.textMuted, border: 'none', padding: 4 },
};

const SIZE_STYLES: Record<BtnSize, React.CSSProperties> = {
  sm: { fontSize: 11, padding: '4px 10px', borderRadius: RADIUS.control },
  md: { fontSize: 12, padding: '6px 14px', borderRadius: RADIUS.control },
  lg: { fontSize: 13, padding: '8px 18px', borderRadius: RADIUS.control },
};

export default function Btn({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading,
  children,
  style,
  className = '',
  ...rest
}: BtnProps) {
  const disabled = Boolean(rest.disabled || loading);
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: `opacity ${MOTION.fast}, background ${MOTION.fast}`,
    outline: 'none',
    whiteSpace: 'nowrap',
    ...VAR_STYLES[variant],
    ...SIZE_STYLES[size],
    ...style,
  };

  return (
    <button
      type="button"
      className={`hover:opacity-90 active:scale-95 ${className}`}
      style={base}
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
    >
      {loading ? <FinalGlyphs.SctLoading className="animate-spin" width="14" height="14" /> : icon}
      {children}
      {iconRight}
    </button>
  );
}
