import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarDays,
  ClipboardCheck,
  FileText,
  FolderKanban,
  Lightbulb,
  MessageSquareText,
  Search,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import type { WorkspaceSearchResult } from '@scli/domain';
import { api } from '../api';
import { EmptyState, ErrorState, LoadingState, PageHeader, formatDate } from '../components/ui';

const resultIcons: Record<WorkspaceSearchResult['type'], typeof Search> = {
  Project: FolderKanban,
  Action: ClipboardCheck,
  Review: MessageSquareText,
  Meeting: CalendarDays,
  Document: FileText,
  Luminaire: Lightbulb,
};

export function PersonalSearchScreen() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const [value, setValue] = useState(query);
  const resultsQuery = useQuery({
    queryKey: ['workspace-search', query],
    queryFn: () => api.workspaceSearch(query),
    enabled: query.trim().length >= 2,
  });
  return (
    <>
      <PageHeader
        eyebrow="Whole workspace"
        title="Search"
        description="Find projects, actions, comments, meetings and registered files."
      />
      <form
        className="workspace-search-hero"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.trim().length >= 2) setParams({ q: value.trim() });
        }}
      >
        <Search />
        <input
          aria-label="Search the workspace"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Search project code, client, action, comment, meeting or file…"
        />
        <button className="button primary" disabled={value.trim().length < 2}>
          Search
        </button>
      </form>
      {resultsQuery.isLoading ? <LoadingState label="Searching your local workspace…" /> : null}
      {resultsQuery.error ? <ErrorState message={(resultsQuery.error as Error).message} /> : null}
      {resultsQuery.data ? (
        <section className="content-card search-results-card">
          <div className="search-results-heading">
            <strong>{resultsQuery.data.length} result(s)</strong>
            <span>for “{query}”</span>
          </div>
          <div className="workspace-search-results">
            {resultsQuery.data.map((result) => {
              const Icon = resultIcons[result.type];
              return (
                <Link
                  to={`/projects/${result.projectId}`}
                  key={`${result.type}-${result.id}`}
                  title={`${result.title} — ${result.detail}`}
                >
                  <span className={`search-result-icon result-${result.type.toLowerCase()}`}>
                    <Icon />
                  </span>
                  <span>
                    <small>{result.type}</small>
                    <strong>{result.title}</strong>
                    <p>{result.detail}</p>
                  </span>
                  <time>{formatDate(result.date, { month: 'short', day: 'numeric' })}</time>
                </Link>
              );
            })}
          </div>
          {!resultsQuery.data.length ? (
            <EmptyState
              title="Nothing found"
              description="Try a project code, client name, luminaire-related comment, meeting title or file name."
            />
          ) : null}
        </section>
      ) : query.trim().length < 2 ? (
        <EmptyState
          title="Search the complete workspace"
          description="Enter at least two characters to search all local project records."
        />
      ) : null}
    </>
  );
}
