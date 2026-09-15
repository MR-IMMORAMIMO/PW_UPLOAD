// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Project, ProjectFolderSnapshot } from '@scli/domain';
import { ToastProvider } from './toast';
import { ManageStructureDrawer, type ManageStructureWorkspace } from './folder-structure-editor';
import { apiRequest } from '../api';

vi.mock('../api', () => ({ apiRequest: vi.fn() }));

const mockedApiRequest = vi.mocked(apiRequest);

const snapshot: ProjectFolderSnapshot = {
  schemaVersion: '1.0',
  sourceProfile: null,
  folders: [
    {
      folderId: 'f1',
      parentFolderId: null,
      name: '00_RECEIVED',
      displayOrder: 0,
      enabled: true,
      semanticRole: null,
    },
    {
      folderId: 'f2',
      parentFolderId: null,
      name: '01_WORKING',
      displayOrder: 1,
      enabled: true,
      semanticRole: null,
    },
    {
      folderId: 'f3',
      parentFolderId: null,
      name: '03_DRAWINGS',
      displayOrder: 2,
      enabled: true,
      semanticRole: null,
    },
    {
      folderId: 'f4',
      parentFolderId: null,
      name: '04_TECHNICAL',
      displayOrder: 3,
      enabled: true,
      semanticRole: null,
    },
    {
      folderId: 'f5',
      parentFolderId: 'f4',
      name: 'DATASHEETS',
      displayOrder: 0,
      enabled: true,
      semanticRole: null,
    },
    {
      folderId: 'f6',
      parentFolderId: 'f4',
      name: 'BOQ',
      displayOrder: 1,
      enabled: true,
      semanticRole: null,
    },
    {
      folderId: 'f7',
      parentFolderId: null,
      name: '05_DELIVERABLES',
      displayOrder: 4,
      enabled: true,
      semanticRole: null,
    },
  ],
};

const workspace: ManageStructureWorkspace = {
  folderPath: 'C:\\Projects\\001_SCT260807_DUBAI_HILLS_VILLA',
  folderSnapshot: snapshot,
  outputMappings: [
    { outputTypeId: 'boqExcel', destinationFolderId: 'f6', unresolved: false, legacyPath: null },
    { outputTypeId: 'boqPdf', destinationFolderId: 'f6', unresolved: false, legacyPath: null },
    { outputTypeId: 'datasheets', destinationFolderId: 'f5', unresolved: false, legacyPath: null },
    {
      outputTypeId: 'scheduleExcel',
      destinationFolderId: 'f7',
      unresolved: false,
      legacyPath: null,
    },
    { outputTypeId: 'schedulePdf', destinationFolderId: 'f7', unresolved: false, legacyPath: null },
  ],
  folderConfigurationFingerprint: 'fingerprint-1',
};

const project: Project = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  projectCode: '001_SCT260807_DUBAI_HILLS_VILLA',
  projectName: 'Dubai Hills Villa',
  clientName: 'Private Client',
  crmReference: 'CRM-48572',
  projectType: 'Villa Lighting Design',
  description: 'Test',
  salesOwnerId: '11111111-1111-4111-8111-111111111111',
  salesOwnerNameSnapshot: 'Maya Hassan',
  salesOwnerEmailSnapshot: 'maya@example.com',
  createdById: '11111111-1111-4111-8111-111111111111',
  createdByNameSnapshot: 'Maya Hassan',
  createdByEmailSnapshot: 'maya@example.com',
  assignedDesignerId: null,
  assignedDesignerNameSnapshot: null,
  collaboratorDesignerIds: [],
  collaboratorDesignerNameSnapshots: [],
  siteLocation: 'Dubai Hills',
  designStage: 'Concept',
  lightingScope: 'Villa lighting',
  luxRequirements: '',
  drawingReference: '',
  status: 'InProgress',
  priority: 'Normal',
  complexity: 'Medium',
  estimatedHours: 24,
  actualHours: 0,
  progressPercent: 0,
  requiredDeliveryDate: '2026-08-20',
  projectFolderUrl: null,
  projectFolderPath: workspace.folderPath,
  folderProfile: 'Full Lighting Design',
  services: ['LightingDesign', 'TechnicalBoq', 'Datasheets'],
  revisionNumber: 0,
  createdAt: '2026-08-07T00:00:00.000Z',
  updatedAt: '2026-08-07T00:00:00.000Z',
  completedAt: null,
  cancelledAt: null,
  version: 1,
};

function renderDrawer() {
  return render(
    <ToastProvider>
      <ManageStructureDrawer
        projectId={project.id}
        project={project}
        workspace={workspace}
        onClose={vi.fn()}
        onChanged={vi.fn().mockResolvedValue(undefined)}
      />
    </ToastProvider>,
  );
}

beforeEach(() => {
  mockedApiRequest.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ManageStructureDrawer', () => {
  it('renders the read-only project root, folder tree, disabled states, and output badges', () => {
    renderDrawer();
    expect(screen.getByRole('dialog', { name: 'Manage Structure' })).toBeTruthy();
    expect(screen.getByText('001_SCT260807_DUBAI_HILLS_VILLA')).toBeTruthy();
    expect(screen.getByText('Read-only project root')).toBeTruthy();
    expect(screen.getByText('00_RECEIVED')).toBeTruthy();
    expect(screen.getByText('04_TECHNICAL')).toBeTruthy();
    expect(screen.getByText('DATASHEETS')).toBeTruthy();
    expect(screen.getByText('Datasheets')).toBeTruthy();
    expect(screen.getByText('BOQ ? Excel')).toBeTruthy();
  });

  it('shows contextual actions when a folder is selected', async () => {
    const user = userEvent.setup();
    renderDrawer();
    await user.click(screen.getByText('03_DRAWINGS'));
    expect(screen.getByRole('button', { name: 'Add child' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete empty' })).toBeTruthy();
  });

  it('shows a path-change warning for a non-empty folder before confirming a rename', async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      action: 'rename',
      folderId: 'f3',
      currentRelativePath: '03_DRAWINGS',
      proposedRelativePath: '03_LIGHTING_DRAWINGS',
      containsEntries: true,
      indexedFileCount: 2,
      affectedDescendantCount: 0,
      outputMappings: [],
      warnings: [
        'This folder contains files or subfolders. External references such as AutoCAD Xrefs, Revit links, DIALux references, and 3ds Max links may need to be relinked after the rename.',
      ],
      folderConfigurationFingerprint: 'fingerprint-2',
    });
    mockedApiRequest.mockResolvedValueOnce({
      action: 'rename',
      folderId: 'f3',
      folderConfigurationFingerprint: 'fingerprint-3',
      workspace,
    });
    renderDrawer();
    await user.click(screen.getByText('03_DRAWINGS'));
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText('New folder name');
    await user.clear(input);
    await user.type(input, '03_LIGHTING_DRAWINGS');
    await user.click(screen.getByRole('button', { name: 'Preview changes' }));
    expect(await screen.findByText('03_LIGHTING_DRAWINGS')).toBeTruthy();
    expect(screen.getByText(/Current:/)).toBeTruthy();
    expect(screen.getByText(/Proposed:/)).toBeTruthy();
    expect(screen.getByText(/AutoCAD Xrefs/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Confirm rename' }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/api/projects/${project.id}/folder-actions`,
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({
            action: 'rename',
            folderId: 'f3',
            name: '03_LIGHTING_DRAWINGS',
            expectedFolderConfigurationFingerprint: 'fingerprint-2',
          }),
        }),
      );
    });
  });

  it('only enables Delete Empty after the server preview confirms the folder is empty', async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      action: 'delete-empty',
      folderId: 'f1',
      currentRelativePath: '00_RECEIVED',
      proposedRelativePath: null,
      containsEntries: false,
      indexedFileCount: 0,
      affectedDescendantCount: 0,
      outputMappings: [],
      warnings: [],
      folderConfigurationFingerprint: 'fingerprint-2',
    });
    renderDrawer();
    await user.click(screen.getByText('00_RECEIVED'));
    await user.click(screen.getByRole('button', { name: 'Delete empty' }));
    expect(screen.queryByRole('button', { name: 'Delete empty folder' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check folder' }));
    expect(await screen.findByRole('button', { name: 'Delete empty folder' })).toBeTruthy();
  });

  it('does not offer a delete button when the folder is not empty', async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      action: 'delete-empty',
      folderId: 'f3',
      currentRelativePath: '03_DRAWINGS',
      proposedRelativePath: null,
      containsEntries: true,
      indexedFileCount: 1,
      affectedDescendantCount: 0,
      outputMappings: [],
      warnings: ['This folder is not empty and cannot be deleted.'],
      folderConfigurationFingerprint: 'fingerprint-2',
    });
    renderDrawer();
    await user.click(screen.getByText('03_DRAWINGS'));
    await user.click(screen.getByRole('button', { name: 'Delete empty' }));
    await user.click(screen.getByRole('button', { name: 'Check folder' }));
    expect(await screen.findByText(/not empty/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete empty folder' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete Anyway' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Force Delete' })).toBeNull();
  });

  it('states that files remain on disk when disabling a folder', async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      action: 'disable',
      folderId: 'f1',
      folderConfigurationFingerprint: 'fingerprint-2',
      workspace,
    });
    renderDrawer();
    await user.click(screen.getByText('00_RECEIVED'));
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    expect(screen.getByText(/Files remain on disk/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Disable folder' }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/api/projects/${project.id}/folder-actions`,
        expect.objectContaining({
          body: expect.objectContaining({ action: 'disable', folderId: 'f1' }),
        }),
      );
    });
  });

  it('reorders siblings only and never exposes a cross-parent drag move', async () => {
    const user = userEvent.setup();
    mockedApiRequest.mockResolvedValueOnce({
      action: 'reorder',
      folderId: 'f2',
      folderConfigurationFingerprint: 'fingerprint-2',
      workspace,
    });
    renderDrawer();
    const rows = document.querySelectorAll('.structure-tree-row');
    for (const row of Array.from(rows)) {
      expect(row.getAttribute('draggable')).not.toBe('true');
    }
    await user.click(screen.getByText('01_WORKING'));
    await user.click(screen.getByRole('button', { name: 'Move 01_WORKING up' }));
    await waitFor(() => {
      expect(mockedApiRequest).toHaveBeenCalledWith(
        `/api/projects/${project.id}/folder-actions`,
        expect.objectContaining({
          body: expect.objectContaining({ action: 'reorder', folderId: 'f2', newDisplayOrder: 0 }),
        }),
      );
    });
  });
});
