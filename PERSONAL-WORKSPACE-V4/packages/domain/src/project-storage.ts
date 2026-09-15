export const projectStorageMarkerFileName = '.scli-project.json' as const;
export const projectStorageMarkerSchemaVersion = 1 as const;

export interface ProjectStorageMarker {
  schemaVersion: typeof projectStorageMarkerSchemaVersion;
  projectId: string;
  createdAt: string;
  projectCodeSnapshot: string;
}

export const projectStorageHealthStates = [
  'CONNECTED',
  'LEGACY_UNVERIFIED',
  'DISCONNECTED',
  'UNAVAILABLE',
  'NEEDS_RECONNECTION',
] as const;
export type ProjectStorageHealthState = (typeof projectStorageHealthStates)[number];

export const projectStorageHealthReasons = [
  'NOT_CONFIGURED',
  'NOT_FOUND',
  'PERMISSION_DENIED',
  'IO_UNAVAILABLE',
  'PATH_DISAGREEMENT',
  'MALFORMED_MARKER',
  'WRONG_PROJECT_MARKER',
  'LEGACY_EVIDENCE_MISSING',
  'OTHER_PROJECT_BINDING',
] as const;
export type ProjectStorageHealthReason = (typeof projectStorageHealthReasons)[number];

export interface ProjectStorageHealth {
  projectId: string;
  state: ProjectStorageHealthState;
  reason: ProjectStorageHealthReason | null;
  projectPath: string | null;
  workspacePath: string | null;
  canonicalPath: string | null;
  marker: ProjectStorageMarker | null;
  canOpenFolder: boolean;
  canReconnect: boolean;
  canAdoptLegacy: boolean;
  checkedAt: string;
}

export const projectStorageReconnectIntents = [
  'MATCHING_MARKER',
  'ADOPT_LEGACY',
  'INITIAL_BINDING',
] as const;
export type ProjectStorageReconnectIntent = (typeof projectStorageReconnectIntents)[number];
