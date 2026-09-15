/** Versioned optional setup metadata from the approved Personal workspace wizard. */
export interface FinalProjectSetup {
  schemaVersion: 1;
  sourceLead: string;
  contractReference: string;
  managerId: string | null;
  probability: number | null;
  category: string;
  discipline: string;
  projectNature: string;
  packageType: string;
  deliverables: string[];
  designServices: string[];
  documentation: string[];
  coordination: 'standard' | 'extensive' | 'none';
  standards: string[];
  notes: string;
  schedule: {
    startDate: string;
    completionDate: string;
    designDurationDays: number;
    constructionDurationDays: number;
    milestones: Array<{
      id: string;
      name: string;
      description: string;
      targetDate: string;
      phase: 'Design' | 'Documentation' | 'Procurement' | 'Construction';
    }>;
  };
  structure: {
    enabledGroups: string[];
    documentCategory: string;
    sequenceDigits: number;
    separator: '-' | '_';
    extension: '.pdf' | '.docx' | '.xlsx' | '.dwg';
  };
}
