import { randomUUID } from 'node:crypto';
import {
  associationStateFromEvidence,
  type DocumentAssociationEvidence,
  type ProjectAssociationState,
} from '@scli/domain';
import type { Project } from '@scli/domain';

export class ProjectAssociationService {
  public evaluate(
    text: string,
    initialProjectContextId: string | null,
    projects: readonly Pick<
      Project,
      'id' | 'projectCode' | 'projectName' | 'clientName' | 'siteLocation'
    >[] = [],
  ): {
    state: ProjectAssociationState;
    evidence: DocumentAssociationEvidence[];
  } {
    const evidence: DocumentAssociationEvidence[] = [];
    const embeddedUuids = [
      ...text.matchAll(
        /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi,
      ),
    ].map((match) => match[0]!.toLowerCase());
    if (initialProjectContextId) {
      evidence.push({
        id: randomUUID(),
        candidateProjectId: initialProjectContextId,
        strength: 'STRONG',
        evidenceType: 'CONTROLLED_PROJECT_CONTEXT',
        normalizedValue: initialProjectContextId,
        pageNumber: null,
        reason: 'The admission was initiated from a server-controlled Project context.',
        contradictory: embeddedUuids.some(
          (value) => value !== initialProjectContextId.toLowerCase(),
        ),
      });
    }
    for (const candidate of embeddedUuids.slice(0, 10)) {
      evidence.push({
        id: randomUUID(),
        candidateProjectId: candidate,
        strength: 'STRONG',
        evidenceType: 'EXTRACTED_UUID',
        normalizedValue: candidate,
        pageNumber: null,
        reason: 'An explicit UUID was extracted from document text.',
        contradictory: Boolean(
          initialProjectContextId && candidate !== initialProjectContextId.toLowerCase(),
        ),
      });
    }
    const normalizedText = ` ${text
      .toLocaleUpperCase('en')
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim()} `;
    for (const project of projects.slice(0, 500)) {
      const projectName = project.projectName
        .toLocaleUpperCase('en')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
      const client = project.clientName
        .toLocaleUpperCase('en')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
      const site = project.siteLocation
        .toLocaleUpperCase('en')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
      if (projectName.length >= 3 && normalizedText.includes(` ${projectName} `))
        evidence.push({
          id: randomUUID(),
          candidateProjectId: project.id,
          strength: 'MEDIUM',
          evidenceType: 'EXACT_PROJECT_NAME',
          normalizedValue: projectName,
          pageNumber: null,
          reason: 'Exact normalized Project name appears in extracted document text.',
          contradictory: false,
        });
      else if (
        client.length >= 3 &&
        site.length >= 3 &&
        normalizedText.includes(` ${client} `) &&
        normalizedText.includes(` ${site} `)
      )
        evidence.push({
          id: randomUUID(),
          candidateProjectId: project.id,
          strength: 'MEDIUM',
          evidenceType: 'EXACT_CLIENT_SITE',
          normalizedValue: `${client}|${site}`,
          pageNumber: null,
          reason: 'Exact client and site combination appears in extracted document text.',
          contradictory: false,
        });
      const code = project.projectCode
        .toLocaleUpperCase('en')
        .replace(/[^A-Z0-9]+/g, ' ')
        .trim();
      if (code.length >= 3 && normalizedText.includes(` ${code} `))
        evidence.push({
          id: randomUUID(),
          candidateProjectId: project.id,
          strength: 'WEAK',
          evidenceType: 'PROJECT_CODE_ONLY',
          normalizedValue: code,
          pageNumber: null,
          reason: 'Project Code alone is weak evidence and cannot confirm association.',
          contradictory: false,
        });
    }
    return { state: associationStateFromEvidence(evidence), evidence };
  }
}
