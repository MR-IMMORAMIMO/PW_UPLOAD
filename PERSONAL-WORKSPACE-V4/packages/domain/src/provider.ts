import type {
  AppNotification,
  AppSettings,
  AppUser,
  Project,
  ProjectActivity,
  ProjectComment,
  ProjectQuery,
} from './types';

export interface ProjectCreateRecord {
  project: Project;
  activities: ProjectActivity[];
  notifications: AppNotification[];
  idempotencyKey: string;
}

export interface DataProvider {
  readonly mode: 'mock' | 'standalone' | 'm365';
  listUsers(): Promise<AppUser[]>;
  getUser(id: string): Promise<AppUser | null>;
  getUserByEntraObjectId(entraObjectId: string): Promise<AppUser | null>;
  createUser(user: AppUser): Promise<AppUser>;
  updateUser(id: string, patch: Partial<AppUser>): Promise<AppUser>;
  listProjects(query?: ProjectQuery): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(record: ProjectCreateRecord): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  allocateProjectNumber(): Promise<number>;
  setProjectSequenceFloor?(sequence: number): Promise<void>;
  deleteProject?(id: string): Promise<void>;
  listActivities(projectId: string): Promise<ProjectActivity[]>;
  appendActivities(activities: ProjectActivity[]): Promise<void>;
  listComments(projectId: string): Promise<ProjectComment[]>;
  addComment(comment: ProjectComment): Promise<ProjectComment>;
  listNotifications(userId: string): Promise<AppNotification[]>;
  addNotifications(notifications: AppNotification[]): Promise<void>;
  markNotificationRead(id: string, userId: string): Promise<AppNotification>;
  getSettings(): Promise<AppSettings>;
  updateSettings(settings: AppSettings): Promise<AppSettings>;
}

export interface LocalIdentityProvider {
  verifyCredentials(email: string, password: string): Promise<AppUser | null>;
  setPassword(userId: string, password: string): Promise<void>;
}

export function supportsLocalIdentity(
  provider: DataProvider,
): provider is DataProvider & LocalIdentityProvider {
  return 'verifyCredentials' in provider && 'setPassword' in provider;
}
