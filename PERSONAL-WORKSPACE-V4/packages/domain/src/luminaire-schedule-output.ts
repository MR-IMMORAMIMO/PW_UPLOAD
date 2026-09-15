import type { LuminaireRecord, ProjectRevision } from './personal';
import type {
  CanonicalLuminaireSnapshot,
  CanonicalOutputRecord,
  CanonicalRevisionRecord,
  OutputRegistryLifecycleState,
  OutputTemplateSelectionRecord,
} from './output-registry';
import type { ResolvedOutputTemplate } from './output-templates';

export const scheduleArtifactPresenceStates = ['Present', 'Missing', 'Unavailable'] as const;
export type ScheduleArtifactPresence = (typeof scheduleArtifactPresenceStates)[number];

export const scheduleGenerationFormats = ['XLSX', 'PDF', 'Both'] as const;
export type ScheduleGenerationFormat = (typeof scheduleGenerationFormats)[number];
export type TechnicalBoqGenerationFormat = ScheduleGenerationFormat;

/** Active immutable Template Version exposed to the technical Schedule inspector. */
export interface TechnicalScheduleTemplateView {
  templateId: string;
  templateVersionId: string;
  name: string;
  version: string;
  resolvedTemplate: ResolvedOutputTemplate;
}

export interface TechnicalScheduleRevisionView {
  revision: CanonicalRevisionRecord;
  generatedOutputRevision: boolean;
  compatibility: Pick<ProjectRevision, 'status' | 'issuedAt' | 'locked'> | null;
}

export interface TechnicalScheduleSelectedRevisionView {
  metadata: TechnicalScheduleRevisionView;
  rows: CanonicalLuminaireSnapshot[];
}

export interface TechnicalScheduleOutputHistoryItem {
  output: CanonicalOutputRecord;
  revisionLabel: string;
  revisionSequence: number;
  templateName: string | null;
  createdById: string | null;
  createdByName: string | null;
  artifactPresence: ScheduleArtifactPresence;
}

export interface TechnicalScheduleGenerationReadiness {
  ready: boolean;
  reasons: string[];
}

/**
 * C1 — an existing composed Revision this workspace may generate INTO.
 *
 * Server-derived and ADVISORY ONLY: it exists so the page can render a truthful
 * target context and disable a guaranteed conflict. Eligibility is re-verified
 * on every generation call — this list is never generation authority.
 */
export interface TechnicalOutputComposableTarget {
  revisionId: string;
  revisionLabel: string;
  revisionSequence: number;
  lifecycleState: OutputRegistryLifecycleState;
  createdAt: string;
  createdByName: string | null;
  /** Formats of THIS workspace's Output family already occupied on the target. */
  occupiedFormats: ScheduleGenerationFormat[];
  /** Immutable Document Snapshots already composed onto the target. */
  snapshotCount: number;
}

export const technicalOutputTargetRejections = [
  'TARGET_NOT_FOUND',
  'TARGET_OTHER_PROJECT',
  'TARGET_NOT_CANONICAL',
  'TARGET_NOT_COMPOSED',
  'TARGET_FINALIZED',
  'TARGET_FAILED_RECOVERABLE',
  'TARGET_NOT_PREPARING',
] as const;
export type TechnicalOutputTargetRejection = (typeof technicalOutputTargetRejections)[number];

/** Server verdict for the target Revision the client currently claims to target. */
export interface TechnicalOutputRequestedTargetView {
  revisionId: string;
  eligible: boolean;
  rejection: TechnicalOutputTargetRejection | null;
  message: string;
  target: TechnicalOutputComposableTarget | null;
}

/** Cohesive project-scoped authority required by the future V4 Schedule page. */
export interface TechnicalScheduleWorkspaceView {
  projectId: string;
  currentRows: LuminaireRecord[];
  templates: TechnicalScheduleTemplateView[];
  effectiveTemplate: ResolvedOutputTemplate;
  projectOverride: OutputTemplateSelectionRecord | null;
  revisions: TechnicalScheduleRevisionView[];
  selectedRevision: TechnicalScheduleSelectedRevisionView | null;
  outputs: TechnicalScheduleOutputHistoryItem[];
  generationReadiness: TechnicalScheduleGenerationReadiness;
  composableTargets: TechnicalOutputComposableTarget[];
  requestedTarget: TechnicalOutputRequestedTargetView | null;
}

export interface TechnicalScheduleGenerationResult {
  revision: CanonicalRevisionRecord;
  outputs: CanonicalOutputRecord[];
  files: {
    xlsxPath: string | null;
    pdfPath: string | null;
  };
}

export type TechnicalBoqTemplateView = TechnicalScheduleTemplateView;
export type TechnicalBoqRevisionView = TechnicalScheduleRevisionView;
export type TechnicalBoqSelectedRevisionView = TechnicalScheduleSelectedRevisionView;
export type TechnicalBoqOutputHistoryItem = TechnicalScheduleOutputHistoryItem;
export type TechnicalBoqGenerationReadiness = TechnicalScheduleGenerationReadiness;
export type TechnicalBoqWorkspaceView = TechnicalScheduleWorkspaceView;
export type TechnicalBoqGenerationResult = TechnicalScheduleGenerationResult;
export type TechnicalBoqComposableTarget = TechnicalOutputComposableTarget;
export type TechnicalBoqRequestedTargetView = TechnicalOutputRequestedTargetView;
