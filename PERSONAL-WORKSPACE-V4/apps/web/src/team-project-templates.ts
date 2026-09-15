import type { Complexity, DesignStage } from '@scli/domain';

export interface TeamProjectTemplate {
  id: string;
  name: string;
  summary: string;
  projectType: string;
  description: string;
  lightingScope: string;
  luxRequirements: string;
  drawingReference: string;
  designStage: DesignStage;
  complexity: Complexity;
  estimatedHours: number;
}

export const teamProjectTemplates: TeamProjectTemplate[] = [
  {
    id: 'lighting-layout',
    name: 'Lighting Layout',
    summary: 'Fixture positions, circuit intent and drawing coordination.',
    projectType: 'Lighting Layout',
    description: 'Prepare a coordinated lighting layout and luminaire positioning package.',
    lightingScope: 'Interior lighting layout, fixture positioning and architectural coordination.',
    luxRequirements: 'Confirm target illuminance against the approved project brief.',
    drawingReference: 'Latest architectural drawing package',
    designStage: 'DetailedDesign',
    complexity: 'Medium',
    estimatedHours: 12,
  },
  {
    id: 'dialux',
    name: 'DIALux Study',
    summary: 'Calculation model, compliance review and report.',
    projectType: 'DIALux Simulation',
    description: 'Build the lighting calculation model and issue the DIALux compliance report.',
    lightingScope: 'DIALux model, calculation grids, results review and report preparation.',
    luxRequirements: 'Use the client brief and applicable authority or project standards.',
    drawingReference: 'Latest reflected ceiling plans and room data',
    designStage: 'DetailedDesign',
    complexity: 'Large',
    estimatedHours: 20,
  },
  {
    id: 'luminaire-schedule',
    name: 'Luminaire Schedule',
    summary: 'Fixture codes, quantities, specifications and notes.',
    projectType: 'Luminaire Schedule',
    description: 'Prepare and coordinate the project luminaire schedule.',
    lightingScope: 'Luminaire coding, specification review, quantities and schedule coordination.',
    luxRequirements: '',
    drawingReference: 'Latest lighting layout and approved fixture selections',
    designStage: 'Tender',
    complexity: 'Medium',
    estimatedHours: 8,
  },
  {
    id: 'tender-package',
    name: 'Tender Package',
    summary: 'Coordinated drawings, BOQ and technical issue package.',
    projectType: 'Tender Package',
    description: 'Prepare the coordinated lighting tender submission package.',
    lightingScope: 'Tender drawings, luminaire schedule, technical BOQ and design coordination.',
    luxRequirements: 'Verify the final design against the tender requirements.',
    drawingReference: 'Tender architectural and MEP drawing package',
    designStage: 'Tender',
    complexity: 'Large',
    estimatedHours: 28,
  },
  {
    id: 'controls',
    name: 'Lighting Controls',
    summary: 'Scene hierarchy, control intent and schedule.',
    projectType: 'Lighting Controls',
    description: 'Define the lighting control intent, scenes and interface requirements.',
    lightingScope: 'Scene strategy, control zoning, schedules and specialist coordination.',
    luxRequirements: '',
    drawingReference: 'Latest lighting layout and control system information',
    designStage: 'DetailedDesign',
    complexity: 'Medium',
    estimatedHours: 10,
  },
  {
    id: 'technical-review',
    name: 'Technical Review',
    summary: 'Focused review of drawings, data and compliance issues.',
    projectType: 'Technical Review',
    description: 'Review the submitted lighting information and issue coordinated comments.',
    lightingScope: 'Technical compliance, coordination risks and recommendation summary.',
    luxRequirements: 'Review submitted values against the approved criteria.',
    drawingReference: 'Submitted contractor or consultant package',
    designStage: 'Construction',
    complexity: 'Small',
    estimatedHours: 6,
  },
];
