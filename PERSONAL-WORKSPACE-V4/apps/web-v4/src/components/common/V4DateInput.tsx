import { forwardRef, type InputHTMLAttributes } from 'react';
import { formatBusinessDateOnly } from '../../date-time/businessDateTime';
import './V4DateInput.css';

/** Keep native calendar/keyboard behavior and ISO storage while displaying an unambiguous date. */
export const V4DateInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function V4DateInput({ value, style, className, ...props }, ref) {
    const key = typeof value === 'string' ? value : '';
    return (
      <span className="v4-date-input">
        <input
          {...props}
          type="date"
          ref={ref}
          value={value}
          className={className}
          style={{ ...style, color: 'transparent', WebkitTextFillColor: 'transparent' }}
        />
        <span
          aria-hidden="true"
          className="v4-date-input__display"
          data-display-date={formatBusinessDateOnly(key) || 'Choose date'}
        />
      </span>
    );
  },
);
