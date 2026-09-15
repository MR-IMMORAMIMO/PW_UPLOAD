export const summaryStageDetails: Record<
  string,
  { title: string; section: string; destination: string; description: string }
> = {
  setup: {
    title: 'Setup',
    section: 'scope',
    destination: 'Scope & Services',
    description:
      'Review the project brief, scope, responsibilities and optional schedule before starting delivery.',
  },
  design: {
    title: 'Design',
    section: 'luminaires',
    destination: 'Luminaires',
    description: 'Maintain the selected luminaires and their design information for this project.',
  },
  technical: {
    title: 'Technical',
    section: 'technical-check',
    destination: 'Technical Check',
    description:
      'Review technical checks, missing information and differences before preparing outputs.',
  },
  issue: {
    title: 'Issue',
    section: 'packages',
    destination: 'Packages',
    description: 'Review the package contents and readiness before explicitly issuing a package.',
  },
  'client-review': {
    title: 'Client Review',
    section: 'comments',
    destination: 'Comments',
    description:
      'Review client feedback and linked actions. Opening this stage does not send anything or change project status.',
  },
  revision: {
    title: 'Revision',
    section: 'revisions',
    destination: 'Revisions',
    description:
      'Review recorded revisions and prepare the next revision through its existing workflow.',
  },
};
