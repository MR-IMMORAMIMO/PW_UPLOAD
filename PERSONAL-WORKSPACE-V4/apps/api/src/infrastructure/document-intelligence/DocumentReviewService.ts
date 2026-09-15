import type { OwnerDocumentDecisionInput } from '@scli/contracts';
import type { DocumentActor } from '@scli/domain';
import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';

export class DocumentReviewService {
  public constructor(private readonly store: DocumentIntelligenceStore) {}
  public decide(documentId: string, input: OwnerDocumentDecisionInput, actor: DocumentActor) {
    return this.store.applyDecision(documentId, input, actor);
  }
}
