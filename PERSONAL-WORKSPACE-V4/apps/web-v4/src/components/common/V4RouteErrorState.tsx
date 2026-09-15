import { SctWarning as AlertTriangle } from './SctIcons';
import { RefreshCw } from './SctIcons';
import { V4Button } from './V4Button';
import { V4StatePanel } from './V4StatePanel';

export interface V4RouteErrorStateProps {
  title: string;
  message: string;
  retrying?: boolean;
  onRetry: () => void;
}

/** Shared recoverable initial-load error grammar used below the preserved page heading. */
export function V4RouteErrorState({
  title,
  message,
  retrying = false,
  onRetry,
}: V4RouteErrorStateProps) {
  return (
    <V4StatePanel
      icon={AlertTriangle}
      tone="error"
      title={title}
      message={message}
      action={
        <V4Button
          variant="secondary"
          size="compact"
          leadingIcon={<RefreshCw aria-hidden="true" />}
          disabled={retrying}
          aria-busy={retrying || undefined}
          onClick={onRetry}
        >
          Retry
        </V4Button>
      }
    />
  );
}
