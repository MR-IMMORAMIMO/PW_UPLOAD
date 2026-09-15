import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  CircleAlert,
  FileSearch,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import type {
  DatasheetComparisonField,
  LocalIntelligenceFieldKey,
  LuminaireDatasheetAnalysis,
  LuminaireRecord,
  Project,
  ProjectQualityCheck,
  ProjectWorkspace,
} from '@scli/domain';
import type { LuminaireRecordInput } from '@scli/contracts';
import { api } from '../api';
import { useToast } from './toast';
import { ErrorState, LoadingState } from './ui';

interface LocalIntelligenceCenterProps {
  project: Project;
  workspace: ProjectWorkspace;
}

function recordInput(record: LuminaireRecord): LuminaireRecordInput {
  return {
    tag: record.tag,
    category: record.category,
    imagePath: record.imagePath,
    description: record.description,
    manufacturer: record.manufacturer,
    model: record.model,
    wattage: record.wattage,
    lumens: record.lumens,
    lightColor: record.lightColor,
    cri: record.cri,
    beamAngle: record.beamAngle,
    ipRating: record.ipRating,
    mounting: record.mounting,
    cutout: record.cutout,
    driver: record.driver,
    control: record.control,
    emergency: record.emergency,
    datasheetPath: record.datasheetPath,
    location: record.location,
    unit: record.unit,
    quantity: record.quantity,
    notes: record.notes,
    sourceName: record.sourceName,
    dimensions: record.dimensions,
    bodyColorFinish: record.bodyColorFinish,
  };
}

function comparisonClass(status: DatasheetComparisonField['status']): string {
  return status.replaceAll(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function checkIcon(item: ProjectQualityCheck) {
  return item.passed ? <Check size={16} /> : <CircleAlert size={16} />;
}

function defaultSelections(analyses: LuminaireDatasheetAnalysis[]): Record<string, string[]> {
  return Object.fromEntries(
    analyses.map((analysis) => [
      analysis.luminaireId,
      analysis.comparisons
        .filter(
          (field) =>
            field.status === 'MissingSchedule' &&
            !field.ambiguous &&
            field.confidence >= 75 &&
            field.value,
        )
        .map((field) => field.fieldKey),
    ]),
  );
}

export function LocalIntelligenceCenter({ project, workspace }: LocalIntelligenceCenterProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const [analyses, setAnalyses] = useState<LuminaireDatasheetAnalysis[]>([]);
  const [selectedFields, setSelectedFields] = useState<Record<string, string[]>>({});
  const overviewQuery = useQuery({
    queryKey: ['local-intelligence', project.id],
    queryFn: () => api.localIntelligence(project.id),
  });
  const analyzeMutation = useMutation({
    mutationFn: () => api.analyzeProjectDatasheets(project.id),
    onSuccess: (results) => {
      const completed = results.items.flatMap((item) => (item.analysis ? [item.analysis] : []));
      setAnalyses(completed);
      setSelectedFields(defaultSelections(completed));
      showToast(
        completed.length
          ? `${completed.length} linked datasheet(s) analyzed locally; ${results.summary.needsAdoption} need adoption and ${results.summary.failed} failed.`
          : 'No linked PDF datasheets are available yet.',
      );
    },
  });
  const applyMutation = useMutation({
    mutationFn: async ({
      record,
      analysis,
      fields,
    }: {
      record: LuminaireRecord;
      analysis: LuminaireDatasheetAnalysis;
      fields: LocalIntelligenceFieldKey[];
    }) => {
      const input = recordInput(record);
      for (const fieldKey of fields) {
        const comparison = analysis.comparisons.find((item) => item.fieldKey === fieldKey);
        if (comparison?.value && !comparison.ambiguous) input[fieldKey] = comparison.value;
      }
      await api.updateLuminaire(project.id, record.id, input);
      return api.analyzeLuminaireDatasheet(project.id, record.id);
    },
    onSuccess: async (updated) => {
      setAnalyses((current) =>
        current.map((analysis) =>
          analysis.luminaireId === updated.luminaireId ? updated : analysis,
        ),
      );
      setSelectedFields((current) => ({ ...current, [updated.luminaireId]: [] }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['project-workspace', project.id] }),
        overviewQuery.refetch(),
      ]);
      showToast(`${updated.tag} updated after your approval.`);
    },
  });

  const analysisTotals = useMemo(
    () =>
      analyses.reduce(
        (totals, analysis) => ({
          matched: totals.matched + analysis.counts.Matched,
          mismatches: totals.mismatches + analysis.counts.Mismatch,
          missing: totals.missing + analysis.counts.MissingSchedule,
          review: totals.review + analysis.counts.NeedsReview,
        }),
        { matched: 0, mismatches: 0, missing: 0, review: 0 },
      ),
    [analyses],
  );

  if (overviewQuery.isLoading) return <LoadingState label="Running local project checks…" />;
  if (overviewQuery.error || !overviewQuery.data) {
    return (
      <ErrorState
        message={overviewQuery.error?.message ?? 'The local project check could not be completed.'}
        onRetry={() => void overviewQuery.refetch()}
      />
    );
  }

  const overview = overviewQuery.data;
  const filesForReview = overview.fileClassifications
    .filter((item) => item.changed || item.confidence < 70)
    .slice(0, 12);
  const linkedCount = workspace.luminaires.filter((item) => item.datasheetPath.trim()).length;

  const toggleField = (luminaireId: string, fieldKey: string) => {
    setSelectedFields((current) => {
      const existing = current[luminaireId] ?? [];
      return {
        ...current,
        [luminaireId]: existing.includes(fieldKey)
          ? existing.filter((item) => item !== fieldKey)
          : [...existing, fieldKey],
      };
    });
  };

  return (
    <section className="local-intelligence-center" aria-labelledby="local-intelligence-title">
      <header className="local-intelligence-hero">
        <div className="local-intelligence-title">
          <span className="local-intelligence-icon" aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <div>
            <span className="eyebrow">Private project intelligence</span>
            <h2 id="local-intelligence-title">AI Check</h2>
            <p>Datasheet comparison, missing-information checks and file classification.</p>
          </div>
        </div>
        <div className="local-privacy-badge" title="No file or project data leaves this device">
          <ShieldCheck size={16} /> 100% Local · Free
        </div>
      </header>

      <div className="local-intelligence-metrics">
        <article className="local-readiness-score">
          <span>Issue readiness</span>
          <strong>{overview.readinessScore}%</strong>
          <div className="local-score-track" aria-label={`${overview.readinessScore}% issue ready`}>
            <span style={{ width: `${overview.readinessScore}%` }} />
          </div>
        </article>
        <article>
          <span>Luminaires</span>
          <strong>{overview.stats.luminaireCount}</strong>
          <small>{overview.stats.linkedDatasheets} linked datasheets</small>
        </article>
        <article>
          <span>Missing datasheets</span>
          <strong>{overview.stats.missingDatasheets}</strong>
          <small>No automatic brand recommendations</small>
        </article>
        <article>
          <span>Indexed files</span>
          <strong>{overview.stats.indexedFiles}</strong>
          <small>{overview.stats.classificationsNeedingReview} need review</small>
        </article>
      </div>

      <div className="local-intelligence-grid">
        <article className="local-brief-card">
          <div className="local-card-heading">
            <div>
              <span className="eyebrow">Project brief</span>
              <h3>{overview.brief.headline}</h3>
            </div>
            <button
              className="icon-button"
              type="button"
              title="Refresh local checks"
              aria-label="Refresh local checks"
              disabled={overviewQuery.isFetching}
              onClick={() => void overviewQuery.refetch()}
            >
              <RefreshCw className={overviewQuery.isFetching ? 'spin' : undefined} size={17} />
            </button>
          </div>
          <p>{overview.brief.summary}</p>
          <ol className="local-next-actions">
            {overview.brief.nextActions.map((action) => (
              <li key={action}>{action}</li>
            ))}
          </ol>
        </article>

        <article className="local-checks-card">
          <div className="local-card-heading">
            <div>
              <span className="eyebrow">Missing-information checker</span>
              <h3>Readiness checks</h3>
            </div>
          </div>
          <div className="local-check-list">
            {[...overview.checks]
              .sort((left, right) => Number(left.passed) - Number(right.passed))
              .map((item) => (
                <div
                  className={`local-check-item ${item.passed ? 'passed' : item.severity.toLowerCase()}`}
                  key={item.key}
                >
                  <span className="local-check-icon">{checkIcon(item)}</span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.detail}</small>
                  </span>
                </div>
              ))}
          </div>
        </article>
      </div>

      <article className="local-datasheet-card">
        <div className="local-card-heading local-datasheet-heading">
          <div>
            <span className="eyebrow">Official datasheet validator</span>
            <h3>Schedule vs. Datasheet</h3>
            <p>
              The engine reads linked PDFs on this device and never changes your schedule without
              approval.
            </p>
          </div>
          <button
            className="button primary"
            type="button"
            disabled={!linkedCount || analyzeMutation.isPending}
            onClick={() => analyzeMutation.mutate()}
          >
            {analyzeMutation.isPending ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <FileSearch size={17} />
            )}
            {analyzeMutation.isPending
              ? 'Analyzing PDFs…'
              : `Analyze ${linkedCount || ''} Datasheet${linkedCount === 1 ? '' : 's'}`}
          </button>
        </div>

        {analyzeMutation.error ? (
          <div className="local-inline-warning">
            <CircleAlert size={16} /> {analyzeMutation.error.message}
          </div>
        ) : null}

        {analyses.length ? (
          <>
            <div className="local-comparison-summary" aria-label="Datasheet comparison summary">
              <span className="matched">{analysisTotals.matched} matched</span>
              <span className="mismatch">{analysisTotals.mismatches} differences</span>
              <span className="missing-schedule">{analysisTotals.missing} missing in schedule</span>
              <span className="needs-review">{analysisTotals.review} need review</span>
            </div>
            <div className="local-analysis-list">
              {analyses.map((analysis) => {
                const record = workspace.luminaires.find(
                  (item) => item.id === analysis.luminaireId,
                );
                const selected = selectedFields[analysis.luminaireId] ?? [];
                return (
                  <details className="local-analysis-item" key={analysis.luminaireId} open>
                    <summary>
                      <span>
                        <strong>{analysis.tag}</strong>
                        <small title={analysis.datasheetPath}>
                          {analysis.fileName || analysis.message}
                        </small>
                      </span>
                      <span className={`local-analysis-status ${analysis.status.toLowerCase()}`}>
                        {analysis.status}
                      </span>
                    </summary>
                    {analysis.comparisons.length ? (
                      <>
                        <div className="table-scroll">
                          <table className="local-comparison-table">
                            <thead>
                              <tr>
                                <th aria-label="Select value" />
                                <th>Field</th>
                                <th>Schedule</th>
                                <th>Datasheet</th>
                                <th>Result</th>
                                <th>Source</th>
                              </tr>
                            </thead>
                            <tbody>
                              {analysis.comparisons.map((field) => {
                                const selectable =
                                  Boolean(field.value) &&
                                  !field.ambiguous &&
                                  field.status !== 'Matched' &&
                                  field.status !== 'MissingDatasheet';
                                return (
                                  <tr key={field.fieldKey}>
                                    <td>
                                      <input
                                        type="checkbox"
                                        checked={selected.includes(field.fieldKey)}
                                        disabled={!selectable || applyMutation.isPending}
                                        aria-label={`Use datasheet ${field.label} for ${analysis.tag}`}
                                        onChange={() =>
                                          toggleField(analysis.luminaireId, field.fieldKey)
                                        }
                                      />
                                    </td>
                                    <td>{field.label}</td>
                                    <td title={field.scheduleValue || undefined}>
                                      {field.scheduleValue || '—'}
                                    </td>
                                    <td title={field.value || undefined}>{field.value || '—'}</td>
                                    <td>
                                      <span
                                        className={`local-comparison-status ${comparisonClass(field.status)}`}
                                      >
                                        {field.status}
                                      </span>
                                    </td>
                                    <td title={field.evidence || undefined}>
                                      {field.pageNumber ? `Page ${field.pageNumber}` : 'Not found'}
                                      {field.confidence ? (
                                        <small>{field.confidence}% confidence</small>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                        <div className="local-analysis-actions">
                          <small>Only checked, unambiguous values will be applied.</small>
                          <button
                            className="button secondary"
                            type="button"
                            disabled={!record || !selected.length || applyMutation.isPending}
                            onClick={() => {
                              if (!record) return;
                              applyMutation.mutate({
                                record,
                                analysis,
                                fields: selected as LocalIntelligenceFieldKey[],
                              });
                            }}
                          >
                            {applyMutation.isPending &&
                            applyMutation.variables?.record.id === record?.id ? (
                              <LoaderCircle className="spin" size={16} />
                            ) : (
                              <Check size={16} />
                            )}
                            Apply selected ({selected.length})
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="local-analysis-message">
                        <CircleAlert size={17} />
                        <span>
                          <strong>{analysis.message}</strong>
                          <small>
                            {analysis.textAvailable
                              ? 'Review this product manually.'
                              : 'A text-based official PDF is required for local extraction.'}
                          </small>
                        </span>
                      </div>
                    )}
                  </details>
                );
              })}
            </div>
          </>
        ) : (
          <div className="local-analysis-empty">
            <FileSearch size={24} />
            <span>
              <strong>No comparison has been run.</strong>
              <small>
                Link official PDF datasheets in Datasheets & Images, then analyze them here.
              </small>
            </span>
          </div>
        )}
      </article>

      <article className="local-file-classifier">
        <div className="local-card-heading">
          <div>
            <span className="eyebrow">Smart file classification</span>
            <h3>Files that need your review</h3>
          </div>
        </div>
        {filesForReview.length ? (
          <div className="local-file-list">
            {filesForReview.map((item) => (
              <div className="local-file-item" key={item.itemId}>
                <FileSearch size={17} />
                <span>
                  <strong title={item.fileName}>{item.fileName}</strong>
                  <small title={item.relativePath}>{item.relativePath}</small>
                </span>
                <span className="local-file-suggestion">
                  {item.currentCategory}
                  {item.changed ? ` → ${item.suggestedCategory}` : ''}
                  <small>
                    {item.confidence}% · {item.source === 'PdfText' ? 'PDF text' : 'file path'}
                  </small>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="local-classification-clear">
            <Check size={17} />
            <span>
              <strong>No uncertain indexed files.</strong>
              <small>Scan the project folder again after adding new files.</small>
            </span>
          </div>
        )}
      </article>
    </section>
  );
}
