import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileSearch,
  FolderInput,
  FolderSearch,
  HardDrive,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  projectServiceLabels,
  statusLabels,
  type LegacyProjectCandidate,
  type LegacyProjectImportResult,
  type ProjectFolderIndex,
  type ProjectServiceCode,
  type ProjectStatus,
} from '@scli/domain';
import { api } from '../api';
import { parseCommercialValueInput } from '../commercial-value';
import { desktop } from '../desktop';
import { salesTone } from '../sales-color';
import { useToast } from '../components/toast';
import { EmptyState, PageHeader } from '../components/ui';

interface ImportDraft {
  projectCode: string;
  projectName: string;
  clientName: string;
  projectType: string;
  crmReference: string;
  commercialValueAmount: string;
  commercialCurrency: string;
  actualHours: string;
  salesOwnerId: string;
  status: ProjectStatus;
  services: ProjectServiceCode[];
  createdDate: string;
  requiredDeliveryDate: string;
}

const coreServices: ProjectServiceCode[] = ['LuminaireSchedule', 'TechnicalBoq', 'Datasheets'];

function serviceSuggestions(index: ProjectFolderIndex): ProjectServiceCode[] {
  const services = new Set<ProjectServiceCode>(coreServices);
  if (index.counts.Drawings) services.add('LightingLayout');
  if (index.counts.Dialux) {
    services.add('DialuxCalculation');
    services.add('DialuxReport');
  }
  if (index.counts.Renderings) services.add('Visualization3D');
  return [...services];
}

function inventorySummary(index: ProjectFolderIndex | undefined): string {
  if (!index) return 'Files not inspected yet';
  const visible = [
    ['Drawings', index.counts.Drawings],
    ['DIALux', index.counts.Dialux],
    ['Renders', index.counts.Renderings],
    ['Schedules', index.counts.Schedules],
    ['BOQ', index.counts.TechnicalBoq],
    ['Datasheets', index.counts.Datasheets],
  ].filter(([, count]) => Number(count) > 0);
  return visible.length
    ? visible.map(([label, count]) => `${count} ${label}`).join(' · ')
    : `${index.fileCount} uncategorized file(s)`;
}

function defaultDraft(candidate: LegacyProjectCandidate): ImportDraft {
  const fallbackDate = candidate.projectDate ?? new Date().toISOString().slice(0, 10);
  return {
    projectCode: candidate.projectCode,
    projectName: candidate.projectName,
    clientName: 'Not recorded',
    projectType: 'Legacy Project',
    crmReference: '',
    commercialValueAmount: '',
    commercialCurrency: '',
    actualHours: '',
    salesOwnerId: '',
    status: 'Archived',
    services: coreServices,
    createdDate: fallbackDate,
    requiredDeliveryDate: fallbackDate,
  };
}

export function PersonalLegacyImportScreen() {
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ['personal-settings'],
    queryFn: api.personalSettings,
  });
  const salesQuery = useQuery({ queryKey: ['sales-users'], queryFn: api.salesUsers });
  const [rootPath, setRootPath] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, ImportDraft>>({});
  const [inventories, setInventories] = useState<Record<string, ProjectFolderIndex>>({});
  const [indexAfterImport, setIndexAfterImport] = useState(true);
  const [result, setResult] = useState<LegacyProjectImportResult | null>(null);

  useEffect(() => {
    if (!rootPath && settingsQuery.data?.projectRoot) setRootPath(settingsQuery.data.projectRoot);
  }, [rootPath, settingsQuery.data?.projectRoot]);

  const previewMutation = useMutation({
    mutationFn: () => api.previewLegacyProjects(rootPath),
    onSuccess: (preview) => {
      const nextDrafts = Object.fromEntries(
        preview.candidates.map((candidate) => [candidate.folderPath, defaultDraft(candidate)]),
      );
      setDrafts(nextDrafts);
      setSelected(
        preview.candidates
          .filter((candidate) => candidate.recognized && !candidate.duplicateProjectId)
          .map((candidate) => candidate.folderPath),
      );
      setInventories({});
      setResult(null);
      showToast(`${preview.candidates.length} project folder(s) found. Review before importing.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const candidates = previewMutation.data?.candidates ?? [];
  const selectedCandidates = useMemo(
    () => candidates.filter((candidate) => selected.includes(candidate.folderPath)),
    [candidates, selected],
  );

  const scanMutation = useMutation({
    mutationFn: async () => {
      const indexes: ProjectFolderIndex[] = [];
      for (let index = 0; index < selected.length; index += 5) {
        indexes.push(...(await api.scanLegacyProjectFolders(selected.slice(index, index + 5))));
      }
      return indexes;
    },
    onSuccess: (indexes) => {
      const next = { ...inventories };
      const nextDrafts = { ...drafts };
      indexes.forEach((index) => {
        next[index.folderPath] = index;
        const current = nextDrafts[index.folderPath];
        if (current)
          nextDrafts[index.folderPath] = { ...current, services: serviceSuggestions(index) };
      });
      setInventories(next);
      setDrafts(nextDrafts);
      showToast(`Inspected ${indexes.length} project folder(s) without opening their files.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const imported = await api.importLegacyProjects({
        rootPath: previewMutation.data!.rootPath,
        projects: selectedCandidates.map((candidate) => {
          const draft = drafts[candidate.folderPath]!;
          const commercial = parseCommercialValueInput(
            draft.commercialValueAmount,
            draft.commercialCurrency,
          );
          if (!commercial.ok) {
            throw new Error(`${candidate.folderName}: ${commercial.error}`);
          }
          const actualHours = draft.actualHours.trim();
          return {
            folderName: candidate.folderName,
            folderPath: candidate.folderPath,
            projectCode: draft.projectCode,
            projectName: draft.projectName,
            clientName: draft.clientName,
            projectType: draft.projectType.trim() || 'Legacy Project',
            crmReference: draft.crmReference.trim() || null,
            commercialValueMinor: commercial.value.commercialValueMinor ?? null,
            commercialCurrency: commercial.value.commercialCurrency ?? null,
            actualHours: actualHours ? Number(actualHours) : undefined,
            salesOwnerId: draft.salesOwnerId || null,
            status: draft.status,
            services: draft.services,
            siteLocation: 'Not recorded',
            designStage: 'AsBuilt',
            lightingScope: 'Legacy lighting project',
            priority: 'Normal',
            createdDate: draft.createdDate,
            requiredDeliveryDate: draft.requiredDeliveryDate,
            indexFiles: false,
          };
        }),
      });
      if (indexAfterImport) {
        for (const project of imported.imported) {
          try {
            const index = await api.scanProjectFiles(project.projectId);
            project.fileCount = index.fileCount;
          } catch (error) {
            project.scanWarning = error instanceof Error ? error.message : 'Folder scan failed.';
          }
        }
      }
      return imported;
    },
    onSuccess: async (imported) => {
      setResult(imported);
      setSelected([]);
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      showToast(`${imported.imported.length} legacy project(s) added. Original folders untouched.`);
    },
    onError: (error) => showToast((error as Error).message, 'error'),
  });

  const updateDraft = (folderPath: string, patch: Partial<ImportDraft>) => {
    const current = drafts[folderPath];
    if (current) setDrafts({ ...drafts, [folderPath]: { ...current, ...patch } });
  };

  return (
    <>
      <Link className="back-link" to="/projects">
        <ArrowLeft /> Back to projects
      </Link>
      <PageHeader
        eyebrow="Read-only legacy onboarding"
        title="Import Existing Projects"
        description="Turn your existing SCLI project folders into searchable workspace records without renaming, moving or deleting anything."
      />

      <section className="legacy-safety-strip">
        <ShieldCheck />
        <div>
          <strong>Safe by design</strong>
          <span>
            Preview first, import second. File inspection reads names and metadata only; OneDrive
            content is never opened or downloaded.
          </span>
        </div>
      </section>

      <section className="content-card legacy-root-card">
        <div>
          <span className="eyebrow">Step 1 · Select your projects root</span>
          <h2>Find legacy project folders</h2>
          <p>Choose the folder that directly contains names such as 001_SCLI250919_PROJECT.</p>
        </div>
        <label className="field">
          Projects root
          <span className="field-path-control">
            <input
              value={rootPath}
              onChange={(event) => setRootPath(event.target.value)}
              placeholder="Choose 001_MY_PROJECTS"
            />
            <button
              className="button secondary"
              type="button"
              onClick={async () => {
                const folder = await desktop.selectFolder();
                if (folder) setRootPath(folder);
              }}
            >
              <FolderSearch /> Browse
            </button>
          </span>
        </label>
        <button
          className="button primary"
          type="button"
          disabled={!rootPath.trim() || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? <LoaderCircle className="spin" /> : <FolderInput />}
          Scan Folder Names
        </button>
      </section>

      {previewMutation.data ? (
        <>
          <section className="legacy-preview-toolbar">
            <div>
              <strong>{candidates.length} folders found</strong>
              <span>
                {selected.length} selected · next new project number{' '}
                {String(previewMutation.data.nextProjectNumber).padStart(3, '0')}
              </span>
            </div>
            <div className="toolbar-actions">
              <button
                className="button ghost"
                type="button"
                onClick={() =>
                  setSelected(
                    candidates
                      .filter((candidate) => candidate.recognized && !candidate.duplicateProjectId)
                      .map((candidate) => candidate.folderPath),
                  )
                }
              >
                Select ready
              </button>
              <button className="button ghost" type="button" onClick={() => setSelected([])}>
                Clear
              </button>
              <button
                className="button secondary"
                type="button"
                disabled={!selected.length || scanMutation.isPending}
                onClick={() => scanMutation.mutate()}
              >
                {scanMutation.isPending ? <LoaderCircle className="spin" /> : <FileSearch />}
                Inspect Selected Files
              </button>
            </div>
          </section>

          <div className="legacy-candidate-list">
            {candidates.map((candidate) => {
              const draft = drafts[candidate.folderPath] ?? defaultDraft(candidate);
              const inventory = inventories[candidate.folderPath];
              const checked = selected.includes(candidate.folderPath);
              const disabled = Boolean(candidate.duplicateProjectId);
              const salesperson = (salesQuery.data ?? []).find(
                (user) => user.id === draft.salesOwnerId,
              );
              return (
                <details
                  className={`legacy-candidate${checked ? ' selected' : ''}${disabled ? ' duplicate' : ''}`}
                  key={candidate.folderPath}
                >
                  <summary>
                    <input
                      type="checkbox"
                      aria-label={`Select ${candidate.folderName}`}
                      checked={checked}
                      disabled={disabled}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, candidate.folderPath]
                            : selected.filter((item) => item !== candidate.folderPath),
                        )
                      }
                    />
                    <span className="legacy-sequence">
                      {candidate.sequenceNumber === null
                        ? '—'
                        : String(candidate.sequenceNumber).padStart(3, '0')}
                    </span>
                    <span className="legacy-candidate-copy">
                      <strong>{candidate.folderName}</strong>
                      <small>{inventorySummary(inventory)}</small>
                    </span>
                    {disabled ? (
                      <span className="legacy-state duplicate-state">
                        <AlertTriangle /> Already imported
                      </span>
                    ) : candidate.recognized ? (
                      <span className="legacy-state ready-state">
                        <Check /> Ready
                      </span>
                    ) : (
                      <span className="legacy-state warning-state">
                        <AlertTriangle /> Review name
                      </span>
                    )}
                  </summary>
                  <div className="legacy-candidate-editor">
                    {candidate.warnings.length ? (
                      <div className="legacy-warning-list">
                        {candidate.warnings.map((warning) => (
                          <span key={warning}>
                            <AlertTriangle /> {warning}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="legacy-edit-grid">
                      <label>
                        Project code
                        <input
                          value={draft.projectCode}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { projectCode: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Project name
                        <input
                          value={draft.projectName}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { projectName: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Client
                        <input
                          value={draft.clientName}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { clientName: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Project type
                        <input
                          value={draft.projectType}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { projectType: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        CRM Reference <small>Optional</small>
                        <input
                          value={draft.crmReference}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { crmReference: event.target.value })
                          }
                          placeholder="e.g. CRM-48572"
                        />
                      </label>
                      <label>
                        Commercial Value Amount <small>Optional</small>
                        <input
                          value={draft.commercialValueAmount}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, {
                              commercialValueAmount: event.target.value,
                            })
                          }
                          inputMode="decimal"
                          placeholder="e.g. 125000.50"
                        />
                      </label>
                      <label>
                        Commercial Value Currency <small>Optional</small>
                        <input
                          value={draft.commercialCurrency}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, {
                              commercialCurrency: event.target.value.toUpperCase(),
                            })
                          }
                          maxLength={3}
                          placeholder="AED"
                        />
                      </label>
                      <label>
                        Actual Hours <small>Legacy baseline</small>
                        <input
                          type="number"
                          min="0"
                          value={draft.actualHours}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { actualHours: event.target.value })
                          }
                          placeholder="e.g. 12.5"
                        />
                      </label>
                      <label>
                        Status
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, {
                              status: event.target.value as ProjectStatus,
                            })
                          }
                        >
                          {['Archived', 'Completed', 'InProgress', 'OnHold', 'Cancelled'].map(
                            (status) => (
                              <option value={status} key={status}>
                                {statusLabels[status as ProjectStatus]}
                              </option>
                            ),
                          )}
                        </select>
                      </label>
                      <label>
                        Salesperson
                        <select
                          className={salesTone(salesperson?.id ?? 'Unassigned')}
                          value={draft.salesOwnerId}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { salesOwnerId: event.target.value })
                          }
                        >
                          <option value="">Unassigned</option>
                          {(salesQuery.data ?? [])
                            .filter((user) => user.isActive)
                            .map((user) => (
                              <option value={user.id} key={user.id}>
                                {user.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Original project date
                        <input
                          type="date"
                          value={draft.createdDate}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, { createdDate: event.target.value })
                          }
                        />
                      </label>
                      <label>
                        Required / reference date
                        <input
                          type="date"
                          value={draft.requiredDeliveryDate}
                          onChange={(event) =>
                            updateDraft(candidate.folderPath, {
                              requiredDeliveryDate: event.target.value,
                            })
                          }
                        />
                      </label>
                    </div>
                    <div className="legacy-service-suggestions">
                      <strong>Detected / selected scope</strong>
                      <div>
                        {draft.services.map((service) => (
                          <span key={service}>{projectServiceLabels[service]}</span>
                        ))}
                      </div>
                    </div>
                    {inventory ? (
                      <div className="legacy-inventory-note">
                        <HardDrive />
                        <span>
                          <strong>{inventory.fileCount} files indexed in preview</strong>
                          {inventory.oneDriveManaged
                            ? 'OneDrive-managed metadata only. Opening a file may download it.'
                            : 'Local metadata only; file contents were not opened.'}
                        </span>
                      </div>
                    ) : null}
                  </div>
                </details>
              );
            })}
          </div>

          {!candidates.length ? (
            <EmptyState
              title="No project folders found"
              description="Choose the folder that directly contains your numbered project folders."
            />
          ) : null}

          {selected.length ? (
            <section className="legacy-import-bar">
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={indexAfterImport}
                  onChange={(event) => setIndexAfterImport(event.target.checked)}
                />
                Build the safe file index after import
              </label>
              <span>{selected.length} project(s) will be linked in place.</span>
              <button
                className="button primary"
                type="button"
                disabled={importMutation.isPending}
                onClick={() => importMutation.mutate()}
              >
                {importMutation.isPending ? <LoaderCircle className="spin" /> : <FolderInput />}
                Import Selected Projects
              </button>
            </section>
          ) : null}
        </>
      ) : null}

      {result ? (
        <section className="content-card legacy-result-card">
          <ShieldCheck />
          <div>
            <h2>{result.imported.length} projects imported safely</h2>
            <p>
              Next project number is {String(result.nextProjectNumber).padStart(3, '0')}. No source
              folder or file was changed.
            </p>
            <div className="legacy-result-links">
              {result.imported.map((project) => (
                <Link to={`/projects/${project.projectId}`} key={project.projectId}>
                  <strong>{project.projectCode}</strong>
                  <span>
                    {project.projectName} · {project.fileCount} indexed file(s)
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}
