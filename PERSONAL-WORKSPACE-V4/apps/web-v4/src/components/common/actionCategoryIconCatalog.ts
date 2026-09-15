import { SctRevisions } from './SctIcons';
import type { ActionCategoryIconKey } from '@scli/domain';
import { type LucideIcon } from 'lucide-react';
import {
  Box,
  Building2,
  Calculator,
  CalendarDays,
  CheckSquare,
  Clock3,
  ContactRound,
  Download,
  SctDocumentText as FileText,
  Image,
  LampDesk,
  SctLayerStack as Layers,
  LayoutTemplate,
  Lightbulb,
  MapPin,
  MessageSquare,
  Package,
  Presentation,
  Receipt,
  SctMeasure as Ruler,
  Search,
  Settings,
  Shield,
  Sun,
  Tags,
  SctTargetPoint as Target,
  Table2,
  TriangleAlert,
  Upload,
  Users,
  Wrench,
} from './SctIcons';

export interface ActionCategoryIconCatalogEntry {
  key: ActionCategoryIconKey;
  label: string;
  icon: LucideIcon;
}

const entries = [
  ['lightbulb', 'Lightbulb', Lightbulb],
  ['sun', 'Sun', Sun],
  ['layout', 'Layout', LayoutTemplate],
  ['lamp', 'Lamp', LampDesk],
  ['table', 'Table', Table2],
  ['receipt', 'Receipt', Receipt],
  ['file-text', 'File text', FileText],
  ['package', 'Package', Package],
  ['revision', 'Revision', SctRevisions],
  ['message', 'Message', MessageSquare],
  ['people', 'People', Users],
  ['location', 'Location', MapPin],
  ['checklist', 'Checklist', CheckSquare],
  ['calendar', 'Calendar', CalendarDays],
  ['tags', 'Tags', Tags],
  ['ruler', 'Ruler', Ruler],
  ['calculator', 'Calculator', Calculator],
  ['building', 'Building', Building2],
  ['tool', 'Tool', Wrench],
  ['settings', 'Settings', Settings],
  ['warning', 'Warning', TriangleAlert],
  ['clock', 'Clock', Clock3],
  ['presentation', 'Presentation', Presentation],
  ['image', 'Image', Image],
  ['box', 'Box', Box],
  ['layers', 'Layers', Layers],
  ['contact', 'Contact', ContactRound],
  ['target', 'Target', Target],
  ['search', 'Search', Search],
  ['shield', 'Shield', Shield],
  ['download', 'Download', Download],
  ['upload', 'Upload', Upload],
] as const satisfies ReadonlyArray<readonly [ActionCategoryIconKey, string, LucideIcon]>;

export const actionCategoryIconEntries: readonly ActionCategoryIconCatalogEntry[] = entries.map(
  ([key, label, icon]) => ({ key, label, icon }),
);

export const actionCategoryIconCatalog = new Map(
  actionCategoryIconEntries.map((entry) => [entry.key, entry]),
);
export const fallbackActionCategoryIcon = Lightbulb;

export function actionCategoryIconFor(key: string): LucideIcon {
  return (
    actionCategoryIconCatalog.get(key as ActionCategoryIconKey)?.icon ?? fallbackActionCategoryIcon
  );
}
