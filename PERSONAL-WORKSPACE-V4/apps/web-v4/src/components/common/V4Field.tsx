import type { ReactNode } from 'react';

export interface V4FieldProps {
  label: string;
  children: ReactNode;
  controlId?: string;
  required?: boolean;
  helpText?: ReactNode;
  errorText?: ReactNode;
  readOnly?: boolean;
  disabled?: boolean;
  className?: string;
}

/** Visual field wrapper only; validation and business rules remain caller-owned. */
export function V4Field({
  label,
  children,
  controlId,
  required = false,
  helpText,
  errorText,
  readOnly = false,
  disabled = false,
  className,
}: V4FieldProps) {
  return (
    <div
      className={`v4-field${className ? ` ${className}` : ''}`}
      data-read-only={readOnly || undefined}
      data-disabled={disabled || undefined}
      data-invalid={Boolean(errorText) || undefined}
    >
      <label className="v4-field__label" htmlFor={controlId}>
        {label}
        {required ? <span className="v4-field__required">Required</span> : null}
      </label>
      <div className="v4-field__control">{children}</div>
      {errorText ? (
        <div className="v4-field__message v4-field__message--error" role="alert">
          {errorText}
        </div>
      ) : helpText ? (
        <div className="v4-field__message">{helpText}</div>
      ) : null}
    </div>
  );
}
