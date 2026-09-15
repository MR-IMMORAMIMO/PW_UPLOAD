/**
 * V4 Foundation diagnostic screen.
 *
 * Deliberately NON-PRODUCT. It proves the clean renderer foundation is wired:
 * renderer, router, query, API connectivity, and theme. It is NOT a Dashboard
 * and contains no project cards, KPIs, sidebar, tables, inspectors, or drawers.
 */
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/environment';
import { useV4Theme } from '../theme/ThemeProvider';

export function FoundationScreen() {
  const { preference, resolved, reducedMotion, setPreference } = useV4Theme();

  const projectsQuery = useQuery({
    queryKey: ['v4', 'foundation', 'projects'],
    queryFn: () => api.projects(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const apiState = projectsQuery.isLoading
    ? 'Loading'
    : projectsQuery.isError
      ? 'Unavailable'
      : 'Connected';

  return (
    <main className="v4-foundation" data-testid="v4-foundation">
      <h1 className="v4-foundation__title">Personal Workspace V4</h1>
      <p className="v4-foundation__subtitle">Clean Renderer Foundation</p>

      <dl className="v4-foundation__status">
        <div className="v4-foundation__row">
          <dt>Renderer</dt>
          <dd>Ready</dd>
        </div>
        <div className="v4-foundation__row">
          <dt>Router</dt>
          <dd>Ready</dd>
        </div>
        <div className="v4-foundation__row">
          <dt>Query</dt>
          <dd>Ready</dd>
        </div>
        <div className="v4-foundation__row">
          <dt>API</dt>
          <dd data-testid="v4-api-state">{apiState}</dd>
        </div>
        <div className="v4-foundation__row">
          <dt>Theme</dt>
          <dd data-testid="v4-theme-resolved">{resolved}</dd>
        </div>
        <div className="v4-foundation__row">
          <dt>Reduced motion</dt>
          <dd data-testid="v4-reduced-motion">{reducedMotion ? 'On' : 'Off'}</dd>
        </div>
      </dl>

      <div className="v4-foundation__theme" role="group" aria-label="Theme preference">
        <span className="v4-foundation__theme-label">Theme</span>
        {(['system', 'light', 'dark'] as const).map((option) => (
          <button
            key={option}
            type="button"
            className="v4-foundation__theme-option"
            aria-pressed={preference === option}
            onClick={() => setPreference(option)}
          >
            {option}
          </button>
        ))}
      </div>

      {projectsQuery.isError ? (
        <p className="v4-foundation__error" role="alert">
          The canonical API is unavailable. The renderer remains functional.
        </p>
      ) : null}
    </main>
  );
}
