import { C, SHADOW, RADIUS } from '../tokens';

interface KpiCardProps {
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  label: string;
  value: string | number;
  sub?: string;
  onClick?: () => void;
  delay?: number;
  className?: string;
}

export default function KpiCard({
  icon,
  iconBg,
  iconColor,
  label,
  value,
  sub,
  onClick,
  delay = 0,
  className = '',
}: KpiCardProps) {
  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(event) => {
        if (onClick && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onClick();
        }
      }}
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:shadow-md transition-shadow ${className}`}
      style={{
        background: C.white,
        borderRadius: RADIUS.section,
        border: `1px solid ${C.border}`,
        boxShadow: SHADOW.card,
        animationDelay: `${delay}ms`,
      }}
    >
      <div
        className="flex items-center justify-center shrink-0"
        style={{
          width: 40,
          height: 40,
          borderRadius: RADIUS.icon,
          background: iconBg,
          color: iconColor,
        }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] font-medium truncate" style={{ color: C.textMuted }}>
          {label}
        </div>
        <div className="text-[22px] font-bold leading-tight" style={{ color: C.text }}>
          {value}
        </div>
        {sub && (
          <div className="text-[10px]" style={{ color: C.textMuted }}>
            {sub}
          </div>
        )}
      </div>
    </div>
  );
}
