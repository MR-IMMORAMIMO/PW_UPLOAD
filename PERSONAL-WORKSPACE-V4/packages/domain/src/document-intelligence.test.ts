import { describe, expect, it } from 'vitest';
import {
  associationStateFromEvidence,
  canonicalRelationshipEndpoints,
  canTransitionDocumentLifecycle,
  compatibleTechnicalBasis,
  DOCUMENT_INTELLIGENCE_LIMITS,
  evidenceCanConfirmProject,
} from './document-intelligence';

describe('Document Intelligence domain authority', () => {
  it('keeps lifecycle, evidence strength, and canonical relationship endpoints deterministic', () => {
    expect(canTransitionDocumentLifecycle('ADMITTED', 'ACCEPTED')).toBe(true);
    expect(canTransitionDocumentLifecycle('TOMBSTONED', 'ACCEPTED')).toBe(false);
    expect(evidenceCanConfirmProject('STRONG')).toBe(true);
    expect(evidenceCanConfirmProject('MEDIUM')).toBe(false);
    expect(canonicalRelationshipEndpoints('b', 'a')).toEqual({
      leftVersionId: 'a',
      rightVersionId: 'b',
    });
  });
  it('never lets weak evidence confirm and surfaces competing or contradictory authority', () => {
    const weak = {
      id: '1',
      candidateProjectId: 'p1',
      strength: 'WEAK' as const,
      evidenceType: 'FILENAME',
      normalizedValue: 'p1',
      pageNumber: null,
      reason: 'weak',
      contradictory: false,
    };
    expect(associationStateFromEvidence([weak])).toBe('UNRESOLVED');
    expect(
      associationStateFromEvidence([
        { ...weak, strength: 'MEDIUM', candidateProjectId: 'p1' },
        { ...weak, id: '2', strength: 'MEDIUM', candidateProjectId: 'p2' },
      ]),
    ).toBe('AMBIGUOUS');
    expect(
      associationStateFromEvidence([{ ...weak, strength: 'STRONG', contradictory: true }]),
    ).toBe('CONFLICTING');
    expect(associationStateFromEvidence([{ ...weak, strength: 'STRONG' }])).toBe('LIKELY');
  });
  it('preserves unit and basis semantics and closure caps', () => {
    expect(compatibleTechnicalBasis('W', 'PER_LUMINAIRE', 'W', 'PER_LUMINAIRE')).toBe(true);
    expect(compatibleTechnicalBasis('W', 'PER_LUMINAIRE', 'W/m', 'PER_METRE')).toBe(false);
    expect(DOCUMENT_INTELLIGENCE_LIMITS.pdfBytes).toBe(50 * 1024 * 1024);
    expect(DOCUMENT_INTELLIGENCE_LIMITS.automaticOcrPages).toBe(20);
    expect(DOCUMENT_INTELLIGENCE_LIMITS.lifetimeOcrPages).toBe(40);
  });
});
