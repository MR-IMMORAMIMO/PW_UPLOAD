import type { AppConfig } from '@scli/config';
import { DomainError, type DataProvider } from '@scli/domain';
import { getIntegrationStatus } from '@scli/config';
import { MockDataProvider } from './mock-data-provider';
import { createGraphCredential, SharePointDataProvider } from './sharepoint-data-provider';
import { StandaloneDataProvider } from './standalone-data-provider';

class UnconfiguredMicrosoft365Provider implements DataProvider {
  public readonly mode = 'm365' as const;
  private unavailable(): never {
    throw new DomainError(
      'CONFIGURATION_REQUIRED',
      'Microsoft 365 storage is not configured. Contact the application administrator.',
      503,
    );
  }
  public listUsers = async () => this.unavailable();
  public getUser = async () => this.unavailable();
  public getUserByEntraObjectId = async () => this.unavailable();
  public createUser = async () => this.unavailable();
  public updateUser = async () => this.unavailable();
  public listProjects = async () => this.unavailable();
  public getProject = async () => this.unavailable();
  public createProject = async () => this.unavailable();
  public updateProject = async () => this.unavailable();
  public allocateProjectNumber = async () => this.unavailable();
  public listActivities = async () => this.unavailable();
  public appendActivities = async () => this.unavailable();
  public listComments = async () => this.unavailable();
  public addComment = async () => this.unavailable();
  public listNotifications = async () => this.unavailable();
  public addNotifications = async () => this.unavailable();
  public markNotificationRead = async () => this.unavailable();
  public getSettings = async () => this.unavailable();
  public updateSettings = async () => this.unavailable();
}

export function createDataProvider(config: AppConfig): DataProvider {
  if (config.APP_MODE === 'mock') return new MockDataProvider();
  if (config.APP_MODE === 'standalone') return new StandaloneDataProvider(config);
  if (!getIntegrationStatus(config).sharePointConfigured) {
    return new UnconfiguredMicrosoft365Provider();
  }
  return new SharePointDataProvider(config, createGraphCredential(config));
}
