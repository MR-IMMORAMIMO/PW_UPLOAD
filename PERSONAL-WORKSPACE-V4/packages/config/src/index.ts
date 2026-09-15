import { z } from 'zod';
import type { IntegrationStatus } from '@scli/domain';

const optionalString = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().optional(),
);

const developmentSecret = 'development-only-change-this-secret-2026';
const developmentPassword = 'ChangeThisNow!2026';

const environmentSchema = z
  .object({
    APP_MODE: z.enum(['mock', 'standalone', 'm365']).default('standalone'),
    WORKSPACE_VARIANT: z.enum(['personal', 'team']).default('personal'),
    LOCAL_AI_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    LOCAL_AI_PORT: z.coerce.number().int().min(0).max(65535).default(0),
    PERSONAL_AUTO_LOGIN: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    PERSONAL_PROJECT_ROOT: z.string().trim().default(''),
    PERSONAL_DEFAULT_FOLDER_PROFILE: z.string().trim().default('Full Lighting Design'),
    LUMINAIRE_EXPORTER_PATH: z
      .string()
      .trim()
      .default('./tools/luminaire-exporter/SCLI Luminaire Studio.exe'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
    COMPANY_TIMEZONE: z.string().default('Asia/Dubai'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    STANDALONE_DB_PATH: z.string().trim().default('./data/scli.sqlite'),
    STANDALONE_SESSION_SECRET: z.string().min(32).default(developmentSecret),
    STANDALONE_SESSION_HOURS: z.coerce.number().int().min(1).max(168).default(12),
    STANDALONE_ADMIN_NAME: z.string().trim().min(1).max(120).default('System Administrator'),
    STANDALONE_ADMIN_EMAIL: z.string().trim().email().default('admin@scientechnic.local'),
    STANDALONE_ADMIN_PASSWORD: z.string().min(12).max(200).default(developmentPassword),
    ENTRA_TENANT_ID: optionalString,
    ENTRA_CLIENT_ID: optionalString,
    ENTRA_CLIENT_SECRET: optionalString,
    ENTRA_CLIENT_CERTIFICATE_PATH: optionalString,
    ENTRA_CLIENT_CERTIFICATE_PASSWORD: optionalString,
    TEAMS_APP_ID: optionalString,
    TAB_ENDPOINT: optionalString,
    SHAREPOINT_SITE_ID: optionalString,
    SP_LIST_APP_USERS_ID: optionalString,
    SP_LIST_PROJECTS_ID: optionalString,
    SP_LIST_ACTIVITIES_ID: optionalString,
    SP_LIST_COMMENTS_ID: optionalString,
    SP_LIST_NOTIFICATIONS_ID: optionalString,
    SP_LIST_SEQUENCE_ID: optionalString,
    SP_LIST_PROJECT_TYPES_ID: optionalString,
    SP_LIST_SETTINGS_ID: optionalString,
    SP_SEQUENCE_ITEM_ID: optionalString,
    TEAMS_NOTIFICATIONS_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    TEAMS_BOT_ID: optionalString,
    TEAMS_BOT_SECRET: optionalString,
  })
  .superRefine((value, context) => {
    if (value.APP_MODE !== 'standalone' || value.NODE_ENV !== 'production') return;
    if (value.STANDALONE_SESSION_SECRET === developmentSecret) {
      context.addIssue({
        code: 'custom',
        path: ['STANDALONE_SESSION_SECRET'],
        message: 'Set a unique session secret before running standalone mode in production.',
      });
    }
    if (value.STANDALONE_ADMIN_PASSWORD === developmentPassword) {
      context.addIssue({
        code: 'custom',
        path: ['STANDALONE_ADMIN_PASSWORD'],
        message: 'Set a unique bootstrap Admin password before production.',
      });
    }
  });

export type AppConfig = z.infer<typeof environmentSchema>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(source);
}

const ssoKeys = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'TEAMS_APP_ID'] as const;
const sharePointKeys = [
  'SHAREPOINT_SITE_ID',
  'SP_LIST_APP_USERS_ID',
  'SP_LIST_PROJECTS_ID',
  'SP_LIST_ACTIVITIES_ID',
  'SP_LIST_COMMENTS_ID',
  'SP_LIST_NOTIFICATIONS_ID',
  'SP_LIST_SEQUENCE_ID',
  'SP_LIST_PROJECT_TYPES_ID',
  'SP_LIST_SETTINGS_ID',
  'SP_SEQUENCE_ITEM_ID',
] as const;

export function getIntegrationStatus(config: AppConfig): IntegrationStatus {
  if (config.APP_MODE === 'mock') {
    return {
      mode: 'mock',
      workspaceVariant: config.WORKSPACE_VARIANT,
      personalAutoLogin: config.PERSONAL_AUTO_LOGIN,
      configured: true,
      teamsSsoConfigured: false,
      sharePointConfigured: false,
      proactiveNotificationsConfigured: false,
      missing: [],
    };
  }
  if (config.APP_MODE === 'standalone') {
    return {
      mode: 'standalone',
      workspaceVariant: config.WORKSPACE_VARIANT,
      personalAutoLogin: config.PERSONAL_AUTO_LOGIN,
      configured: true,
      teamsSsoConfigured: false,
      sharePointConfigured: false,
      proactiveNotificationsConfigured: false,
      missing: [],
    };
  }
  const missing: string[] = [...ssoKeys, ...sharePointKeys].filter((key) => !config[key]);
  const teamsSsoConfigured = ssoKeys.every((key) => Boolean(config[key]));
  const sharePointConfigured = sharePointKeys.every((key) => Boolean(config[key]));
  const proactiveNotificationsConfigured =
    !config.TEAMS_NOTIFICATIONS_ENABLED || Boolean(config.TEAMS_BOT_ID && config.TEAMS_BOT_SECRET);
  if (config.TEAMS_NOTIFICATIONS_ENABLED && !config.TEAMS_BOT_ID) missing.push('TEAMS_BOT_ID');
  if (config.TEAMS_NOTIFICATIONS_ENABLED && !config.TEAMS_BOT_SECRET) {
    missing.push('TEAMS_BOT_SECRET');
  }
  return {
    mode: 'm365',
    workspaceVariant: config.WORKSPACE_VARIANT,
    personalAutoLogin: false,
    configured: teamsSsoConfigured && sharePointConfigured && proactiveNotificationsConfigured,
    teamsSsoConfigured,
    sharePointConfigured,
    proactiveNotificationsConfigured,
    missing,
  };
}
