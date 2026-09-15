import { parseCommercialValue } from '../project/projectFormModel';
import { businessTodayKey } from '../../date-time/businessDateTime';

/** Shared by step navigation, creation and Review so their validation cannot disagree. */
export function projectWizardIssues(fields: Record<string, string>, scope: string) {
  const information: string[] = [];
  if (!fields.projectName?.trim()) information.push('Enter the Project name.');
  if (!fields.clientName?.trim()) information.push('Enter the Client.');
  if (!fields.projectType) information.push('Select a Project type.');
  const money = parseCommercialValue(fields.commercialValue ?? '', fields.currency ?? '');
  if (!money.ok) information.push(money.error);
  const schedule: string[] = [];
  if (fields.startDate && fields.completionDate && fields.completionDate < fields.startDate)
    schedule.push('Target completion must be on or after the project start date.');
  if (fields.completionDate && fields.completionDate < businessTodayKey())
    schedule.push('Target completion cannot be in the past.');
  return { information, scope: scope.trim() ? [] : ['Enter the Scope Summary.'], schedule };
}
