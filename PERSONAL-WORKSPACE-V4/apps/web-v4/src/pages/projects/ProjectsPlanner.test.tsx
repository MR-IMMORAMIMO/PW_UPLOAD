/** @vitest-environment jsdom */
import type { ComponentProps, ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project, ProjectStatus } from '@scli/domain';
import { ProjectsPlanner } from './ProjectsViews';

const dnd = vi.hoisted(() => ({
  handlers: null as null | {
    onDragStart: (event: { active: { id: string } }) => void;
    onDragOver: (event: { over: { id: string } | null }) => void;
    onDragCancel: () => void;
    onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void;
  },
  overId: null as string | null,
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({
    children,
    ...props
  }: {
    children: ReactNode;
    onDragStart: (event: { active: { id: string } }) => void;
    onDragOver: (event: { over: { id: string } | null }) => void;
    onDragCancel: () => void;
    onDragEnd: (event: { active: { id: string }; over: { id: string } | null }) => void;
  }) => {
    dnd.handlers = props;
    return <>{children}</>;
  },
  DragOverlay: ({ children }: { children: ReactNode }) => (
    <div data-testid="drag-overlay">{children}</div>
  ),
  KeyboardSensor: function KeyboardSensor() {},
  MouseSensor: function MouseSensor() {},
  TouchSensor: function TouchSensor() {},
  closestCenter: vi.fn(),
  useDraggable: ({ disabled }: { disabled?: boolean }) => ({
    attributes: disabled ? {} : { 'data-dnd-attributes': 'ready' },
    listeners: disabled ? {} : { 'data-dnd-listeners': 'ready' },
    setNodeRef: vi.fn(),
    transform: null,
    isDragging: false,
  }),
  useDroppable: ({ id }: { id: string }) => ({
    setNodeRef: vi.fn(),
    isOver: dnd.overId === id,
  }),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
}));

const PROJECT_ID = '10000000-0000-4000-8000-000000000001';

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    projectCode: '001_SCT260809_TEST',
    projectName: 'Test project',
    clientName: 'Client',
    projectType: 'Hospitality',
    description: '',
    salesOwnerId: '20000000-0000-4000-8000-000000000001',
    salesOwnerNameSnapshot: 'Sales Owner',
    salesOwnerEmailSnapshot: 'sales@example.com',
    createdById: '20000000-0000-4000-8000-000000000001',
    createdByNameSnapshot: 'Sales Owner',
    createdByEmailSnapshot: 'sales@example.com',
    assignedDesignerId: null,
    assignedDesignerNameSnapshot: null,
    collaboratorDesignerIds: [],
    collaboratorDesignerNameSnapshots: [],
    siteLocation: 'Dubai',
    designStage: 'DetailedDesign',
    lightingScope: '',
    luxRequirements: '',
    drawingReference: '',
    status: 'Planning',
    priority: 'High',
    complexity: 'Medium',
    estimatedHours: 20,
    actualHours: 8,
    progressPercent: 40,
    requiredDeliveryDate: '2026-08-25',
    projectFolderUrl: null,
    projectFolderPath: 'C:\\Projects\\Test',
    revisionNumber: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
    completedAt: null,
    cancelledAt: null,
    version: 1,
    ...overrides,
  };
}

function renderPlanner({
  status = 'Planning',
  pending = false,
}: {
  status?: ProjectStatus;
  pending?: boolean;
} = {}) {
  const onMove = vi.fn();
  const props: ComponentProps<typeof ProjectsPlanner> = {
    projects: [project({ status })],
    now: new Date('2026-08-17T08:00:00.000Z'),
    activeProjectId: null,
    pendingProjectIds: new Set(pending ? [PROJECT_ID] : []),
    actionPending: false,
    manager: true,
    openMenuId: null,
    onToggleMenu: vi.fn(),
    onOpen: vi.fn(),
    onEdit: vi.fn(),
    onOpenFolder: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onRemove: vi.fn(),
    onMove,
  };
  render(<ProjectsPlanner {...props} />);
  return { onMove, props };
}

function dragStart() {
  act(() => dnd.handlers?.onDragStart({ active: { id: PROJECT_ID } }));
}

function dragEnd(target: ProjectStatus) {
  act(() =>
    dnd.handlers?.onDragEnd({
      active: { id: PROJECT_ID },
      over: { id: `status:${target}` },
    }),
  );
}

afterEach(() => {
  cleanup();
  dnd.handlers = null;
  dnd.overId = null;
  vi.clearAllMocks();
});

describe('ProjectsPlanner drag behavior', () => {
  it('shows the overlay and marks a valid target while dragging', () => {
    renderPlanner();
    expect(screen.getByTestId('drag-overlay')).toBeEmptyDOMElement();
    dragStart();
    expect(screen.getByTestId('drag-overlay')).toHaveTextContent('Test project');

    dnd.overId = 'status:InProgress';
    act(() => dnd.handlers?.onDragOver({ over: { id: 'status:InProgress' } }));
    expect(document.querySelector('[data-status="InProgress"]')).toHaveAttribute(
      'data-drop-state',
      'valid-over',
    );
    expect(document.querySelector('[data-status="Completed"]')).toHaveAttribute(
      'data-drop-state',
      'invalid',
    );
  });

  it('submits one valid move and ignores same-lane and invalid drops', () => {
    const { onMove } = renderPlanner();
    dragStart();
    dragEnd('InProgress');
    expect(onMove).toHaveBeenCalledOnce();
    expect(onMove).toHaveBeenCalledWith(expect.objectContaining({ id: PROJECT_ID }), 'InProgress');

    dragStart();
    dragEnd('Planning');
    dragStart();
    dragEnd('Completed');
    expect(onMove).toHaveBeenCalledOnce();
  });

  it('clears the overlay on cancel and disables dragging while a save is pending', () => {
    const { props } = renderPlanner();
    dragStart();
    act(() => dnd.handlers?.onDragCancel());
    expect(screen.getByTestId('drag-overlay')).toBeEmptyDOMElement();
    cleanup();

    render(<ProjectsPlanner {...props} pendingProjectIds={new Set([PROJECT_ID])} />);
    const card = screen.getByText('Test project').closest('article');
    expect(card).toHaveAttribute('data-draggable', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Saving status');
  });
});
