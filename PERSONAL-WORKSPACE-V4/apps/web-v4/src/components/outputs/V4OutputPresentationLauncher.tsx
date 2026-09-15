import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type {
  OutputFamily,
  ResolvedOutputEnvelope,
  ResolvedOutputPage,
  TechnicalScheduleTemplateView,
} from '@scli/domain';
import type { P4dOutputPreviewInput } from '@scli/contracts';
import { api } from '../../api/environment';
import { businessTodayKey } from '../../date-time/businessDateTime';
import { V4Button } from '../common/V4Button';
import { V4FloatingWorkspace } from '../common/V4FloatingWorkspace';
import { Check, FileDown, RefreshCw } from '../common/SctIcons';
import './V4OutputPresentationLauncher.css';

type TemplateSelection = {
  templateId: string;
  templateVersionId: string;
};

export interface V4OutputPresentationLauncherProps {
  projectId: string;
  outputKind: OutputFamily;
  targetRevisionId?: string | undefined;
  disabled?: boolean | undefined;
  label?: string | undefined;
  triggerContent?: ReactNode | undefined;
  triggerStyle?: CSSProperties | undefined;
  templateOptions?: readonly TechnicalScheduleTemplateView[] | undefined;
  selectedTemplate?: TemplateSelection | undefined;
  onGenerated?: (() => void | Promise<void>) | undefined;
}

const outputLabels: Record<OutputFamily, string> = {
  LuminaireSchedule: 'Technical Luminaire Schedule',
  PresentationSchedule: 'Presentation Luminaire Schedule',
  TechnicalBoq: 'Technical Lighting BOQ',
  DatasheetRegister: 'Datasheet Register',
};

function templateKey(selection: TemplateSelection | undefined): string {
  return selection ? `${selection.templateId}::${selection.templateVersionId}` : '';
}

function templateSelection(key: string): TemplateSelection | undefined {
  if (!key) return undefined;
  const separator = key.indexOf('::');
  if (separator < 1) return undefined;
  return {
    templateId: key.slice(0, separator),
    templateVersionId: key.slice(separator + 2),
  };
}

function compactError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'The output could not be prepared. Please try again.';
}

function countLabel(page: ResolvedOutputPage): string {
  switch (page.kind) {
    case 'LuminaireSchedule':
      return `${page.rows.length} luminaire${page.rows.length === 1 ? '' : 's'}`;
    case 'PresentationSchedule':
      return `${page.products.length} product${page.products.length === 1 ? '' : 's'}`;
    case 'TechnicalBoq':
      return `${page.groups.reduce((total, group) => total + group.rows.length, 0)} BOQ row${page.groups.reduce((total, group) => total + group.rows.length, 0) === 1 ? '' : 's'}`;
    case 'DatasheetRegister':
      return `${page.rows.length} register row${page.rows.length === 1 ? '' : 's'}`;
  }
}

function PreviewPage({ page }: { page: ResolvedOutputPage }) {
  return (
    <article className="v4-output-launcher__page">
      <header>
        <strong>Page {page.pageNumber}</strong>
        <span>{countLabel(page)}</span>
      </header>
      {page.kind === 'LuminaireSchedule' ? (
        <div className="v4-output-launcher__table-preview">
          {page.rows.slice(0, 8).map((row) => (
            <div key={row.luminaireId}>
              <b>{row.tag}</b>
              <span>{row.manufacturer || '—'}</span>
              <span>{row.model || row.description || '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
      {page.kind === 'PresentationSchedule' ? (
        <div className="v4-output-launcher__product-grid">
          {page.products.map((product) => (
            <div key={product.luminaireId}>
              <b>{product.tag}</b>
              <span>{product.manufacturer || '—'}</span>
              <small>{product.model || product.description || '—'}</small>
            </div>
          ))}
        </div>
      ) : null}
      {page.kind === 'TechnicalBoq' ? (
        <div className="v4-output-launcher__boq-preview">
          {page.groups.slice(0, 8).map((group) => (
            <div key={group.category}>
              <b>{group.category || 'Uncategorized'}</b>
              <span>{group.rows.length} item(s)</span>
              <small>
                {Object.entries(group.totalsByUnit)
                  .map(([unit, total]) => `${total} ${unit}`)
                  .join(' · ') || '—'}
              </small>
            </div>
          ))}
        </div>
      ) : null}
      {page.kind === 'DatasheetRegister' ? (
        <div className="v4-output-launcher__table-preview">
          {page.rows.slice(0, 10).map((row) => (
            <div key={row.luminaireId}>
              <b>{row.tag}</b>
              <span>{row.manufacturer || '—'}</span>
              <span>{row.datasheet.status}</span>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

export function V4OutputPresentationLauncher({
  projectId,
  outputKind,
  targetRevisionId,
  disabled = false,
  label = 'Preview',
  triggerContent,
  triggerStyle,
  templateOptions = [],
  selectedTemplate,
  onGenerated,
}: V4OutputPresentationLauncherProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const initialTemplate = templateKey(selectedTemplate);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'PDF' | 'XLSX'>('PDF');
  const [pageSize, setPageSize] = useState<'A4' | 'A3'>('A4');
  const [orientation, setOrientation] = useState<'Portrait' | 'Landscape'>('Landscape');
  const [productsPerPage, setProductsPerPage] = useState<2 | 3 | 4>(3);
  const [issueStatus, setIssueStatus] = useState('Preliminary');
  const [issueDate, setIssueDate] = useState(() => businessTodayKey());
  const [selectedTemplateKey, setSelectedTemplateKey] = useState(initialTemplate);
  const [preview, setPreview] = useState<ResolvedOutputEnvelope | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedPath, setGeneratedPath] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setSelectedTemplateKey(templateKey(selectedTemplate));
  }, [open, selectedTemplate]);

  const markPreviewStale = () => {
    setPreview(null);
    setGeneratedPath(null);
    setError(null);
  };

  const buildPreviewInput = (): P4dOutputPreviewInput => {
    const selection = templateSelection(selectedTemplateKey);
    return {
      outputKind,
      format,
      issueStatus: issueStatus.trim() || 'Preliminary',
      issueDate,
      ...(targetRevisionId ? { targetRevisionId } : {}),
      ...(selection
        ? {
            templateId: selection.templateId,
            templateVersionId: selection.templateVersionId,
          }
        : {}),
      options: {
        pageSize,
        orientation,
        ...(outputKind === 'PresentationSchedule' ? { productsPerPage } : {}),
      },
    };
  };

  const applyTemplateDefaults = (key: string) => {
    const option = templateOptions.find(
      (candidate) => `${candidate.templateId}::${candidate.templateVersionId}` === key,
    );
    if (!option) return;
    const { resolvedTemplate } = option;
    if (resolvedTemplate.paperSize === 'A4' || resolvedTemplate.paperSize === 'A3') {
      setPageSize(resolvedTemplate.paperSize);
    }
    setOrientation(resolvedTemplate.orientation);
    if (
      resolvedTemplate.productsPerPage === 2 ||
      resolvedTemplate.productsPerPage === 3 ||
      resolvedTemplate.productsPerPage === 4
    ) {
      setProductsPerPage(resolvedTemplate.productsPerPage);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setError(null);
    setGeneratedPath(null);
    try {
      const next = await api.previewP4dOutput(projectId, buildPreviewInput());
      setPreview(next);
    } catch (cause) {
      setPreview(null);
      setError(compactError(cause));
    } finally {
      setPreviewing(false);
    }
  };

  const launch = () => {
    if (disabled) return;
    setOpen(true);
    setError(null);
    setGeneratedPath(null);
    if (selectedTemplateKey) applyTemplateDefaults(selectedTemplateKey);
    window.setTimeout(() => void runPreview(), 0);
  };

  const generate = async () => {
    if (!preview) return;
    setGenerating(true);
    setError(null);
    setGeneratedPath(null);
    try {
      const result = await api.generateP4dOutput(projectId, {
        ...buildPreviewInput(),
        previewFingerprint: preview.sourceFingerprint,
      });
      const path = format === 'PDF' ? result.files.pdfPath : result.files.xlsxPath;
      setGeneratedPath(path);
      await onGenerated?.();
    } catch (cause) {
      setError(compactError(cause));
      setPreview(null);
    } finally {
      setGenerating(false);
    }
  };

  const blockingMessages =
    preview?.messages.filter((message) => message.level === 'BLOCKING_ERROR') ?? [];
  const busy = previewing || generating;

  return (
    <>
      <V4Button
        ref={triggerRef}
        size="compact"
        variant="secondary"
        disabled={disabled}
        style={triggerStyle}
        onClick={launch}
      >
        {triggerContent ?? label}
      </V4Button>
      <V4FloatingWorkspace
        open={open}
        title={outputLabels[outputKind]}
        description="Resolve a read-only preview first, then generate the exact approved output."
        panelClassName="v4-output-launcher"
        bodyClassName="v4-output-launcher__body"
        returnFocusRef={triggerRef}
        dismissible={!generating}
        onRequestClose={() => setOpen(false)}
        footer={
          <>
            {generatedPath ? (
              <span className="v4-output-launcher__generated" role="status">
                <Check aria-hidden="true" /> Output generated
              </span>
            ) : null}
            <V4Button
              variant="secondary"
              size="compact"
              disabled={busy}
              onClick={() => void runPreview()}
            >
              <RefreshCw aria-hidden="true" /> {previewing ? 'Refreshing…' : 'Refresh Preview'}
            </V4Button>
            {generatedPath && window.scliDesktop?.openPath ? (
              <V4Button
                variant="secondary"
                size="compact"
                disabled={busy}
                onClick={() => void window.scliDesktop?.openPath?.(generatedPath)}
              >
                Open File
              </V4Button>
            ) : null}
            <V4Button
              variant="primary"
              size="compact"
              disabled={!preview || busy || blockingMessages.length > 0}
              onClick={() => void generate()}
            >
              <FileDown aria-hidden="true" /> {generating ? 'Generating…' : 'Generate Output'}
            </V4Button>
          </>
        }
      >
        <aside className="v4-output-launcher__controls" aria-label="Output settings">
          <label>
            <span>Format</span>
            <select
              value={format}
              disabled={busy}
              onChange={(event) => {
                setFormat(event.target.value as 'PDF' | 'XLSX');
                markPreviewStale();
              }}
            >
              <option value="PDF">PDF</option>
              <option value="XLSX">Excel (XLSX)</option>
            </select>
          </label>
          {templateOptions.length ? (
            <label>
              <span>Template</span>
              <select
                value={selectedTemplateKey}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value;
                  setSelectedTemplateKey(next);
                  applyTemplateDefaults(next);
                  markPreviewStale();
                }}
              >
                {templateOptions.map((template) => (
                  <option
                    key={`${template.templateId}::${template.templateVersionId}`}
                    value={`${template.templateId}::${template.templateVersionId}`}
                  >
                    {template.name} · {template.version}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className="v4-output-launcher__control-grid">
            <label>
              <span>Paper</span>
              <select
                value={pageSize}
                disabled={busy}
                onChange={(event) => {
                  setPageSize(event.target.value as 'A4' | 'A3');
                  markPreviewStale();
                }}
              >
                <option value="A4">A4</option>
                <option value="A3">A3</option>
              </select>
            </label>
            <label>
              <span>Orientation</span>
              <select
                value={orientation}
                disabled={busy}
                onChange={(event) => {
                  setOrientation(event.target.value as 'Portrait' | 'Landscape');
                  markPreviewStale();
                }}
              >
                <option value="Portrait">Portrait</option>
                <option value="Landscape">Landscape</option>
              </select>
            </label>
          </div>
          {outputKind === 'PresentationSchedule' ? (
            <label>
              <span>Products per page</span>
              <select
                value={productsPerPage}
                disabled={busy}
                onChange={(event) => {
                  setProductsPerPage(Number(event.target.value) as 2 | 3 | 4);
                  markPreviewStale();
                }}
              >
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
              </select>
            </label>
          ) : null}
          <label>
            <span>Issue status</span>
            <input
              value={issueStatus}
              maxLength={100}
              disabled={busy}
              onChange={(event) => {
                setIssueStatus(event.target.value);
                markPreviewStale();
              }}
            />
          </label>
          <label>
            <span>Issue date</span>
            <input
              type="date"
              value={issueDate}
              disabled={busy}
              onChange={(event) => {
                setIssueDate(event.target.value);
                markPreviewStale();
              }}
            />
          </label>
          <div className="v4-output-launcher__authority-note">
            <strong>Preview authority</strong>
            <span>
              Generation is enabled only from the current server-resolved preview fingerprint.
            </span>
          </div>
        </aside>
        <section className="v4-output-launcher__preview" aria-live="polite">
          {previewing ? (
            <div className="v4-output-launcher__state">Resolving preview…</div>
          ) : null}
          {error ? (
            <div className="v4-output-launcher__error" role="alert">
              {error}
            </div>
          ) : null}
          {!previewing && !error && !preview ? (
            <div className="v4-output-launcher__state">
              Settings changed. Refresh the preview before generating.
            </div>
          ) : null}
          {preview ? (
            <>
              <header className="v4-output-launcher__preview-header">
                <div>
                  <span>{preview.project.projectCode}</span>
                  <strong>{preview.project.projectName}</strong>
                  <small>{preview.project.clientName}</small>
                </div>
                <dl>
                  <div>
                    <dt>Pages</dt>
                    <dd>{preview.pages.length}</dd>
                  </div>
                  <div>
                    <dt>Rows</dt>
                    <dd>{preview.rowCount}</dd>
                  </div>
                  <div>
                    <dt>Template</dt>
                    <dd>{preview.template.displayName}</dd>
                  </div>
                </dl>
              </header>
              {preview.messages.length ? (
                <div className="v4-output-launcher__messages">
                  {preview.messages.map((message, index) => (
                    <p key={`${message.code}-${index}`} data-level={message.level}>
                      <b>
                        {message.level === 'BLOCKING_ERROR'
                          ? 'Blocking'
                          : message.level === 'WARNING'
                            ? 'Warning'
                            : 'Info'}
                      </b>
                      {message.message}
                    </p>
                  ))}
                </div>
              ) : null}
              <div className="v4-output-launcher__pages">
                {preview.pages.map((page) => (
                  <PreviewPage key={`${page.kind}-${page.pageNumber}`} page={page} />
                ))}
              </div>
            </>
          ) : null}
        </section>
      </V4FloatingWorkspace>
    </>
  );
}
