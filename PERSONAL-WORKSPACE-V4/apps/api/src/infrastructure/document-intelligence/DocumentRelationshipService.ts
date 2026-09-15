import type { DocumentIntelligenceStore } from './DocumentIntelligenceStore.js';

export class DocumentRelationshipService {
  public constructor(private readonly store: DocumentIntelligenceStore) {}
  public list(documentId: string) {
    return this.store.relationships(documentId);
  }
}
