import { randomUUID } from 'node:crypto';
import {
  ClientCertificateCredential,
  ClientSecretCredential,
  DefaultAzureCredential,
  type TokenCredential,
} from '@azure/identity';

interface GraphList {
  id: string;
  displayName: string;
}

interface GraphColumn {
  id: string;
  name: string;
}

interface ColumnDefinition {
  name: string;
  displayName?: string;
  required?: boolean;
  indexed?: boolean;
  text?: { allowMultipleLines?: boolean; maxLength?: number };
  number?: { decimalPlaces?: string };
  boolean?: Record<string, never>;
  dateTime?: { displayAs?: 'default' | 'friendly' };
  choice?: { choices: string[]; displayAs?: 'dropDownMenu' | 'radioButtons' };
}

const env = process.env;

function requireEnvironment(name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function credential(): TokenCredential {
  const tenantId = requireEnvironment('ENTRA_TENANT_ID');
  const clientId = requireEnvironment('ENTRA_CLIENT_ID');
  if (env.ENTRA_CLIENT_CERTIFICATE_PATH) {
    return new ClientCertificateCredential(tenantId, clientId, {
      certificatePath: env.ENTRA_CLIENT_CERTIFICATE_PATH,
      ...(env.ENTRA_CLIENT_CERTIFICATE_PASSWORD
        ? { certificatePassword: env.ENTRA_CLIENT_CERTIFICATE_PASSWORD }
        : {}),
    });
  }
  if (env.ENTRA_CLIENT_SECRET) {
    return new ClientSecretCredential(tenantId, clientId, env.ENTRA_CLIENT_SECRET);
  }
  return new DefaultAzureCredential();
}

const graphCredential = credential();
const siteId = requireEnvironment('SHAREPOINT_SITE_ID');
const base = `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(siteId)}`;

async function graph<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await graphCredential.getToken('https://graph.microsoft.com/.default');
  if (!token) throw new Error('Could not acquire a Microsoft Graph token.');
  const response = await fetch(path.startsWith('https://') ? path : `${base}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token.token}`,
      accept: 'application/json',
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw new Error(
      `Graph ${init.method ?? 'GET'} ${path} failed (${response.status}): ${(await response.text()).slice(0, 500)}`,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const text = (
  name: string,
  options: { required?: boolean; indexed?: boolean; multiple?: boolean; maxLength?: number } = {},
): ColumnDefinition => ({
  name,
  displayName: name,
  required: options.required ?? false,
  indexed: options.indexed ?? false,
  text: {
    allowMultipleLines: options.multiple ?? false,
    ...(!options.multiple ? { maxLength: options.maxLength ?? 255 } : {}),
  },
});
const number = (name: string, required = false): ColumnDefinition => ({
  name,
  displayName: name,
  required,
  number: { decimalPlaces: 'automatic' },
});
const yesNo = (name: string): ColumnDefinition => ({ name, displayName: name, boolean: {} });
const date = (name: string, indexed = false): ColumnDefinition => ({
  name,
  displayName: name,
  indexed,
  dateTime: { displayAs: 'default' },
});
const choice = (name: string, choices: string[], required = false): ColumnDefinition => ({
  name,
  displayName: name,
  required,
  choice: { choices, displayAs: 'dropDownMenu' },
});

const schemas: Array<{ name: string; environmentKey: string; columns: ColumnDefinition[] }> = [
  {
    name: 'SCLI_AppUsers',
    environmentKey: 'SP_LIST_APP_USERS_ID',
    columns: [
      text('SCLI_Id', { required: true, indexed: true, maxLength: 36 }),
      text('EntraObjectId', { required: true, indexed: true, maxLength: 64 }),
      text('Email', { required: true, indexed: true }),
      text('JobTitle'),
      text('Department'),
      choice('AppRole', ['Sales', 'Designer', 'LineManager', 'Admin'], true),
      number('WeeklyCapacityHours'),
      choice('AvailabilityStatus', ['Available', 'Limited', 'FullyLoaded', 'Unavailable'], true),
      text('AvatarUrl', { maxLength: 500 }),
      yesNo('IsActive'),
      date('CreatedAtUtc'),
      date('UpdatedAtUtc'),
    ],
  },
  {
    name: 'SCLI_Projects',
    environmentKey: 'SP_LIST_PROJECTS_ID',
    columns: [
      text('SCLI_Id', { required: true, indexed: true, maxLength: 36 }),
      text('ProjectName', { required: true }),
      text('ClientName', { required: true, indexed: true }),
      text('ProjectType', { required: true, indexed: true }),
      text('Description', { multiple: true, maxLength: 4000 }),
      text('SalesOwnerId', { required: true, indexed: true, maxLength: 36 }),
      text('SalesOwnerName'),
      text('SalesOwnerEmail'),
      text('CreatedById', { required: true, maxLength: 36 }),
      text('CreatedByName'),
      text('CreatedByEmail'),
      text('DesignerId', { indexed: true, maxLength: 36 }),
      text('DesignerName'),
      text('CollaboratorDesignerIds', { multiple: true, maxLength: 4000 }),
      text('CollaboratorDesignerNames', { multiple: true, maxLength: 4000 }),
      text('SiteLocation', { required: true }),
      choice(
        'DesignStage',
        ['Concept', 'SchematicDesign', 'DetailedDesign', 'Tender', 'Construction', 'AsBuilt'],
        true,
      ),
      text('LightingScope', { required: true, multiple: true, maxLength: 4000 }),
      text('LuxRequirements', { multiple: true, maxLength: 4000 }),
      text('DrawingReference', { maxLength: 300 }),
      choice(
        'ProjectStatus',
        [
          'NewRequest',
          'UnderReview',
          'Unassigned',
          'Assigned',
          'InProgress',
          'WaitingForInformation',
          'WaitingForSales',
          'InternalReview',
          'RevisionRequired',
          'OnHold',
          'Completed',
          'Cancelled',
        ],
        true,
      ),
      choice('Priority', ['Low', 'Normal', 'High', 'Urgent'], true),
      choice('Complexity', ['Small', 'Medium', 'Large'], true),
      number('EstimatedHours', true),
      number('ActualHours'),
      number('ProgressPercent'),
      date('RequiredDeliveryDate', true),
      text('ProjectFolderUrl', { maxLength: 500 }),
      number('RevisionNumber'),
      number('RecordVersion'),
      date('CreatedAtUtc', true),
      date('UpdatedAtUtc'),
      date('CompletedAtUtc'),
      date('CancelledAtUtc'),
      text('IdempotencyKey', { indexed: true, maxLength: 36 }),
    ],
  },
  {
    name: 'SCLI_ProjectActivities',
    environmentKey: 'SP_LIST_ACTIVITIES_ID',
    columns: [
      text('SCLI_Id', { required: true, indexed: true, maxLength: 36 }),
      text('ProjectId', { required: true, indexed: true, maxLength: 36 }),
      text('ActionType', { required: true, indexed: true }),
      text('FieldName'),
      text('OldValue', { multiple: true, maxLength: 4000 }),
      text('NewValue', { multiple: true, maxLength: 4000 }),
      text('ChangedById', { required: true, maxLength: 36 }),
      text('ChangedByName', { required: true }),
      date('CreatedAtUtc', true),
    ],
  },
  {
    name: 'SCLI_ProjectComments',
    environmentKey: 'SP_LIST_COMMENTS_ID',
    columns: [
      text('SCLI_Id', { required: true, indexed: true, maxLength: 36 }),
      text('ProjectId', { required: true, indexed: true, maxLength: 36 }),
      text('CommentBody', { required: true, multiple: true, maxLength: 4000 }),
      text('AuthorId', { required: true, maxLength: 36 }),
      text('AuthorName', { required: true }),
      text('AttachmentUrl', { maxLength: 500 }),
      date('CreatedAtUtc', true),
      date('UpdatedAtUtc'),
    ],
  },
  {
    name: 'SCLI_Notifications',
    environmentKey: 'SP_LIST_NOTIFICATIONS_ID',
    columns: [
      text('SCLI_Id', { required: true, indexed: true, maxLength: 36 }),
      text('RecipientUserId', { required: true, indexed: true, maxLength: 36 }),
      text('NotificationType', { required: true }),
      text('Message', { required: true, multiple: true, maxLength: 2000 }),
      text('ProjectId', { indexed: true, maxLength: 36 }),
      yesNo('IsRead'),
      date('CreatedAtUtc', true),
    ],
  },
  {
    name: 'SCLI_ProjectSequence',
    environmentKey: 'SP_LIST_SEQUENCE_ID',
    columns: [
      text('SequenceKey', { required: true, indexed: true }),
      number('LastNumber', true),
      date('UpdatedAtUtc'),
    ],
  },
  {
    name: 'SCLI_ProjectTypes',
    environmentKey: 'SP_LIST_PROJECT_TYPES_ID',
    columns: [
      text('SCLI_Id', { required: true, indexed: true, maxLength: 36 }),
      yesNo('IsActive'),
      date('CreatedAtUtc'),
      date('UpdatedAtUtc'),
    ],
  },
  {
    name: 'SCLI_AppSettings',
    environmentKey: 'SP_LIST_SETTINGS_ID',
    columns: [
      text('CompanyTimezone', { required: true }),
      yesNo('TeamsNotificationsEnabled'),
      date('UpdatedAtUtc'),
      text('UpdatedById', { maxLength: 36 }),
    ],
  },
];

const existingLists = await graph<{ value: GraphList[] }>('/lists?$select=id,displayName');
const listIds = new Map<string, string>();

for (const schema of schemas) {
  let list = existingLists.value.find((candidate) => candidate.displayName === schema.name);
  if (!list) {
    list = await graph<GraphList>('/lists', {
      method: 'POST',
      body: JSON.stringify({
        displayName: schema.name,
        list: { template: 'genericList' },
        columns: schema.columns,
      }),
    });
  } else {
    const existingColumns = await graph<{ value: GraphColumn[] }>(
      `/lists/${encodeURIComponent(list.id)}/columns?$select=id,name`,
    );
    for (const column of schema.columns) {
      if (!existingColumns.value.some((candidate) => candidate.name === column.name)) {
        await graph(`/lists/${encodeURIComponent(list.id)}/columns`, {
          method: 'POST',
          body: JSON.stringify(column),
        });
      }
    }
  }
  listIds.set(schema.environmentKey, list.id);
}

const sequenceListId = listIds.get('SP_LIST_SEQUENCE_ID');
if (!sequenceListId) throw new Error('Sequence list was not provisioned.');
const sequenceItems = await graph<{
  value: Array<{ id: string; fields?: Record<string, unknown> }>;
}>(`/lists/${encodeURIComponent(sequenceListId)}/items?$expand=fields`);
let sequenceItem = sequenceItems.value.find((item) => item.fields?.SequenceKey === 'projects');
if (!sequenceItem) {
  sequenceItem = await graph(`/lists/${encodeURIComponent(sequenceListId)}/items`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        Title: 'Project sequence',
        SequenceKey: 'projects',
        LastNumber: 0,
        UpdatedAtUtc: new Date().toISOString(),
      },
    }),
  });
}
const sequenceItemId = sequenceItem?.id;
if (!sequenceItemId) throw new Error('Sequence item was not provisioned.');

const settingsListId = listIds.get('SP_LIST_SETTINGS_ID');
if (!settingsListId) throw new Error('Settings list was not provisioned.');
const settingsItems = await graph<{ value: Array<{ id: string }> }>(
  `/lists/${encodeURIComponent(settingsListId)}/items?$top=1`,
);
if (!settingsItems.value.length) {
  await graph(`/lists/${encodeURIComponent(settingsListId)}/items`, {
    method: 'POST',
    body: JSON.stringify({
      fields: {
        Title: 'Application settings',
        CompanyTimezone: 'Asia/Dubai',
        TeamsNotificationsEnabled: false,
        UpdatedAtUtc: new Date().toISOString(),
      },
    }),
  });
}

const typeListId = listIds.get('SP_LIST_PROJECT_TYPES_ID');
if (!typeListId) throw new Error('Project types list was not provisioned.');
const existingTypes = await graph<{ value: Array<{ fields?: Record<string, unknown> }> }>(
  `/lists/${encodeURIComponent(typeListId)}/items?$expand=fields`,
);
if (!existingTypes.value.length) {
  for (const name of [
    'Lighting Layout',
    'Lux Calculations',
    'DIALux Simulation',
    'Luminaire Schedule',
    'Lighting Controls',
    'Emergency Lighting',
    'Façade Lighting',
    'Landscape Lighting',
    'Shop Drawing Review',
    'Tender Package',
    'Value Engineering',
  ]) {
    const now = new Date().toISOString();
    await graph(`/lists/${encodeURIComponent(typeListId)}/items`, {
      method: 'POST',
      body: JSON.stringify({
        fields: {
          Title: name,
          SCLI_Id: randomUUID(),
          IsActive: true,
          CreatedAtUtc: now,
          UpdatedAtUtc: now,
        },
      }),
    });
  }
}

for (const schema of schemas)
  process.stdout.write(`${schema.environmentKey}=${listIds.get(schema.environmentKey)}\n`);
process.stdout.write(`SP_SEQUENCE_ITEM_ID=${sequenceItemId}\n`);
process.stdout.write(
  'SharePoint schema provisioning completed. Copy the IDs above into the production environment.\n',
);
