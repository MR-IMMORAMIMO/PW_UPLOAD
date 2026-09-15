import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  CorrectTimeEntryInput,
  StartTimeEntryInput,
  TimesheetQueryInput,
} from '@scli/contracts';
import {
  assertPermission,
  canViewProject,
  DomainError,
  isManager,
  isProjectDesigner,
  requireFound,
  workCategories,
  type AppNotification,
  type AppUser,
  type DataProvider,
  type Project,
  type ProjectActivity,
  type ProjectTimesheet,
  type TimeEntry,
  type TimeTrackingOverview,
  type TimesheetStatus,
} from '@scli/domain';

type Clock = () => Date;

const timeEventSchema = z.object({
  entryId: z.string().uuid(),
  userId: z.string().uuid(),
  userNameSnapshot: z.string().min(1).max(120),
  at: z.string().datetime(),
  workCategory: z.enum(workCategories).optional(),
  note: z.string().max(500).optional(),
  durationMinutes: z.number().int().min(0).max(1_440).optional(),
  reason: z.string().max(500).optional(),
});

const timesheetEventSchema = z.object({
  userId: z.string().uuid(),
  userNameSnapshot: z.string().min(1).max(120),
  at: z.string().datetime(),
  reason: z.string().max(500).optional(),
});

type TimeEvent = z.infer<typeof timeEventSchema>;
type TimesheetEvent = z.infer<typeof timesheetEventSchema>;

interface RuntimeEntry extends TimeEntry {
  accumulatedMinutes: number;
  runningSince: string | null;
}

interface RuntimeTimesheet {
  status: TimesheetStatus;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedByNameSnapshot: string | null;
  reviewReason: string | null;
  userNameSnapshot: string;
}

const timeActions = new Set<ProjectActivity['actionType']>([
  'TimeStarted',
  'TimePaused',
  'TimeResumed',
  'TimeStopped',
  'TimeEntryCorrected',
]);

const timesheetActions = new Set<ProjectActivity['actionType']>([
  'TimesheetSubmitted',
  'TimesheetApproved',
  'TimesheetRejected',
]);

function minutesBetween(from: string, to: string): number {
  return Math.max(0, (new Date(to).getTime() - new Date(from).getTime()) / 60_000);
}

function parseTimeEvent(activity: ProjectActivity): TimeEvent | null {
  if (!timeActions.has(activity.actionType) || !activity.newValue) return null;
  try {
    const parsed = timeEventSchema.safeParse(JSON.parse(activity.newValue) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function parseTimesheetEvent(activity: ProjectActivity): TimesheetEvent | null {
  if (!timesheetActions.has(activity.actionType) || !activity.newValue) return null;
  try {
    const parsed = timesheetEventSchema.safeParse(JSON.parse(activity.newValue) as unknown);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function defaultTimesheet(userNameSnapshot: string): RuntimeTimesheet {
  return {
    status: 'Draft',
    submittedAt: null,
    reviewedAt: null,
    reviewedByNameSnapshot: null,
    reviewReason: null,
    userNameSnapshot,
  };
}

function publicTimeEntry(entry: RuntimeEntry): TimeEntry {
  return {
    id: entry.id,
    projectId: entry.projectId,
    projectCode: entry.projectCode,
    projectName: entry.projectName,
    userId: entry.userId,
    userNameSnapshot: entry.userNameSnapshot,
    workCategory: entry.workCategory,
    note: entry.note,
    status: entry.status,
    startedAt: entry.startedAt,
    pausedAt: entry.pausedAt,
    stoppedAt: entry.stoppedAt,
    durationMinutes: entry.durationMinutes,
    updatedAt: entry.updatedAt,
  };
}

export function buildProjectTimesheets(
  project: Project,
  activities: ProjectActivity[],
  now: Date,
): ProjectTimesheet[] {
  const entries = new Map<string, RuntimeEntry>();
  const states = new Map<string, RuntimeTimesheet>();
  const ordered = [...activities].sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const activity of ordered) {
    const timeEvent = parseTimeEvent(activity);
    if (timeEvent) {
      let entry = entries.get(timeEvent.entryId);
      if (activity.actionType === 'TimeStarted' && timeEvent.workCategory) {
        entry = {
          id: timeEvent.entryId,
          projectId: project.id,
          projectCode: project.projectCode,
          projectName: project.projectName,
          userId: timeEvent.userId,
          userNameSnapshot: timeEvent.userNameSnapshot,
          workCategory: timeEvent.workCategory,
          note: timeEvent.note ?? '',
          status: 'Running',
          startedAt: timeEvent.at,
          pausedAt: null,
          stoppedAt: null,
          durationMinutes: 0,
          updatedAt: timeEvent.at,
          accumulatedMinutes: 0,
          runningSince: timeEvent.at,
        };
        entries.set(entry.id, entry);
        if (!states.has(entry.userId)) {
          states.set(entry.userId, defaultTimesheet(entry.userNameSnapshot));
        }
        continue;
      }
      if (!entry) continue;

      if (
        activity.actionType === 'TimePaused' &&
        entry.status === 'Running' &&
        entry.runningSince
      ) {
        entry.accumulatedMinutes += minutesBetween(entry.runningSince, timeEvent.at);
        entry.runningSince = null;
        entry.pausedAt = timeEvent.at;
        entry.status = 'Paused';
      } else if (activity.actionType === 'TimeResumed' && entry.status === 'Paused') {
        entry.runningSince = timeEvent.at;
        entry.pausedAt = null;
        entry.status = 'Running';
      } else if (activity.actionType === 'TimeStopped' && entry.status !== 'Stopped') {
        if (entry.status === 'Running' && entry.runningSince) {
          entry.accumulatedMinutes += minutesBetween(entry.runningSince, timeEvent.at);
        }
        entry.runningSince = null;
        entry.pausedAt = null;
        entry.status = 'Stopped';
        entry.stoppedAt = timeEvent.at;
        entry.durationMinutes =
          timeEvent.durationMinutes ?? Math.max(1, Math.round(entry.accumulatedMinutes));
      } else if (activity.actionType === 'TimeEntryCorrected' && entry.status === 'Stopped') {
        if (timeEvent.workCategory) entry.workCategory = timeEvent.workCategory;
        entry.note = timeEvent.note ?? entry.note;
        if (timeEvent.durationMinutes !== undefined) {
          entry.durationMinutes = timeEvent.durationMinutes;
          entry.accumulatedMinutes = timeEvent.durationMinutes;
        }
      }
      entry.updatedAt = timeEvent.at;
      continue;
    }

    const sheetEvent = parseTimesheetEvent(activity);
    if (!sheetEvent) continue;
    const state = states.get(sheetEvent.userId) ?? defaultTimesheet(sheetEvent.userNameSnapshot);
    state.userNameSnapshot = sheetEvent.userNameSnapshot;
    if (activity.actionType === 'TimesheetSubmitted') {
      state.status = 'Submitted';
      state.submittedAt = sheetEvent.at;
      state.reviewedAt = null;
      state.reviewedByNameSnapshot = null;
      state.reviewReason = null;
    } else if (activity.actionType === 'TimesheetApproved') {
      state.status = 'Approved';
      state.reviewedAt = sheetEvent.at;
      state.reviewedByNameSnapshot = activity.changedByNameSnapshot;
      state.reviewReason = sheetEvent.reason ?? null;
    } else if (activity.actionType === 'TimesheetRejected') {
      state.status = 'Rejected';
      state.reviewedAt = sheetEvent.at;
      state.reviewedByNameSnapshot = activity.changedByNameSnapshot;
      state.reviewReason = sheetEvent.reason ?? null;
    }
    states.set(sheetEvent.userId, state);
  }

  const nowText = now.toISOString();
  for (const entry of entries.values()) {
    if (entry.status === 'Running' && entry.runningSince) {
      entry.durationMinutes = Math.max(
        0,
        Math.round(entry.accumulatedMinutes + minutesBetween(entry.runningSince, nowText)),
      );
    } else if (entry.status === 'Paused') {
      entry.durationMinutes = Math.max(0, Math.round(entry.accumulatedMinutes));
    }
  }

  return [...states.entries()]
    .map(([userId, state]) => {
      const userEntries = [...entries.values()]
        .filter((entry) => entry.userId === userId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(publicTimeEntry);
      return {
        projectId: project.id,
        projectCode: project.projectCode,
        projectName: project.projectName,
        userId,
        userNameSnapshot: state.userNameSnapshot,
        status: state.status,
        entries: userEntries,
        totalMinutes: userEntries.reduce((sum, entry) => sum + entry.durationMinutes, 0),
        submittedAt: state.submittedAt,
        reviewedAt: state.reviewedAt,
        reviewedByNameSnapshot: state.reviewedByNameSnapshot,
        reviewReason: state.reviewReason,
      } satisfies ProjectTimesheet;
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes);
}

function eventActivity(
  actor: AppUser,
  projectId: string,
  actionType: ProjectActivity['actionType'],
  message: string,
  at: string,
  payload: TimeEvent | TimesheetEvent,
): ProjectActivity {
  return {
    id: randomUUID(),
    projectId,
    actionType,
    fieldName: null,
    oldValue: null,
    newValue: JSON.stringify(payload),
    message,
    changedById: actor.id,
    changedByNameSnapshot: actor.displayName,
    createdAt: at,
  };
}

function notification(
  recipientUserId: string,
  type: AppNotification['type'],
  title: string,
  message: string,
  projectId: string,
  createdAt: string,
): AppNotification {
  return {
    id: randomUUID(),
    recipientUserId,
    type,
    title,
    message,
    projectId,
    isRead: false,
    createdAt,
  };
}

export class TimeTrackingService {
  private mutationQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly provider: DataProvider,
    private readonly clock: Clock = () => new Date(),
  ) {}

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation);
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async project(actor: AppUser, projectId: string): Promise<Project> {
    const project = requireFound(await this.provider.getProject(projectId), 'Project not found.');
    assertPermission(canViewProject(actor, project), 'You do not have access to this project.');
    return project;
  }

  private async projectSheets(project: Project): Promise<ProjectTimesheet[]> {
    return buildProjectTimesheets(
      project,
      await this.provider.listActivities(project.id),
      this.clock(),
    );
  }

  public async listProjectTimesheets(
    actor: AppUser,
    projectId: string,
  ): Promise<ProjectTimesheet[]> {
    const project = await this.project(actor, projectId);
    let sheets = await this.projectSheets(project);
    if (actor.role === 'Designer') sheets = sheets.filter((sheet) => sheet.userId === actor.id);
    if (actor.role === 'Sales') {
      sheets = sheets.map((sheet) => ({ ...sheet, entries: [] }));
    }
    return sheets;
  }

  public async listTimesheets(
    actor: AppUser,
    query: TimesheetQueryInput = {},
  ): Promise<ProjectTimesheet[]> {
    assertPermission(
      actor.role === 'Designer' || isManager(actor),
      'Timesheets are available to Lighting Designers and managers.',
    );
    const projects = (await this.provider.listProjects()).filter((project) =>
      canViewProject(actor, project),
    );
    const nested = await Promise.all(projects.map((project) => this.projectSheets(project)));
    return nested
      .flat()
      .filter((sheet) => (actor.role === 'Designer' ? sheet.userId === actor.id : true))
      .filter((sheet) => (query.status ? sheet.status === query.status : true))
      .filter((sheet) => (query.projectId ? sheet.projectId === query.projectId : true))
      .filter((sheet) => (query.userId ? sheet.userId === query.userId : true))
      .sort((a, b) => {
        const left = a.submittedAt ?? a.entries[0]?.updatedAt ?? '';
        const right = b.submittedAt ?? b.entries[0]?.updatedAt ?? '';
        return right.localeCompare(left);
      });
  }

  public async overview(actor: AppUser): Promise<TimeTrackingOverview> {
    const timesheets = await this.listTimesheets(actor);
    const entries = timesheets.flatMap((sheet) => sheet.entries);
    const activeTimer =
      entries.find((entry) => entry.status === 'Running' || entry.status === 'Paused') ?? null;
    const today = this.clock().toISOString().slice(0, 10);
    const weekStart = new Date(this.clock());
    const day = weekStart.getUTCDay();
    weekStart.setUTCDate(weekStart.getUTCDate() - ((day + 6) % 7));
    weekStart.setUTCHours(0, 0, 0, 0);
    const ownEntries = entries.filter((entry) => entry.userId === actor.id);
    return {
      activeTimer,
      todayMinutes: ownEntries
        .filter((entry) => entry.startedAt.slice(0, 10) === today)
        .reduce((sum, entry) => sum + entry.durationMinutes, 0),
      weekMinutes: ownEntries
        .filter((entry) => new Date(entry.startedAt) >= weekStart)
        .reduce((sum, entry) => sum + entry.durationMinutes, 0),
      draftTimesheets: timesheets.filter(
        (sheet) =>
          sheet.userId === actor.id && (sheet.status === 'Draft' || sheet.status === 'Rejected'),
      ).length,
      pendingApprovals: timesheets.filter((sheet) => sheet.status === 'Submitted').length,
      timesheets,
    };
  }

  public async start(
    actor: AppUser,
    projectId: string,
    input: StartTimeEntryInput,
  ): Promise<TimeEntry> {
    return this.exclusive(async () => {
      assertPermission(
        actor.role === 'Designer',
        'Only Lighting Designers can track project time.',
      );
      const project = await this.project(actor, projectId);
      assertPermission(
        isProjectDesigner(actor, project),
        'Only an assigned Lighting Designer can track time on this project.',
      );
      if (['Completed', 'Cancelled', 'Archived', 'Unassigned'].includes(project.status)) {
        throw new DomainError(
          'INVALID_TRANSITION',
          'Time cannot be started in this project state.',
          409,
        );
      }

      const existing = await this.overview(actor);
      if (existing.activeTimer) {
        throw new DomainError(
          'CONFLICT',
          `Stop the active or paused timer on ${existing.activeTimer.projectCode} first.`,
          409,
          { activeEntryId: existing.activeTimer.id, projectId: existing.activeTimer.projectId },
        );
      }
      const currentSheet = (await this.projectSheets(project)).find(
        (sheet) => sheet.userId === actor.id,
      );
      if (currentSheet?.status === 'Submitted' || currentSheet?.status === 'Approved') {
        throw new DomainError(
          'CONFLICT',
          'This timesheet is locked while it is submitted or approved.',
          409,
        );
      }

      const at = this.clock().toISOString();
      const entryId = randomUUID();
      const payload: TimeEvent = {
        entryId,
        userId: actor.id,
        userNameSnapshot: actor.displayName,
        workCategory: input.workCategory,
        note: input.note,
        at,
      };
      const activities = [
        eventActivity(
          actor,
          project.id,
          'TimeStarted',
          `${actor.displayName} started ${input.workCategory} time.`,
          at,
          payload,
        ),
      ];
      if (project.status === 'Assigned') {
        await this.provider.updateProject(project.id, {
          status: 'InProgress',
          updatedAt: at,
          version: project.version + 1,
        });
        activities.push({
          id: randomUUID(),
          projectId: project.id,
          actionType: 'StatusChanged',
          fieldName: 'status',
          oldValue: 'Assigned',
          newValue: 'InProgress',
          message: `Work started by ${actor.displayName}.`,
          changedById: actor.id,
          changedByNameSnapshot: actor.displayName,
          createdAt: at,
        });
      }
      await this.provider.appendActivities(activities);
      return requireFound(
        (
          await this.projectSheets({
            ...project,
            status: project.status === 'Assigned' ? 'InProgress' : project.status,
          })
        )
          .find((sheet) => sheet.userId === actor.id)
          ?.entries.find((entry) => entry.id === entryId) ?? null,
        'Timer could not be started.',
      );
    });
  }

  private async ownEntry(
    actor: AppUser,
    projectId: string,
    entryId: string,
  ): Promise<{ project: Project; sheet: ProjectTimesheet; entry: TimeEntry }> {
    const project = await this.project(actor, projectId);
    const sheet = requireFound(
      (await this.projectSheets(project)).find((item) =>
        isManager(actor)
          ? item.entries.some((entry) => entry.id === entryId)
          : item.userId === actor.id,
      ) ?? null,
      'Timesheet not found.',
    );
    const entry = requireFound(
      sheet.entries.find((item) => item.id === entryId) ?? null,
      'Time entry not found.',
    );
    if (!isManager(actor)) {
      assertPermission(entry.userId === actor.id, 'You can only change your own time entries.');
    }
    return { project, sheet, entry };
  }

  public async pause(actor: AppUser, projectId: string, entryId: string): Promise<TimeEntry> {
    const { project, entry } = await this.ownEntry(actor, projectId, entryId);
    assertPermission(actor.role === 'Designer', 'Only Lighting Designers can pause timers.');
    if (entry.status !== 'Running') {
      throw new DomainError('CONFLICT', 'Only a running timer can be paused.', 409);
    }
    const at = this.clock().toISOString();
    await this.provider.appendActivities([
      eventActivity(actor, project.id, 'TimePaused', `${actor.displayName} paused the timer.`, at, {
        entryId,
        userId: actor.id,
        userNameSnapshot: actor.displayName,
        at,
      }),
    ]);
    return requireFound(
      (await this.projectSheets(project))
        .flatMap((sheet) => sheet.entries)
        .find((item) => item.id === entryId) ?? null,
      'Timer could not be paused.',
    );
  }

  public async resume(actor: AppUser, projectId: string, entryId: string): Promise<TimeEntry> {
    const { project, entry } = await this.ownEntry(actor, projectId, entryId);
    assertPermission(actor.role === 'Designer', 'Only Lighting Designers can resume timers.');
    if (entry.status !== 'Paused') {
      throw new DomainError('CONFLICT', 'Only a paused timer can be resumed.', 409);
    }
    const overview = await this.overview(actor);
    if (overview.activeTimer && overview.activeTimer.id !== entryId) {
      throw new DomainError('CONFLICT', 'Another project timer is already active.', 409);
    }
    const at = this.clock().toISOString();
    await this.provider.appendActivities([
      eventActivity(
        actor,
        project.id,
        'TimeResumed',
        `${actor.displayName} resumed the timer.`,
        at,
        {
          entryId,
          userId: actor.id,
          userNameSnapshot: actor.displayName,
          at,
        },
      ),
    ]);
    return requireFound(
      (await this.projectSheets(project))
        .flatMap((sheet) => sheet.entries)
        .find((item) => item.id === entryId) ?? null,
      'Timer could not be resumed.',
    );
  }

  public async stop(actor: AppUser, projectId: string, entryId: string): Promise<TimeEntry> {
    const { project, entry } = await this.ownEntry(actor, projectId, entryId);
    assertPermission(actor.role === 'Designer', 'Only Lighting Designers can stop timers.');
    if (entry.status === 'Stopped') {
      throw new DomainError('CONFLICT', 'This timer is already stopped.', 409);
    }
    const at = this.clock().toISOString();
    const durationMinutes = Math.max(1, entry.durationMinutes);
    await this.provider.appendActivities([
      eventActivity(
        actor,
        project.id,
        'TimeStopped',
        `${actor.displayName} stopped the timer after ${durationMinutes} minutes.`,
        at,
        {
          entryId,
          userId: actor.id,
          userNameSnapshot: actor.displayName,
          at,
          durationMinutes,
        },
      ),
    ]);
    await this.provider.updateProject(project.id, {
      actualHours: Math.round((project.actualHours + durationMinutes / 60) * 100) / 100,
      updatedAt: at,
      version: project.version + 1,
    });
    return requireFound(
      (await this.projectSheets(project))
        .flatMap((sheet) => sheet.entries)
        .find((item) => item.id === entryId) ?? null,
      'Timer could not be stopped.',
    );
  }

  public async correct(
    actor: AppUser,
    projectId: string,
    entryId: string,
    input: CorrectTimeEntryInput,
  ): Promise<TimeEntry> {
    const { project, sheet, entry } = await this.ownEntry(actor, projectId, entryId);
    assertPermission(
      actor.id === entry.userId || isManager(actor),
      'You cannot correct this time entry.',
    );
    if (entry.status !== 'Stopped') {
      throw new DomainError('CONFLICT', 'Stop the timer before correcting the entry.', 409);
    }
    if (sheet.status === 'Submitted' || sheet.status === 'Approved') {
      throw new DomainError('CONFLICT', 'Submitted or approved timesheets are locked.', 409);
    }
    const at = this.clock().toISOString();
    await this.provider.appendActivities([
      eventActivity(
        actor,
        project.id,
        'TimeEntryCorrected',
        `Time entry corrected by ${actor.displayName}. Reason: ${input.reason}`,
        at,
        {
          entryId,
          userId: entry.userId,
          userNameSnapshot: entry.userNameSnapshot,
          workCategory: input.workCategory,
          note: input.note,
          durationMinutes: input.durationMinutes,
          reason: input.reason,
          at,
        },
      ),
    ]);
    await this.provider.updateProject(project.id, {
      actualHours:
        Math.round(
          Math.max(0, project.actualHours + (input.durationMinutes - entry.durationMinutes) / 60) *
            100,
        ) / 100,
      updatedAt: at,
      version: project.version + 1,
    });
    if (isManager(actor) && actor.id !== entry.userId) {
      await this.provider.addNotifications([
        notification(
          entry.userId,
          'ProjectUpdated',
          'Time entry corrected',
          `${actor.displayName} corrected a time entry on ${project.projectCode}.`,
          project.id,
          at,
        ),
      ]);
    }
    return requireFound(
      (await this.projectSheets(project))
        .flatMap((item) => item.entries)
        .find((item) => item.id === entryId) ?? null,
      'Time entry could not be corrected.',
    );
  }

  public async submit(actor: AppUser, projectId: string): Promise<ProjectTimesheet> {
    assertPermission(actor.role === 'Designer', 'Only Lighting Designers can submit timesheets.');
    const project = await this.project(actor, projectId);
    const sheet = requireFound(
      (await this.projectSheets(project)).find((item) => item.userId === actor.id) ?? null,
      'There is no time to submit for this project.',
    );
    if (!sheet.entries.length) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Add at least one time entry before submitting.',
        400,
      );
    }
    if (sheet.entries.some((entry) => entry.status !== 'Stopped')) {
      throw new DomainError('CONFLICT', 'Stop the active timer before submitting.', 409);
    }
    if (sheet.status === 'Submitted' || sheet.status === 'Approved') {
      throw new DomainError('CONFLICT', 'This timesheet is already locked.', 409);
    }
    const at = this.clock().toISOString();
    const payload: TimesheetEvent = {
      userId: actor.id,
      userNameSnapshot: actor.displayName,
      at,
    };
    await this.provider.appendActivities([
      eventActivity(
        actor,
        project.id,
        'TimesheetSubmitted',
        `${actor.displayName} submitted the project timesheet.`,
        at,
        payload,
      ),
    ]);
    const managers = (await this.provider.listUsers()).filter(
      (user) => user.isActive && isManager(user),
    );
    await this.provider.addNotifications(
      managers.map((manager) =>
        notification(
          manager.id,
          'TimesheetSubmitted',
          'Timesheet needs approval',
          `${actor.displayName} submitted ${project.projectCode} (${sheet.totalMinutes} minutes).`,
          project.id,
          at,
        ),
      ),
    );
    return requireFound(
      (await this.projectSheets(project)).find((item) => item.userId === actor.id) ?? null,
      'Timesheet could not be submitted.',
    );
  }

  public async review(
    actor: AppUser,
    projectId: string,
    userId: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ): Promise<ProjectTimesheet> {
    assertPermission(isManager(actor), 'Only Line Managers and Admins can review timesheets.');
    const project = await this.project(actor, projectId);
    const sheet = requireFound(
      (await this.projectSheets(project)).find((item) => item.userId === userId) ?? null,
      'Timesheet not found.',
    );
    if (sheet.status !== 'Submitted') {
      throw new DomainError('CONFLICT', 'Only submitted timesheets can be reviewed.', 409);
    }
    if (decision === 'reject' && (!reason || reason.trim().length < 5)) {
      throw new DomainError(
        'VALIDATION_ERROR',
        'Add a reason before returning the timesheet.',
        400,
      );
    }
    const user = requireFound(await this.provider.getUser(userId), 'Lighting Designer not found.');
    const at = this.clock().toISOString();
    const approved = decision === 'approve';
    await this.provider.appendActivities([
      eventActivity(
        actor,
        project.id,
        approved ? 'TimesheetApproved' : 'TimesheetRejected',
        approved
          ? `Timesheet approved by ${actor.displayName}.`
          : `Timesheet returned by ${actor.displayName}. Reason: ${reason}`,
        at,
        {
          userId,
          userNameSnapshot: user.displayName,
          at,
          ...(reason ? { reason } : {}),
        },
      ),
    ]);
    await this.provider.addNotifications([
      notification(
        userId,
        approved ? 'TimesheetApproved' : 'TimesheetRejected',
        approved ? 'Timesheet approved' : 'Timesheet needs changes',
        approved
          ? `${project.projectCode} was approved by ${actor.displayName}.`
          : `${project.projectCode} was returned: ${reason}`,
        project.id,
        at,
      ),
    ]);
    return requireFound(
      (await this.projectSheets(project)).find((item) => item.userId === userId) ?? null,
      'Timesheet review could not be saved.',
    );
  }
}
