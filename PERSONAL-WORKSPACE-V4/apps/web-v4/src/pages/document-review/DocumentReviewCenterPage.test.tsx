/** @vitest-environment jsdom */
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupV4, renderV4, stubMatchMedia } from '../../test-utils/renderV4';
import { DocumentReviewCenterPage } from './DocumentReviewCenterPage';

const apiMock = vi.hoisted(() => ({
  documents: vi.fn(),
  document: vi.fn(),
  documentEvidence: vi.fn(),
  documentAssociationEvidence: vi.fn(),
  documentFindings: vi.fn(),
  documentRelationships: vi.fn(),
  documentDecisions: vi.fn(),
  documentRoutingProposals: vi.fn(),
  documentPreview: vi.fn(),
  decideDocument: vi.fn(),
  retryDocumentProcessing: vi.fn(),
  createDocumentAdmission: vi.fn(),
  completeDocumentAdmission: vi.fn(),
  recomputeDocumentConsistency: vi.fn(),
}));
vi.mock('../../api/environment', () => ({ api: apiMock }));
vi.mock('../../desktop/integrations', () => ({
  executeDocumentSourceHandoff: vi.fn().mockResolvedValue('completed'),
}));
const id = '11111111-1111-4111-8111-111111111111';
const version = '22222222-2222-4222-8222-222222222222';
const projectA = '55555555-5555-4555-8555-555555555555';
const projectB = '66666666-6666-4666-8666-666666666666';
const document = {
  id,
  originalFileName: 'Alpha Palace REV 01.pdf',
  lifecycle: 'NEEDS_REVIEW' as const,
  processingState: 'COMPLETE' as const,
  classification: 'DIALUX_CALCULATION_REPORT' as const,
  classificationConfidence: 96,
  associationState: 'CONFLICTING' as const,
  confirmedProjectId: null,
  activeVersionId: version,
  activeVersionSequence: 1,
  comparisonEnabled: false,
  rowVersion: 1,
  blockingFindings: 1,
  warningFindings: 1,
  admittedAt: '2026-08-27T08:00:00.000Z',
  updatedAt: '2026-08-27T08:01:00.000Z',
};
beforeEach(() => {
  vi.clearAllMocks();
  stubMatchMedia();
  window.localStorage.clear();
  apiMock.documents.mockResolvedValue({ items: [document], totalCount: 1, page: 0, pageSize: 50 });
  apiMock.documentEvidence.mockResolvedValue({
    items: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        versionId: version,
        pageNumber: 1,
        region: null,
        rawValue: 'Average Illuminance: 500 lx',
        normalizedValue: 500,
        canonicalField: 'ILLUMINANCE_AVERAGE',
        unit: 'lx',
        basis: null,
        method: 'NATIVE_TEXT',
        confidence: 95,
        adapterId: 'DIALUX_ENGLISH_V1',
        extractorVersion: '1',
        warnings: [],
      },
    ],
    totalCount: 1,
  });
  apiMock.documentAssociationEvidence.mockResolvedValue([
    {
      id: '77777777-7777-4777-8777-777777777777',
      candidateProjectId: projectA,
      strength: 'STRONG',
      evidenceType: 'CONTROLLED_PROJECT_CONTEXT',
      normalizedValue: projectA,
      pageNumber: null,
      reason: 'The admission was initiated from a server-controlled Project context.',
      contradictory: true,
    },
    {
      id: '88888888-8888-4888-8888-888888888888',
      candidateProjectId: projectB,
      strength: 'STRONG',
      evidenceType: 'EXTRACTED_UUID',
      normalizedValue: projectB,
      pageNumber: 2,
      reason: 'An explicit UUID was extracted from document text.',
      contradictory: true,
    },
  ]);
  apiMock.documentFindings.mockResolvedValue([
    {
      id: '44444444-4444-4444-8444-444444444444',
      documentId: id,
      versionId: version,
      code: 'PROJECT_ASSOCIATION_CONFLICT',
      severity: 'BLOCKING',
      state: 'OPEN',
      title: 'Project association conflict',
      explanation: 'Strong evidence conflicts.',
      recommendedAction: 'Owner review',
      generationFingerprint: 'a'.repeat(64),
      rowVersion: 1,
    },
  ]);
  apiMock.documentRelationships.mockResolvedValue([]);
  apiMock.documentDecisions.mockResolvedValue([]);
  apiMock.documentRoutingProposals.mockResolvedValue([]);
  apiMock.documentPreview.mockResolvedValue({
    pageNumber: 1,
    width: 800,
    height: 1000,
    mediaType: 'image/png',
    pngBase64: 'AA==',
    evidence: [],
  });
  apiMock.decideDocument.mockResolvedValue({ ...document, lifecycle: 'ACCEPTED', rowVersion: 2 });
  apiMock.document.mockResolvedValue(document);
  apiMock.retryDocumentProcessing.mockResolvedValue({});
  apiMock.recomputeDocumentConsistency.mockResolvedValue({
    fingerprint: 'b'.repeat(64),
    findings: 0,
    eligibleDocuments: 2,
    affectedDocumentIds: [],
  });
});
afterEach(() => cleanupV4());
describe('Document Review Center', () => {
  it('renders the bounded queue, source evidence, all Inspector authority sections, status text, and preview alt text', async () => {
    renderV4(<DocumentReviewCenterPage />, ['/documents']);
    expect((await screen.findAllByText('Alpha Palace REV 01.pdf')).length).toBeGreaterThanOrEqual(
      2,
    );
    expect(screen.getAllByText('Conflicting').length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByText('500')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: 'Bounded evidence preview, page 1' }),
    ).toBeInTheDocument();
    for (const label of [
      'Identity',
      'Classification',
      'Project Association',
      'Extracted Data',
      'Cross-document Consistency',
      'Quality findings (1)',
      'Cross-document Conflicts',
      'Relationships (0)',
      'Evidence',
      'Owner decisions (0)',
      'Routing Proposal (0)',
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    expect(globalThis.document.querySelector('.document-review__workspace')).toBeTruthy();
  });
  it('shows competing ambiguous candidates and reasons without auto-confirming or exposing a local path', async () => {
    apiMock.documents.mockResolvedValue({
      items: [{ ...document, associationState: 'AMBIGUOUS' }],
      totalCount: 1,
      page: 0,
      pageSize: 50,
    });
    apiMock.documentAssociationEvidence.mockResolvedValue([
      {
        id: '77777777-7777-4777-8777-777777777777',
        candidateProjectId: projectA,
        strength: 'MEDIUM',
        evidenceType: 'EXACT_PROJECT_NAME',
        normalizedValue: 'ALPHA PALACE',
        pageNumber: 1,
        reason: 'Exact normalized Project name appears in extracted document text.',
        contradictory: false,
      },
      {
        id: '88888888-8888-4888-8888-888888888888',
        candidateProjectId: projectB,
        strength: 'MEDIUM',
        evidenceType: 'EXACT_PROJECT_NAME',
        normalizedValue: 'C:\\Users\\Owner\\private-project',
        pageNumber: 1,
        reason: 'A second exact normalized Project name appears in extracted document text.',
        contradictory: false,
      },
    ]);
    renderV4(<DocumentReviewCenterPage />, ['/documents']);
    expect((await screen.findAllByText(projectA)).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(projectB).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('MEDIUM · Supporting')).toHaveLength(2);
    expect(screen.getByText('Local path hidden')).toBeInTheDocument();
    expect(screen.queryByText(/C:\\Users/)).not.toBeInTheDocument();
    expect(apiMock.decideDocument).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Project UUID')).toHaveValue('');
  });
  it('shows conflicting strong evidence and refreshes authority after a stale association decision', async () => {
    apiMock.decideDocument.mockRejectedValue(
      new Error('Document review changed. Refresh before deciding.'),
    );
    renderV4(<DocumentReviewCenterPage />, ['/documents']);
    expect(await screen.findAllByText('STRONG · Contradictory')).toHaveLength(2);
    expect(screen.getByText('Controlled Project Context')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Use candidate' })[1]!);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before deciding');
    expect(apiMock.decideDocument).toHaveBeenCalledWith(
      id,
      expect.objectContaining({
        action: 'CONFIRM_PROJECT_ASSOCIATION',
        projectId: projectB,
        expectedRowVersion: 1,
      }),
    );
    expect(apiMock.document).toHaveBeenCalledWith(id);
  });
  it('recomputes through the Project authority, refreshes findings, and displays every source value with no winner', async () => {
    const accepted = {
      ...document,
      lifecycle: 'ACCEPTED' as const,
      associationState: 'CONFIRMED' as const,
      confirmedProjectId: projectA,
      comparisonEnabled: true,
    };
    apiMock.documents.mockResolvedValue({
      items: [accepted],
      totalCount: 1,
      page: 0,
      pageSize: 50,
    });
    apiMock.document.mockResolvedValue(accepted);
    apiMock.documentFindings.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: '99999999-9999-4999-8999-999999999999',
        documentId: id,
        versionId: version,
        code: 'LUMINAIRE_QUANTITY_CONFLICT',
        severity: 'WARNING',
        state: 'OPEN',
        title: 'Quantity conflict',
        explanation: 'Accepted source values differ.',
        recommendedAction: 'Review every source value.',
        generationFingerprint: 'b'.repeat(64),
        rowVersion: 1,
        competingValues: [
          {
            documentId: id,
            versionId: version,
            field: 'QUANTITY',
            value: 24,
            unit: 'ea',
            basis: 'count',
            tag: 'DL01',
          },
          {
            documentId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            versionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            field: 'QUANTITY',
            value: 22,
            unit: 'ea',
            basis: 'count',
            tag: 'DL01',
          },
        ],
      },
    ]);
    apiMock.recomputeDocumentConsistency.mockResolvedValue({
      fingerprint: 'b'.repeat(64),
      findings: 1,
      eligibleDocuments: 3,
      affectedDocumentIds: [id],
    });
    renderV4(<DocumentReviewCenterPage />, ['/documents']);
    fireEvent.click(await screen.findByRole('button', { name: 'Recompute consistency' }));
    await waitFor(() =>
      expect(apiMock.recomputeDocumentConsistency).toHaveBeenCalledWith(
        projectA,
        expect.any(String),
      ),
    );
    expect(await screen.findByText('Luminaire Quantity Conflict')).toBeInTheDocument();
    expect(screen.getByText(/No winner is selected/)).toBeInTheDocument();
    expect(screen.getByText('24 ea · count')).toBeInTheDocument();
    expect(screen.getByText('22 ea · count')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
  it('uses server-backed filters and an audited CAS Owner action while retaining visible keyboard focus targets', async () => {
    renderV4(<DocumentReviewCenterPage />, ['/documents']);
    await screen.findAllByText('Alpha Palace REV 01.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'OCR Needed' }));
    await waitFor(() =>
      expect(apiMock.documents).toHaveBeenLastCalledWith(
        expect.objectContaining({ findingCode: 'OCR_REQUIRED' }),
      ),
    );
    const accept = screen.getByRole('button', { name: 'Accept intelligence' });
    accept.focus();
    expect(accept).toHaveFocus();
    fireEvent.click(accept);
    await waitFor(() =>
      expect(apiMock.decideDocument).toHaveBeenCalledWith(id, {
        action: 'ACCEPT_DOCUMENT',
        expectedRowVersion: 1,
        reason: 'Owner reviewed and accepted the document intelligence.',
      }),
    );
  });
  it('shows a stale/error state without dropping the existing evidence workspace', async () => {
    apiMock.decideDocument.mockRejectedValue(
      new Error('Document review changed. Refresh before deciding.'),
    );
    renderV4(<DocumentReviewCenterPage />, ['/documents']);
    await screen.findAllByText('Alpha Palace REV 01.pdf');
    fireEvent.click(screen.getByRole('button', { name: 'Accept intelligence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Refresh before deciding');
    expect(screen.getByLabelText('Evidence')).toBeInTheDocument();
  });
});
