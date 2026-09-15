import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../../api/environment';
import { V4Drawer } from '../common/V4Drawer';
import { V4Button } from '../common/V4Button';
import { SctSearch } from '../common/SctIcons';

export function WorkspaceSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [query]);
  const results = useQuery({
    queryKey: ['v4', 'workspace-search', debounced],
    queryFn: () => api.workspaceSearch(debounced),
    enabled: debounced.length >= 2,
  });
  const destinations = {
    Project: 'summary',
    Action: 'actions',
    Review: 'comments',
    Meeting: 'meetings',
    Document: 'files',
    Luminaire: 'luminaires',
  } as const;
  return (
    <V4Drawer
      open
      presentation="float"
      className="v4-workspace-search"
      title="Search workspace"
      initialFocusRef={input}
      onClose={onClose}
    >
      <label className="v4-workspace-search__input">
        <SctSearch size={20} />
        <input
          ref={input}
          aria-label="Search workspace"
          maxLength={200}
          placeholder="Projects, luminaires, actions, meetings and documents"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <div aria-live="polite">
        {query.trim().length < 2 ? (
          <p>Enter at least 2 characters: a name, project code or keyword.</p>
        ) : query.trim() !== debounced || results.isFetching ? (
          <p>Searching…</p>
        ) : results.isError ? (
          <p role="alert">
            Search could not load. <V4Button onClick={() => void results.refetch()}>Retry</V4Button>
          </p>
        ) : !results.data?.length ? (
          <p>No results for “{query.trim()}”. Try another keyword.</p>
        ) : (
          <ul className="v4-workspace-search__results">
            {results.data.map((item) => (
              <li key={`${item.type}-${item.id}`}>
                <Link
                  to={`/projects/${encodeURIComponent(item.projectId)}/${destinations[item.type]}${item.type === 'Project' ? '' : `?${{ Action: 'actionId', Meeting: 'meetingId', Document: 'documentId', Review: 'threadId', Luminaire: 'luminaireId' }[item.type]}=${encodeURIComponent(item.id)}`}`}
                  onClick={onClose}
                >
                  <span>{item.type}</span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </V4Drawer>
  );
}
