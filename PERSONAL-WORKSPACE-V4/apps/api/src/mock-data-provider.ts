import {
  DomainError,
  type AppNotification,
  type AppSettings,
  type AppUser,
  type DataProvider,
  type Project,
  type ProjectActivity,
  type ProjectComment,
  type ProjectCreateRecord,
  type ProjectQuery,
} from '@scli/domain';
import { createSeedData, type SeedData } from '@scli/test-data';

const priorityOrder: Record<Project['priority'], number> = {
  Low: 0,
  Normal: 1,
  High: 2,
  Urgent: 3,
};

export class MockDataProvider implements DataProvider {
  public readonly mode: DataProvider['mode'];
  protected data: SeedData;
  protected readonly idempotentProjects = new Map<string, string>();
  private sequenceQueue: Promise<void> = Promise.resolve();

  public constructor(seed: SeedData = createSeedData(), mode: DataProvider['mode'] = 'mock') {
    this.data = structuredClone(seed);
    this.mode = mode;
  }

  public reset(): void {
    this.data = createSeedData();
    this.idempotentProjects.clear();
    this.sequenceQueue = Promise.resolve();
  }

  public async listUsers(): Promise<AppUser[]> {
    return structuredClone(this.data.users);
  }

  public async getUser(id: string): Promise<AppUser | null> {
    return structuredClone(this.data.users.find((user) => user.id === id) ?? null);
  }

  public async getUserByEntraObjectId(entraObjectId: string): Promise<AppUser | null> {
    return structuredClone(
      this.data.users.find((user) => user.entraObjectId === entraObjectId) ?? null,
    );
  }

  public async createUser(user: AppUser): Promise<AppUser> {
    if (this.data.users.some((item) => item.email.toLowerCase() === user.email.toLowerCase())) {
      throw new DomainError('CONFLICT', 'A user with this email already exists.', 409);
    }
    this.data.users.push(structuredClone(user));
    return structuredClone(user);
  }

  public async updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser> {
    const index = this.data.users.findIndex((user) => user.id === id);
    if (index < 0) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    if (
      patch.email &&
      this.data.users.some(
        (user) => user.id !== id && user.email.toLowerCase() === patch.email?.toLowerCase(),
      )
    ) {
      throw new DomainError('CONFLICT', 'A user with this email already exists.', 409);
    }
    const current = this.data.users[index];
    if (!current) throw new DomainError('NOT_FOUND', 'User not found.', 404);
    const updated = { ...current, ...structuredClone(patch) };
    this.data.users[index] = updated;
    return structuredClone(updated);
  }

  public async listProjects(query: ProjectQuery = {}): Promise<Project[]> {
    let projects = [...this.data.projects];
    if (query.search) {
      const search = query.search.toLocaleLowerCase();
      projects = projects.filter((project) =>
        [
          project.projectCode,
          project.projectName,
          project.clientName,
          project.crmReference ?? '',
          project.salesOwnerNameSnapshot,
          project.assignedDesignerNameSnapshot ?? '',
          ...project.collaboratorDesignerNameSnapshots,
          project.siteLocation,
        ].some((value) => value.toLocaleLowerCase().includes(search)),
      );
    }
    if (query.statuses?.length) {
      projects = projects.filter((project) => query.statuses?.includes(project.status));
    }
    if (query.designerId) {
      projects = projects.filter(
        (project) =>
          project.assignedDesignerId === query.designerId ||
          project.collaboratorDesignerIds.includes(query.designerId ?? ''),
      );
    }
    if (query.salesOwnerId) {
      projects = projects.filter((project) => project.salesOwnerId === query.salesOwnerId);
    }
    if (query.priorities?.length) {
      projects = projects.filter((project) => query.priorities?.includes(project.priority));
    }
    if (query.projectType) {
      projects = projects.filter((project) => project.projectType === query.projectType);
    }
    if (query.clientName) {
      const client = query.clientName.toLocaleLowerCase();
      projects = projects.filter((project) =>
        project.clientName.toLocaleLowerCase().includes(client),
      );
    }
    if (query.dueFrom) {
      projects = projects.filter(
        (project) => project.requiredDeliveryDate >= (query.dueFrom ?? ''),
      );
    }
    if (query.dueTo) {
      projects = projects.filter((project) => project.requiredDeliveryDate <= (query.dueTo ?? ''));
    }
    const direction = query.sortDirection === 'asc' ? 1 : -1;
    projects.sort((a, b) => {
      switch (query.sortBy) {
        case 'priority':
          return (priorityOrder[a.priority] - priorityOrder[b.priority]) * direction;
        case 'salesOwner':
          return a.salesOwnerNameSnapshot.localeCompare(b.salesOwnerNameSnapshot) * direction;
        case 'createdDate':
          return a.createdAt.localeCompare(b.createdAt) * direction;
        case 'requiredDate':
        default:
          return a.requiredDeliveryDate.localeCompare(b.requiredDeliveryDate) * direction;
      }
    });
    return structuredClone(projects);
  }

  public async getProject(id: string): Promise<Project | null> {
    return structuredClone(this.data.projects.find((project) => project.id === id) ?? null);
  }

  public async createProject(record: ProjectCreateRecord): Promise<Project> {
    const existingId = this.idempotentProjects.get(record.idempotencyKey);
    if (existingId) {
      const existing = this.data.projects.find((project) => project.id === existingId);
      if (existing) return structuredClone(existing);
    }
    if (this.data.projects.some((project) => project.projectCode === record.project.projectCode)) {
      throw new DomainError('CONFLICT', 'A project with this code already exists.', 409);
    }
    this.data.projects.push(structuredClone(record.project));
    this.data.activities.push(...structuredClone(record.activities));
    this.data.notifications.push(...structuredClone(record.notifications));
    this.idempotentProjects.set(record.idempotencyKey, record.project.id);
    return structuredClone(record.project);
  }

  public async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const index = this.data.projects.findIndex((project) => project.id === id);
    if (index < 0) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const current = this.data.projects[index];
    if (!current) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    const updated = { ...current, ...structuredClone(patch) };
    this.data.projects[index] = updated;
    return structuredClone(updated);
  }

  public async allocateProjectNumber(): Promise<number> {
    let allocated = 0;
    const allocation = this.sequenceQueue.then(() => {
      this.data.lastSequence += 1;
      allocated = this.data.lastSequence;
    });
    this.sequenceQueue = allocation.catch(() => undefined);
    await allocation;
    return allocated;
  }

  public async setProjectSequenceFloor(sequence: number): Promise<void> {
    if (Number.isInteger(sequence) && sequence > this.data.lastSequence) {
      this.data.lastSequence = sequence;
    }
  }

  public async deleteProject(id: string): Promise<void> {
    const projectIndex = this.data.projects.findIndex((project) => project.id === id);
    if (projectIndex < 0) throw new DomainError('NOT_FOUND', 'Project not found.', 404);
    this.data.projects.splice(projectIndex, 1);
    this.data.activities = this.data.activities.filter((activity) => activity.projectId !== id);
    this.data.comments = this.data.comments.filter((comment) => comment.projectId !== id);
    this.data.notifications = this.data.notifications.filter(
      (notification) => notification.projectId !== id,
    );
    for (const [key, projectId] of this.idempotentProjects) {
      if (projectId === id) this.idempotentProjects.delete(key);
    }
  }

  public async listActivities(projectId: string): Promise<ProjectActivity[]> {
    return structuredClone(
      this.data.activities
        .filter((activity) => activity.projectId === projectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  public async appendActivities(activities: ProjectActivity[]): Promise<void> {
    this.data.activities.push(...structuredClone(activities));
  }

  public async listComments(projectId: string): Promise<ProjectComment[]> {
    return structuredClone(
      this.data.comments
        .filter((comment) => comment.projectId === projectId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    );
  }

  public async addComment(comment: ProjectComment): Promise<ProjectComment> {
    this.data.comments.push(structuredClone(comment));
    return structuredClone(comment);
  }

  public async listNotifications(userId: string): Promise<AppNotification[]> {
    return structuredClone(
      this.data.notifications
        .filter((notification) => notification.recipientUserId === userId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    );
  }

  public async addNotifications(notifications: AppNotification[]): Promise<void> {
    this.data.notifications.push(...structuredClone(notifications));
  }

  public async markNotificationRead(id: string, userId: string): Promise<AppNotification> {
    const notification = this.data.notifications.find(
      (item) => item.id === id && item.recipientUserId === userId,
    );
    if (!notification) throw new DomainError('NOT_FOUND', 'Notification not found.', 404);
    notification.isRead = true;
    return structuredClone(notification);
  }

  public async getSettings(): Promise<AppSettings> {
    return structuredClone(this.data.settings);
  }

  public async updateSettings(settings: AppSettings): Promise<AppSettings> {
    this.data.settings = structuredClone(settings);
    return structuredClone(this.data.settings);
  }

  protected snapshot(): SeedData {
    return structuredClone(this.data);
  }
}
