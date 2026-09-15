import { App } from '@microsoft/teams.apps';
import type { AppConfig } from '@scli/config';
import type { AppNotification, AppUser, DataProvider } from '@scli/domain';

export interface NotificationChannel {
  publish(notification: AppNotification, recipient: AppUser): Promise<'delivered' | 'skipped'>;
}

export interface TeamsConversationStore {
  getConversationId(entraObjectId: string): Promise<string | null>;
}

export class InAppNotificationChannel implements NotificationChannel {
  public constructor(private readonly provider: DataProvider) {}

  public async publish(notification: AppNotification): Promise<'delivered'> {
    await this.provider.addNotifications([notification]);
    return 'delivered';
  }
}

/**
 * Optional production channel using the current Microsoft Teams SDK.
 * A conversation ID becomes available only after the notification bot is installed for the user
 * (or a 1:1 conversation has been created through the supported Teams API). The application keeps
 * in-app delivery as the guaranteed baseline when no conversation is available.
 */
export class TeamsProactiveNotificationChannel implements NotificationChannel {
  private readonly app: App;
  private initialized = false;

  public constructor(
    private readonly config: AppConfig,
    private readonly conversations: TeamsConversationStore,
  ) {
    this.app = new App({
      ...(config.TEAMS_BOT_ID ? { clientId: config.TEAMS_BOT_ID } : {}),
      ...(config.TEAMS_BOT_SECRET ? { clientSecret: config.TEAMS_BOT_SECRET } : {}),
      ...(config.ENTRA_TENANT_ID ? { tenantId: config.ENTRA_TENANT_ID } : {}),
      messagingEndpoint: '/api/messages',
    });
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.app.initialize();
    this.initialized = true;
  }

  public async publish(
    notification: AppNotification,
    recipient: AppUser,
  ): Promise<'delivered' | 'skipped'> {
    if (!this.config.TEAMS_NOTIFICATIONS_ENABLED) return 'skipped';
    const conversationId = await this.conversations.getConversationId(recipient.entraObjectId);
    if (!conversationId) return 'skipped';
    await this.initialize();
    const projectUrl =
      notification.projectId && this.config.TAB_ENDPOINT
        ? `\n\nOpen project: ${this.config.TAB_ENDPOINT}/projects/${notification.projectId}`
        : '';
    await this.app.send(
      conversationId,
      `**${notification.title}**\n\n${notification.message}${projectUrl}`,
    );
    return 'delivered';
  }
}

export class CompositeNotificationChannel implements NotificationChannel {
  public constructor(private readonly channels: NotificationChannel[]) {}

  public async publish(
    notification: AppNotification,
    recipient: AppUser,
  ): Promise<'delivered' | 'skipped'> {
    const results = await Promise.allSettled(
      this.channels.map((channel) => channel.publish(notification, recipient)),
    );
    return results.some((result) => result.status === 'fulfilled' && result.value === 'delivered')
      ? 'delivered'
      : 'skipped';
  }
}
