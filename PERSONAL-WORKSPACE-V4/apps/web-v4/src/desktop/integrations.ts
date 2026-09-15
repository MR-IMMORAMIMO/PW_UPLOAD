import type { DesktopHandoff, DesktopHandoffAction } from '@scli/contracts';

export type IntegrationApplication = 'AUTOCAD' | 'DIALUX';
export type IntegrationHealth =
  | 'CONFIGURED'
  | 'DISCOVERED_SELECTION_REQUIRED'
  | 'SELECTED_VERSION_MISSING'
  | 'NOT_FOUND'
  | 'DESKTOP_UNAVAILABLE';

export interface IntegrationStatusModel {
  application: IntegrationApplication;
  health: IntegrationHealth;
  selectedPath: string | null;
  discoveries: Array<{ executablePath: string; version: string | null }>;
}

const APPLICATIONS: IntegrationApplication[] = ['AUTOCAD', 'DIALUX'];

export async function integrationStatuses(): Promise<IntegrationStatusModel[]> {
  const read = window.scliDesktop?.integrationStatus;
  if (!read) return APPLICATIONS.map(desktopUnavailable);
  try {
    const values = await read();
    return APPLICATIONS.map((application) => {
      const value = values.find((candidate) => candidate.application === application);
      return value
        ? {
            application,
            health: value.health,
            selectedPath: value.selectedPath,
            discoveries: value.discoveries,
          }
        : desktopUnavailable(application);
    });
  } catch {
    return APPLICATIONS.map(desktopUnavailable);
  }
}

export async function changeIntegration(application: IntegrationApplication): Promise<boolean> {
  const change = window.scliDesktop?.configureIntegration;
  if (!change) return false;
  try {
    return Boolean(await change(application));
  } catch {
    return false;
  }
}

export async function executeHandoff(handoff: DesktopHandoff): Promise<boolean> {
  const execute = window.scliDesktop?.executeDesktopHandoff;
  if (!execute || !isUuid(handoff.handoffId) || !isBoundedAction(handoff.action)) return false;
  try {
    await execute(handoff.handoffId, handoff.action);
    return true;
  } catch {
    return false;
  }
}

export async function executeManualPickerHandoff(
  handoff: DesktopHandoff,
): Promise<'accepted' | 'cancelled' | 'failed'> {
  const execute = window.scliDesktop?.executeDesktopHandoff;
  if (
    !execute ||
    handoff.action !== 'MANUAL_FILE_PICK' ||
    !isUuid(handoff.handoffId) ||
    !isBoundedAction(handoff.action)
  )
    return 'failed';
  try {
    const result = await execute(handoff.handoffId, handoff.action);
    return isManualPickerResult(result) && result.accepted === false ? 'cancelled' : 'accepted';
  } catch {
    return 'failed';
  }
}

export async function executeImportSourceHandoff(
  handoff: DesktopHandoff,
): Promise<'accepted' | 'cancelled' | 'failed'> {
  const execute = window.scliDesktop?.executeDesktopHandoff;
  if (
    !execute ||
    handoff.action !== 'SELECT_IMPORT_SOURCE' ||
    !isUuid(handoff.handoffId) ||
    !isBoundedAction(handoff.action)
  )
    return 'failed';
  try {
    const result = await execute(handoff.handoffId, handoff.action);
    return isManualPickerResult(result) && result.accepted === false ? 'cancelled' : 'accepted';
  } catch {
    return 'failed';
  }
}

export async function executeDocumentSourceHandoff(
  handoff: DesktopHandoff,
): Promise<'accepted' | 'cancelled' | 'failed'> {
  const execute = window.scliDesktop?.executeDesktopHandoff;
  if (
    !execute ||
    handoff.action !== 'SELECT_DOCUMENT_PDF' ||
    !isUuid(handoff.handoffId) ||
    !isBoundedAction(handoff.action)
  ) {
    return 'failed';
  }
  try {
    const result = await execute(handoff.handoffId, handoff.action);
    return isManualPickerResult(result) && result.accepted === false ? 'cancelled' : 'accepted';
  } catch {
    return 'failed';
  }
}

export async function executeProjectSourceHandoff(
  handoff: DesktopHandoff,
): Promise<'accepted' | 'cancelled' | 'failed'> {
  const execute = window.scliDesktop?.executeDesktopHandoff;
  if (
    !execute ||
    handoff.action !== 'SELECT_PROJECT_SOURCE' ||
    !isUuid(handoff.handoffId) ||
    !isBoundedAction(handoff.action)
  ) {
    return 'failed';
  }
  try {
    const result = await execute(handoff.handoffId, handoff.action);
    return isManualPickerResult(result) && result.accepted === false ? 'cancelled' : 'accepted';
  } catch {
    return 'failed';
  }
}

export function hasIntegrationBridge(): boolean {
  return Boolean(
    window.scliDesktop?.integrationStatus && window.scliDesktop?.executeDesktopHandoff,
  );
}

function desktopUnavailable(application: IntegrationApplication): IntegrationStatusModel {
  return { application, health: 'DESKTOP_UNAVAILABLE', selectedPath: null, discoveries: [] };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isBoundedAction(value: string): value is DesktopHandoffAction {
  return [
    'LAUNCH_TOOL',
    'OPEN_EXPORT_FOLDER',
    'TEST_LAUNCH',
    'MANUAL_FILE_PICK',
    'SELECT_IMPORT_SOURCE',
    'SELECT_DOCUMENT_PDF',
    'SELECT_PROJECT_SOURCE',
    'OPEN_CAPTURE_FILE',
    'REVEAL_CAPTURE_FILE',
  ].includes(value);
}

function isManualPickerResult(value: unknown): value is { accepted: boolean } {
  return Boolean(value && typeof value === 'object' && 'accepted' in value);
}
