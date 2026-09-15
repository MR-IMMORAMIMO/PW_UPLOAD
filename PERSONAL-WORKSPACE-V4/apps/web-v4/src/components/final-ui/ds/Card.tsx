import { C, SHADOW, RADIUS } from '../tokens';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  radius?: number;
  shadow?: string;
  children: React.ReactNode;
}

export default function Card({
  radius = RADIUS.section,
  shadow = SHADOW.card,
  style,
  className = '',
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={className}
      style={{
        background: C.white,
        borderRadius: radius,
        border: `1px solid ${C.border}`,
        boxShadow: shadow,
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
