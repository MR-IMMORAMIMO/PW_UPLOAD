import { useId } from 'react';

export function CommercialValueFields({
  amount,
  currency,
  error,
  disabled = false,
  onAmountChange,
  onCurrencyChange,
  onClear,
}: {
  amount: string;
  currency: string;
  error?: string | undefined;
  disabled?: boolean;
  onAmountChange: (value: string) => void;
  onCurrencyChange: (value: string) => void;
  onClear: () => void;
}) {
  const errorId = useId();
  const hasInput = Boolean(amount.trim() || currency.trim());

  return (
    <div className="field field-wide">
      <span>
        Commercial Value <small>Optional</small>
      </span>
      <div className="form-grid">
        <label className="field">
          Amount
          <input
            aria-label="Commercial Value Amount"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            autoComplete="off"
            disabled={disabled}
            inputMode="decimal"
            maxLength={32}
            placeholder="e.g. 125000.50"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
          />
        </label>
        <label className="field">
          Currency
          <input
            aria-label="Commercial Value Currency"
            aria-describedby={error ? errorId : undefined}
            aria-invalid={Boolean(error)}
            autoCapitalize="characters"
            autoComplete="off"
            disabled={disabled}
            inputMode="text"
            maxLength={3}
            placeholder="AED"
            value={currency}
            onChange={(event) => onCurrencyChange(event.target.value.toUpperCase())}
          />
        </label>
      </div>
      <small>Project-level context only. BOQ and luminaire data remain non-priced.</small>
      {error ? (
        <small className="field-error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
      {hasInput ? (
        <button className="inline-text-button" type="button" disabled={disabled} onClick={onClear}>
          Clear commercial value
        </button>
      ) : null}
    </div>
  );
}
