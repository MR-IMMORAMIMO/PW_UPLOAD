import {
  ClientCertificateCredential,
  ClientSecretCredential,
  DefaultAzureCredential,
  type TokenCredential,
} from '@azure/identity';
import type { AppConfig } from '@scli/config';
import {
  DomainError,
  type ActivityActionType,
  type AppNotification,
  type AppSettings,
  type AppUser,
  type AvailabilityStatus,
  type DataProvider,
  type NotificationType,
  type Project,
  type ProjectActivity,
  type ProjectComment,
  type ProjectCreateRecord,
  type ProjectQuery,
  type ProjectStatus,
  type ProjectType,
  type Role,
} from '@scli/domain';

interface GraphListItem {
  id: string;
  eTag?: string;
  fields?: Record<string, unknown>;
}

interface GraphCollection<T> {
  value: T[];
  '@odata.nextLink'?: string;
}

type Fields = Record<string, unknown>;

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new DomainError(
      'CONFIGURATION_REQUIRED',
      `Microsoft 365 storage is missing ${name}.`,
      503,
    );
  }
  return value;
}

function stringField(fields: Fields, name: string, fallback = ''): string {
  const value = fields[name];
  return typeof value === 'string' ? value : fallback;
}

function nullableStringField(fields: Fields, name: string): string | null {
  const value = stringField(fields, name);
  return value || null;
}

function numberField(fields: Fields, name: string, fallback = 0): number {
  const value = fields[name];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanField(fields: Fields, name: string, fallback = false): boolean {
  const value = fields[name];
  return typeof value === 'boolean' ? value : fallback;
}

function itemFields(item: GraphListItem): Fields {
  if (!item.fields) throw new DomainError('CONFLICT', 'SharePoint item has no fields.', 502);
  return item.fields;
}

function toUser(item: GraphListItem): AppUser {
  const fields = itemFields(item);
  return {
    id: stringField(fields, 'SCLI_Id'),
    entraObjectId: stringField(fields, 'EntraObjectId'),
    displayName: stringField(fields, 'Title'),
    email: stringField(fields, 'Email'),
    jobTitle: stringField(fields, 'JobTitle'),
    department: stringField(fields, 'Department'),
    role: stringField(fields, 'AppRole') as Role,
    weeklyCapacityHours: numberField(fields, 'WeeklyCapacityHours'),
    availabilityStatus: stringField(
      fields,
      'AvailabilityStatus',
      'Available',
    ) as AvailabilityStatus,
    avatarUrl: nullableStringField(fields, 'AvatarUrl'),
    isActive: booleanField(fields, 'IsActive', true),
    createdAt: stringField(fields, 'CreatedAtUtc'),
    updatedAt: stringField(fields, 'UpdatedAtUtc'),
  };
}

function userFields(user: AppUser): Fields {
  return {
    Title: user.displayName,
    SCLI_Id: user.id,
    EntraObjectId: user.entraObjectId,
    Email: user.email,
    JobTitle: user.jobTitle,
    Department: user.department,
    AppRole: user.role,
    WeeklyCapacityHours: user.weeklyCapacityHours,
    AvailabilityStatus: user.availabilityStatus,
    AvatarUrl: user.avatarUrl,
    IsActive: user.isActive,
    CreatedAtUtc: user.createdAt,
    UpdatedAtUtc: user.updatedAt,
  };
}

function stringArrayField(fields: Fields, key: string): string[] {
  const value = nullableStringField(fields, key);
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
  } catch {
    return [];
  }
}

function toProject(item: GraphListItem): Project {
  const fields = itemFields(item);
  return {
    id: stringField(fields, 'SCLI_Id'),
    projectCode: stringField(fields, 'Title'),
    projectName: stringField(fields, 'ProjectName'),
    clientName: stringField(fields, 'ClientName'),
    projectType: stringField(fields, 'ProjectType'),
    description: stringField(fields, 'Description'),
    salesOwnerId: stringField(fields, 'SalesOwnerId'),
    salesOwnerNameSnapshot: stringField(fields, 'SalesOwnerName'),
    salesOwnerEmailSnapshot: stringField(fields, 'SalesOwnerEmail'),
    createdById: stringField(fields, 'CreatedById'),
    createdByNameSnapshot: stringField(fields, 'CreatedByName'),
    createdByEmailSnapshot: stringField(fields, 'CreatedByEmail'),
    assignedDesignerId: nullableStringField(fields, 'DesignerId'),
    assignedDesignerNameSnapshot: nullableStringField(fields, 'DesignerName'),
    collaboratorDesignerIds: stringArrayField(fields, 'CollaboratorDesignerIds'),
    collaboratorDesignerNameSnapshots: stringArrayField(fields, 'CollaboratorDesignerNames'),
    siteLocation: stringField(fields, 'SiteLocation', ''),
    designStage: stringField(fields, 'DesignStage', 'Concept') as Project['designStage'],
    lightingScope: stringField(fields, 'LightingScope', ''),
    luxRequirements: stringField(fields, 'LuxRequirements', ''),
    drawingReference: stringField(fields, 'DrawingReference', ''),
    status: stringField(fields, 'ProjectStatus') as ProjectStatus,
    priority: stringField(fields, 'Priority') as Project['priority'],
    complexity: stringField(fields, 'Complexity') as Project['complexity'],
    estimatedHours: numberField(fields, 'EstimatedHours'),
    actualHours: numberField(fields, 'ActualHours'),
    progressPercent: numberField(fields, 'ProgressPercent'),
    requiredDeliveryDate: stringField(fields, 'RequiredDeliveryDate').slice(0, 10),
    projectFolderUrl: nullableStringField(fields, 'ProjectFolderUrl'),
    revisionNumber: numberField(fields, 'RevisionNumber'),
    createdAt: stringField(fields, 'CreatedAtUtc'),
    updatedAt: stringField(fields, 'UpdatedAtUtc'),
    completedAt: nullableStringField(fields, 'CompletedAtUtc'),
    cancelledAt: nullableStringField(fields, 'CancelledAtUtc'),
    version: numberField(fields, 'RecordVersion', 1),
  };
}

function projectFields(project: Project, idempotencyKey?: string): Fields {
  return {
    Title: project.projectCode,
    SCLI_Id: project.id,
    ProjectName: project.projectName,
    ClientName: project.clientName,
    ProjectType: project.projectType,
    Description: project.description,
    SalesOwnerId: project.salesOwnerId,
    SalesOwnerName: project.salesOwnerNameSnapshot,
    SalesOwnerEmail: project.salesOwnerEmailSnapshot,
    CreatedById: project.createdById,
    CreatedByName: project.createdByNameSnapshot,
    CreatedByEmail: project.createdByEmailSnapshot,
    DesignerId: project.assignedDesignerId,
    DesignerName: project.assignedDesignerNameSnapshot,
    CollaboratorDesignerIds: JSON.stringify(project.collaboratorDesignerIds),
    CollaboratorDesignerNames: JSON.stringify(project.collaboratorDesignerNameSnapshots),
    SiteLocation: project.siteLocation,
    DesignStage: project.designStage,
    LightingScope: project.lightingScope,
    LuxRequirements: project.luxRequirements,
    DrawingReference: project.drawingReference,
    ProjectStatus: project.status,
    Priority: project.priority,
    Complexity: project.complexity,
    EstimatedHours: project.estimatedHours,
    ActualHours: project.actualHours,
    ProgressPercent: project.progressPercent,
    RequiredDeliveryDate: project.requiredDeliveryDate,
    ProjectFolderUrl: project.projectFolderUrl,
    RevisionNumber: project.revisionNumber,
    CreatedAtUtc: project.createdAt,
    UpdatedAtUtc: project.updatedAt,
    CompletedAtUtc: project.completedAt,
    CancelledAtUtc: project.cancelledAt,
    RecordVersion: project.version,
    ...(idempotencyKey ? { IdempotencyKey: idempotencyKey } : {}),
  };
}

function toActivity(item: GraphListItem): ProjectActivity {
  const fields = itemFields(item);
  return {
    id: stringField(fields, 'SCLI_Id'),
    projectId: stringField(fields, 'ProjectId'),
    actionType: stringField(fields, 'ActionType') as ActivityActionType,
    fieldName: nullableStringField(fields, 'FieldName'),
    oldValue: nullableStringField(fields, 'OldValue'),
    newValue: nullableStringField(fields, 'NewValue'),
    message: stringField(fields, 'Title'),
    changedById: stringField(fields, 'ChangedById'),
    changedByNameSnapshot: stringField(fields, 'ChangedByName'),
    createdAt: stringField(fields, 'CreatedAtUtc'),
  };
}

function activityFields(activity: ProjectActivity): Fields {
  return {
    Title: activity.message,
    SCLI_Id: activity.id,
    ProjectId: activity.projectId,
    ActionType: activity.actionType,
    FieldName: activity.fieldName,
    OldValue: activity.oldValue,
    NewValue: activity.newValue,
    ChangedById: activity.changedById,
    ChangedByName: activity.changedByNameSnapshot,
    CreatedAtUtc: activity.createdAt,
  };
}

function toComment(item: GraphListItem): ProjectComment {
  const fields = itemFields(item);
  return {
    id: stringField(fields, 'SCLI_Id'),
    projectId: stringField(fields, 'ProjectId'),
    body: stringField(fields, 'CommentBody'),
    authorId: stringField(fields, 'AuthorId'),
    authorNameSnapshot: stringField(fields, 'AuthorName'),
    attachmentUrl: nullableStringField(fields, 'AttachmentUrl'),
    createdAt: stringField(fields, 'CreatedAtUtc'),
    updatedAt: stringField(fields, 'UpdatedAtUtc'),
  };
}

function commentFields(comment: ProjectComment): Fields {
  return {
    Title: comment.body.slice(0, 200),
    SCLI_Id: comment.id,
    ProjectId: comment.projectId,
    CommentBody: comment.body,
    AuthorId: comment.authorId,
    AuthorName: comment.authorNameSnapshot,
    AttachmentUrl: comment.attachmentUrl,
    CreatedAtUtc: comment.createdAt,
    UpdatedAtUtc: comment.updatedAt,
  };
}

function toNotification(item: GraphListItem): AppNotification {
  const fields = itemFields(item);
  return {
    id: stringField(fields, 'SCLI_Id'),
    recipientUserId: stringField(fields, 'RecipientUserId'),
    type: stringField(fields, 'NotificationType') as NotificationType,
    title: stringField(fields, 'Title'),
    message: stringField(fields, 'Message'),
    projectId: nullableStringField(fields, 'ProjectId'),
    isRead: booleanField(fields, 'IsRead'),
    createdAt: stringField(fields, 'CreatedAtUtc'),
  };
}

function notificationFields(notification: AppNotification): Fields {
  return {
    Title: notification.title,
    SCLI_Id: notification.id,
    RecipientUserId: notification.recipientUserId,
    NotificationType: notification.type,
    Message: notification.message,
    ProjectId: notification.projectId,
    IsRead: notification.isRead,
    CreatedAtUtc: notification.createdAt,
  };
}

function toProjectType(item: GraphListItem): ProjectType {
  const fields = itemFields(item);
  return {
    id: stringField(fields, 'SCLI_Id'),
    name: stringField(fields, 'Title'),
    isActive: booleanField(fields, 'IsActive', true),
    createdAt: stringField(fields, 'CreatedAtUtc'),
    updatedAt: stringField(fields, 'UpdatedAtUtc'),
  };
}

function projectTypeFields(type: ProjectType): Fields {
  return {
    Title: type.name,
    SCLI_Id: type.id,
    IsActive: type.isActive,
    CreatedAtUtc: type.createdAt,
    UpdatedAtUtc: type.updatedAt,
  };
}

class GraphClient {
  public constructor(private readonly credential: TokenCredential) {}

  public async request<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
    const token = await this.credential.getToken('https://graph.microsoft.com/.default');
    if (!token) {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Microsoft Graph credential is unavailable.',
        503,
      );
    }
    const url = pathOrUrl.startsWith('https://')
      ? pathOrUrl
      : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
    let response: Response | null = null;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await fetch(url, {
        ...init,
        headers: {
          authorization: `Bearer ${token.token}`,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
      });
      if (![429, 502, 503, 504].includes(response.status) || attempt === 3) break;
      const retryAfter = Number(response.headers.get('retry-after') ?? 0);
      await new Promise((resolve) =>
        setTimeout(resolve, retryAfter > 0 ? retryAfter * 1000 : 200 * 2 ** attempt),
      );
    }
    if (!response?.ok) {
      const body = await response?.text();
      throw new DomainError(
        response?.status === 412 ? 'CONFLICT' : 'CONFIGURATION_REQUIRED',
        response?.status === 403
          ? 'The application does not have access to the configured SharePoint site.'
          : `Microsoft Graph request failed (${response?.status ?? 'network'}).`,
        response?.status === 412 ? 409 : 502,
        {
          graphStatus: response?.status,
          graphRequestId: response?.headers.get('request-id'),
          response: body?.slice(0, 500),
        },
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

export class SharePointDataProvider implements DataProvider {
  public readonly mode = 'm365' as const;
  private readonly graph: GraphClient;
  private readonly siteId: string;
  private readonly lists: Record<
    | 'users'
    | 'projects'
    | 'activities'
    | 'comments'
    | 'notifications'
    | 'sequence'
    | 'types'
    | 'settings',
    string
  >;
  private readonly sequenceItemId: string;

  public constructor(config: AppConfig, credential: TokenCredential) {
    this.graph = new GraphClient(credential);
    this.siteId = required(config.SHAREPOINT_SITE_ID, 'SHAREPOINT_SITE_ID');
    this.lists = {
      users: required(config.SP_LIST_APP_USERS_ID, 'SP_LIST_APP_USERS_ID'),
      projects: required(config.SP_LIST_PROJECTS_ID, 'SP_LIST_PROJECTS_ID'),
      activities: required(config.SP_LIST_ACTIVITIES_ID, 'SP_LIST_ACTIVITIES_ID'),
      comments: required(config.SP_LIST_COMMENTS_ID, 'SP_LIST_COMMENTS_ID'),
      notifications: required(config.SP_LIST_NOTIFICATIONS_ID, 'SP_LIST_NOTIFICATIONS_ID'),
      sequence: required(config.SP_LIST_SEQUENCE_ID, 'SP_LIST_SEQUENCE_ID'),
      types: required(config.SP_LIST_PROJECT_TYPES_ID, 'SP_LIST_PROJECT_TYPES_ID'),
      settings: required(config.SP_LIST_SETTINGS_ID, 'SP_LIST_SETTINGS_ID'),
    };
    this.sequenceItemId = required(config.SP_SEQUENCE_ITEM_ID, 'SP_SEQUENCE_ITEM_ID');
  }

  private itemPath(listId: string, suffix = ''): string {
    return `/sites/${encodeURIComponent(this.siteId)}/lists/${encodeURIComponent(listId)}/items${suffix}`;
  }

  private async listItems(listId: string): Promise<GraphListItem[]> {
    const result: GraphListItem[] = [];
    let next: string | undefined = `${this.itemPath(listId)}?$expand=fields&$top=200`;
    while (next) {
      const page: GraphCollection<GraphListItem> = await this.graph.request(next);
      result.push(...page.value);
      next = page['@odata.nextLink'];
    }
    return result;
  }

  private async createItem(listId: string, fields: Fields): Promise<GraphListItem> {
    return this.graph.request(this.itemPath(listId), {
      method: 'POST',
      body: JSON.stringify({ fields }),
    });
  }

  private async findByDomainId(listId: string, domainId: string): Promise<GraphListItem | null> {
    return (
      (await this.listItems(listId)).find(
        (item) => stringField(itemFields(item), 'SCLI_Id') === domainId,
      ) ?? null
    );
  }

  private async patchFields(
    listId: string,
    itemId: string,
    fields: Fields,
    eTag?: string,
  ): Promise<void> {
    await this.graph.request(`${this.itemPath(listId, `/${encodeURIComponent(itemId)}`)}/fields`, {
      method: 'PATCH',
      headers: eTag ? { 'if-match': eTag } : {},
      body: JSON.stringify(fields),
    });
  }

  public async listUsers(): Promise<AppUser[]> {
    return (await this.listItems(this.lists.users)).map(toUser);
  }

  public async getUser(id: string): Promise<AppUser | null> {
    const item = await this.findByDomainId(this.lists.users, id);
    return item ? toUser(item) : null;
  }

  public async getUserByEntraObjectId(entraObjectId: string): Promise<AppUser | null> {
    const item = (await this.listItems(this.lists.users)).find(
      (value) => stringField(itemFields(value), 'EntraObjectId') === entraObjectId,
    );
    return item ? toUser(item) : null;
  }

  public async createUser(user: AppUser): Promise<AppUser> {
    const duplicate = (await this.listUsers()).some(
      (item) => item.email.toLowerCase() === user.email.toLowerCase(),
    );
    if (duplicate) throw new DomainError('CONFLICT', 'A user with this email already exists.', 409);
    await this.createItem(this.lists.users, userFields(user));
    return user;
  }

  public async updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser> {
    const item = await this.findByDomainId(this.lists.users, id);
    if (!item) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    if (
      patch.email &&
      (await this.listUsers()).some(
        (user) => user.id !== id && user.email.toLowerCase() === patch.email?.toLowerCase(),
      )
    ) {
      throw new DomainError('CONFLICT', 'A user with this email already exists.', 409);
    }
    const current = toUser(item);
    const updated = { ...current, ...patch };
    await this.patchFields(this.lists.users, item.id, userFields(updated));
    return updated;
  }

  public async listProjects(query: ProjectQuery = {}): Promise<Project[]> {
    let projects = (await this.listItems(this.lists.projects)).map(toProject);
    if (query.search) {
      const search = query.search.toLowerCase();
      projects = projects.filter((project) =>
        `${project.projectCode} ${project.projectName} ${project.clientName} ${project.salesOwnerNameSnapshot} ${project.assignedDesignerNameSnapshot ?? ''} ${project.collaboratorDesignerNameSnapshots.join(' ')} ${project.siteLocation}`
          .toLowerCase()
          .includes(search),
      );
    }
    if (query.statuses?.length)
      projects = projects.filter((project) => query.statuses?.includes(project.status));
    if (query.designerId)
      projects = projects.filter(
        (project) =>
          project.assignedDesignerId === query.designerId ||
          project.collaboratorDesignerIds.includes(query.designerId ?? ''),
      );
    if (query.salesOwnerId)
      projects = projects.filter((project) => project.salesOwnerId === query.salesOwnerId);
    if (query.priorities?.length)
      projects = projects.filter((project) => query.priorities?.includes(project.priority));
    if (query.projectType)
      projects = projects.filter((project) => project.projectType === query.projectType);
    if (query.clientName)
      projects = projects.filter((project) =>
        project.clientName.toLowerCase().includes(query.clientName?.toLowerCase() ?? ''),
      );
    if (query.dueFrom)
      projects = projects.filter(
        (project) => project.requiredDeliveryDate >= (query.dueFrom ?? ''),
      );
    if (query.dueTo)
      projects = projects.filter((project) => project.requiredDeliveryDate <= (query.dueTo ?? ''));
    const direction = query.sortDirection === 'desc' ? -1 : 1;
    return projects.sort((a, b) => {
      if (query.sortBy === 'createdDate') return a.createdAt.localeCompare(b.createdAt) * direction;
      if (query.sortBy === 'salesOwner')
        return a.salesOwnerNameSnapshot.localeCompare(b.salesOwnerNameSnapshot) * direction;
      if (query.sortBy === 'priority') {
        const rank = { Low: 0, Normal: 1, High: 2, Urgent: 3 };
        return (rank[a.priority] - rank[b.priority]) * direction;
      }
      return a.requiredDeliveryDate.localeCompare(b.requiredDeliveryDate) * direction;
    });
  }

  public async getProject(id: string): Promise<Project | null> {
    const item = await this.findByDomainId(this.lists.projects, id);
    return item ? toProject(item) : null;
  }

  public async createProject(record: ProjectCreateRecord): Promise<Project> {
    const existing = (await this.listItems(this.lists.projects)).find(
      (item) => stringField(itemFields(item), 'IdempotencyKey') === record.idempotencyKey,
    );
    if (existing) return toProject(existing);
    await this.createItem(
      this.lists.projects,
      projectFields(record.project, record.idempotencyKey),
    );
    try {
      await this.appendActivities(record.activities);
      await this.addNotifications(record.notifications);
    } catch (error) {
      throw new DomainError(
        'CONFLICT',
        'The project was saved, but one or more audit or notification side effects need reconciliation.',
        409,
        { projectId: record.project.id, cause: error instanceof Error ? error.message : 'Unknown' },
      );
    }
    return record.project;
  }

  public async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const item = await this.findByDomainId(this.lists.projects, id);
    if (!item) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const updated = { ...toProject(item), ...patch };
    await this.patchFields(this.lists.projects, item.id, projectFields(updated));
    return updated;
  }

  public async allocateProjectNumber(): Promise<number> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const item = await this.graph.request<GraphListItem>(
        `${this.itemPath(this.lists.sequence, `/${encodeURIComponent(this.sequenceItemId)}`)}?$expand=fields`,
      );
      const current = numberField(itemFields(item), 'LastNumber');
      const next = current + 1;
      try {
        await this.patchFields(
          this.lists.sequence,
          item.id,
          { LastNumber: next, UpdatedAtUtc: new Date().toISOString() },
          item.eTag,
        );
        return next;
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'CONFLICT' || attempt === 7)
          throw error;
        await new Promise((resolve) =>
          setTimeout(resolve, 35 + Math.round(Math.random() * 80) + attempt * 25),
        );
      }
    }
    throw new DomainError('CONFLICT', 'Project sequence could not be reserved.', 409);
  }

  public async listActivities(projectId: string): Promise<ProjectActivity[]> {
    return (await this.listItems(this.lists.activities))
      .map(toActivity)
      .filter((activity) => activity.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async appendActivities(activities: ProjectActivity[]): Promise<void> {
    for (const activity of activities)
      await this.createItem(this.lists.activities, activityFields(activity));
  }

  public async listComments(projectId: string): Promise<ProjectComment[]> {
    return (await this.listItems(this.lists.comments))
      .map(toComment)
      .filter((comment) => comment.projectId === projectId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  public async addComment(comment: ProjectComment): Promise<ProjectComment> {
    await this.createItem(this.lists.comments, commentFields(comment));
    return comment;
  }

  public async listNotifications(userId: string): Promise<AppNotification[]> {
    return (await this.listItems(this.lists.notifications))
      .map(toNotification)
      .filter((item) => item.recipientUserId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  public async addNotifications(notifications: AppNotification[]): Promise<void> {
    for (const item of notifications)
      await this.createItem(this.lists.notifications, notificationFields(item));
  }

  public async markNotificationRead(id: string, userId: string): Promise<AppNotification> {
    const item = await this.findByDomainId(this.lists.notifications, id);
    if (!item) throw new DomainError('NOT_FOUND', 'Notification not found.', 404);
    const current = toNotification(item);
    if (current.recipientUserId !== userId) {
      throw new DomainError('PERMISSION_DENIED', 'Notification does not belong to this user.', 403);
    }
    await this.patchFields(this.lists.notifications, item.id, { IsRead: true });
    return { ...current, isRead: true };
  }

  public async getSettings(): Promise<AppSettings> {
    const [settingsItems, typeItems] = await Promise.all([
      this.listItems(this.lists.settings),
      this.listItems(this.lists.types),
    ]);
    const settings = settingsItems[0];
    if (!settings)
      throw new DomainError('CONFIGURATION_REQUIRED', 'SharePoint settings item is missing.', 503);
    const fields = itemFields(settings);
    return {
      companyTimezone: stringField(fields, 'CompanyTimezone', 'Asia/Dubai'),
      teamsNotificationsEnabled: booleanField(fields, 'TeamsNotificationsEnabled'),
      projectTypes: typeItems.map(toProjectType),
      updatedAt: stringField(fields, 'UpdatedAtUtc'),
      updatedById: nullableStringField(fields, 'UpdatedById'),
    };
  }

  public async updateSettings(settings: AppSettings): Promise<AppSettings> {
    const settingsItems = await this.listItems(this.lists.settings);
    const item = settingsItems[0];
    if (!item)
      throw new DomainError('CONFIGURATION_REQUIRED', 'SharePoint settings item is missing.', 503);
    await this.patchFields(this.lists.settings, item.id, {
      CompanyTimezone: settings.companyTimezone,
      TeamsNotificationsEnabled: settings.teamsNotificationsEnabled,
      UpdatedAtUtc: settings.updatedAt,
      UpdatedById: settings.updatedById,
    });
    const existing = await this.listItems(this.lists.types);
    for (const type of settings.projectTypes) {
      const typeItem = existing.find(
        (candidate) => stringField(itemFields(candidate), 'SCLI_Id') === type.id,
      );
      if (typeItem) await this.patchFields(this.lists.types, typeItem.id, projectTypeFields(type));
      else await this.createItem(this.lists.types, projectTypeFields(type));
    }
    return settings;
  }
}

export function createGraphCredential(config: AppConfig): TokenCredential {
  const tenantId = required(config.ENTRA_TENANT_ID, 'ENTRA_TENANT_ID');
  const clientId = required(config.ENTRA_CLIENT_ID, 'ENTRA_CLIENT_ID');
  if (config.ENTRA_CLIENT_CERTIFICATE_PATH) {
    return new ClientCertificateCredential(tenantId, clientId, {
      certificatePath: config.ENTRA_CLIENT_CERTIFICATE_PATH,
      ...(config.ENTRA_CLIENT_CERTIFICATE_PASSWORD
        ? { certificatePassword: config.ENTRA_CLIENT_CERTIFICATE_PASSWORD }
        : {}),
    });
  }
  if (config.ENTRA_CLIENT_SECRET) {
    return new ClientSecretCredential(tenantId, clientId, config.ENTRA_CLIENT_SECRET);
  }
  return new DefaultAzureCredential();
}
