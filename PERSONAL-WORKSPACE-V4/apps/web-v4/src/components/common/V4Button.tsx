import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type V4ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger' | 'icon';
export type V4ButtonSize = 'compact' | 'standard';

export interface V4ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: V4ButtonVariant;
  size?: V4ButtonSize;
  leadingIcon?: ReactNode;
}

/** Shared visual button. Callers retain action semantics and pending behavior. */
export const V4Button = forwardRef<HTMLButtonElement, V4ButtonProps>(function V4Button(
  {
    variant = 'secondary',
    size = 'standard',
    leadingIcon,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`v4-button v4-button--${variant} v4-button--${size}${className ? ` ${className}` : ''}`}
      {...props}
    >
      {leadingIcon ? <span className="v4-button__icon">{leadingIcon}</span> : null}
      {children}
    </button>
  );
});
