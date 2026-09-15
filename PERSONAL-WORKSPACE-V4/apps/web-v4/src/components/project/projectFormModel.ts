import type { FullProjectEditInput } from '@scli/contracts';
import {
  projectServiceLabels,
  type AppUser,
  type LuminaireInputMode,
  type Project,
  type ProjectScopeItem,
  type ProjectServiceCode,
  type ProjectWorkspace,
} from '@scli/domain';

export interface ProjectFormValues {
  projectName: string;
  clientName: string;
  crmReference: string;
  projectType: string;
  designStage: Project['designStage'];
  requiredDeliveryDate: string;
  siteLocation: string;
  lightingScope: string;
  luxRequirements: string;
  drawingReference: string;
  description: string;
  commercialValue: string;
  commercialCurrency: string;
  salesOwnerId: string;
  priority: Project['priority'];
  complexity: Project['complexity'];
  estimatedHours: string;
  services: ProjectServiceCode[];
  customScope: string[];
  luminaireInputMode: LuminaireInputMode;
}

export function parseCommercialValue(amountInput: string, currencyInput: string) {
  const amount = amountInput.trim();
  const currency = currencyInput.trim().toUpperCase();
  if (!amount && !currency) return { ok: true as const, value: {} };
  if (!amount || !currency)
    return { ok: false as const, error: 'Commercial value and currency must be entered together.' };
  if (!/^[A-Z]{3}$/.test(currency))
    return { ok: false as const, error: 'Use a valid three-letter currency code.' };
  const match = /^(?:\d+(?:\.(\d{0,2}))?|\.\d{1,2})$/.exec(amount);
  if (!match)
    return { ok: false as const, error: 'Enter a non-negative amount with up to 2 decimals.' };
  const [whole = '0', fraction = ''] = amount.startsWith('.')
    ? ['0', amount.slice(1)]
    : amount.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (minor > BigInt(Number.MAX_SAFE_INTEGER))
    return { ok: false as const, error: 'Commercial value exceeds the supported range.' };
  return {
    ok: true as const,
    value: { commercialValueMinor: Number(minor), commercialCurrency: currency },
  };
}

function amountFromMinor(value: number | null | undefined): string {
  if (value === null || value === undefined) return '';
  return (value / 100).toFixed(2);
}

export function projectFormValues(
  project: Project,
  workspace: Pick<ProjectWorkspace, 'services' | 'lightingPackage'> & {
    scopeItems?: ProjectScopeItem[];
  },
): ProjectFormValues {
  const scopeItems = workspace.scopeItems ?? [];
  return normalizeProjectFormValues({
    projectName: project.projectName,
    clientName: project.clientName ?? '',
    crmReference: project.crmReference ?? '',
    projectType: project.projectType,
    designStage: project.designStage,
    requiredDeliveryDate: project.requiredDeliveryDate.slice(0, 10),
    siteLocation: project.siteLocation,
    lightingScope: project.lightingScope,
    luxRequirements: project.luxRequirements,
    drawingReference: project.drawingReference,
    description: project.description,
    commercialValue: amountFromMinor(project.commercialValueMinor),
    commercialCurrency: project.commercialCurrency ?? '',
    salesOwnerId: project.salesOwnerId,
    priority: project.priority,
    complexity: project.complexity,
    estimatedHours: String(project.estimatedHours),
    services: workspace.services ?? project.services ?? [],
    customScope: scopeItems.filter((item) => item.custom).map((item) => item.label),
    luminaireInputMode:
      workspace.lightingPackage?.inputMode ?? project.luminaireInputMode ?? 'Later',
  });
}

export function normalizeProjectFormValues(values: ProjectFormValues): ProjectFormValues {
  return {
    ...values,
    projectName: values.projectName.trim(),
    clientName: values.clientName.trim(),
    crmReference: values.crmReference.trim(),
    projectType: values.projectType.trim(),
    siteLocation: values.siteLocation.trim(),
    lightingScope: values.lightingScope.trim(),
    luxRequirements: values.luxRequirements.trim(),
    drawingReference: values.drawingReference.trim(),
    description: values.description.trim(),
    commercialValue: values.commercialValue.trim(),
    commercialCurrency: values.commercialCurrency.trim().toUpperCase(),
    estimatedHours: values.estimatedHours.trim(),
    services: [...new Set(values.services)],
    customScope: [...new Set(values.customScope.map((item) => item.trim()).filter(Boolean))],
  };
}

export function validateProjectForm(values: ProjectFormValues): string | null {
  const normalized = normalizeProjectFormValues(values);
  const core = validateProjectCore(normalized);
  const first = Object.values(core)[0];
  if (first) return first;
  const commercial = parseCommercialValue(
    normalized.commercialValue,
    normalized.commercialCurrency,
  );
  return commercial.ok ? null : commercial.error;
}

export function validateProjectCore(
  values: Pick<
    ProjectFormValues,
    | 'projectName'
    | 'clientName'
    | 'projectType'
    | 'siteLocation'
    | 'lightingScope'
    | 'requiredDeliveryDate'
    | 'estimatedHours'
  >,
  minimumDate?: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!values.projectName.trim()) errors.projectName = 'Project name is required.';
  if (!values.clientName.trim()) errors.clientName = 'Client name is required.';
  if (!values.projectType.trim()) errors.projectType = 'Select an active project type.';
  if (!values.lightingScope.trim()) errors.lightingScope = 'Lighting scope is required.';
  if (
    values.requiredDeliveryDate &&
    minimumDate !== undefined &&
    values.requiredDeliveryDate < minimumDate
  ) {
    errors.requiredDeliveryDate = minimumDate
      ? 'Choose today or a future date.'
      : 'Required Delivery Date is required.';
  }
  const hours = Number(values.estimatedHours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 10_000)
    errors.estimatedHours = 'Enter 0–10,000 hours.';
  return errors;
}

export function buildScopeItems(services: ProjectServiceCode[], customScope: string[]) {
  return [
    ...services.map((code) => ({ code, label: projectServiceLabels[code], custom: false })),
    ...customScope.map((label) => ({ code: null, label: label.trim(), custom: true })),
  ];
}

export function projectScopeInput(values: ProjectFormValues) {
  return buildScopeItems(values.services, values.customScope);
}

export function fullEditPayload(
  baseline: ProjectFormValues,
  values: ProjectFormValues,
  project: Project,
): FullProjectEditInput {
  const before = normalizeProjectFormValues(baseline);
  const after = normalizeProjectFormValues(values);
  const payload: FullProjectEditInput = {
    scopeItems: projectScopeInput(after),
    luminaireInputMode: after.luminaireInputMode,
    expectedVersion: project.version,
  };
  const textFields = [
    'projectName',
    'clientName',
    'projectType',
    'siteLocation',
    'lightingScope',
    'luxRequirements',
    'drawingReference',
    'description',
    'requiredDeliveryDate',
  ] as const;
  for (const field of textFields) if (before[field] !== after[field]) payload[field] = after[field];
  if (before.crmReference !== after.crmReference) payload.crmReference = after.crmReference || null;
  if (before.designStage !== after.designStage) payload.designStage = after.designStage;
  if (before.priority !== after.priority) payload.priority = after.priority;
  if (before.complexity !== after.complexity) payload.complexity = after.complexity;
  if (before.estimatedHours !== after.estimatedHours)
    payload.estimatedHours = Number(after.estimatedHours);
  if (before.salesOwnerId !== after.salesOwnerId) payload.salesOwnerId = after.salesOwnerId;
  if (
    before.commercialValue !== after.commercialValue ||
    before.commercialCurrency !== after.commercialCurrency
  ) {
    const commercial = parseCommercialValue(after.commercialValue, after.commercialCurrency);
    if (!commercial.ok) throw new Error(commercial.error);
    if ('commercialValueMinor' in commercial.value) Object.assign(payload, commercial.value);
    else Object.assign(payload, { commercialValueMinor: null, commercialCurrency: null });
  }
  return payload;
}

export function canEditCommercial(actor: AppUser | undefined, project: Project): boolean {
  return (
    !!actor &&
    (actor.role === 'Admin' ||
      actor.role === 'LineManager' ||
      (actor.role === 'Sales' && actor.id === project.salesOwnerId))
  );
}

export function canEditManagementFields(actor: AppUser | undefined): boolean {
  return actor?.role === 'Admin' || actor?.role === 'LineManager';
}
