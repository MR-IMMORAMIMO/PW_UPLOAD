/**
 * AUTO-01B — Tool Context service authority (API/service layer).
 *
 * The ONE narrow Tool Context authority that owns product lifecycle semantics
 * (open / expire / rebind / close / get / list / automatic-capture
 * authorization). Callers must NOT reach for the low-level store
 * `setToolContextState(...)` to drive lifecycle semantics — this service is the
 * canonical owner of those transitions.
 *
 * Separation (owner-locked):
 *   - Tool Context is artifact/provenance authorization; Work Session is
 *     time/work tracking. No Work Session is required for a valid Tool Context,
 *     and automatic-capture authorization never reads Work Session state.
 *   - There is NO single global active project; multiple contexts across
 *     projects/tools may coexist (ToolContextId is the identity).
 *
 * Lifecycle (locked, from the domain `transitionToolContext` policy):
 *   CREATE -> LIVE; LIVE -> EXPIRED/CLOSED; EXPIRED -> REBOUND/CLOSED;
 *   REBOUND -> EXPIRED/CLOSED; CLOSED is terminal. Invalid transitions throw
 *   `DomainError('INVALID_TRANSITION', 409)`; no second context is created to
 *   hide an invalid transition.
 *
 * Deletion: NOT exposed. A Tool Context is provenance/audit authority; CLOSED
 * replaces deletion, and a closed context remains readable for historical audit.
 *
 * No filesystem watcher, staging, hashing, materialization, capture execution,
 * tool launching, OCR, or UI lives here.
 */

import { DomainError, authorizeNewCapture, transitionToolContext } from '@scli/domain';
import type {
  CaptureAuthorizationResult,
  ManagedSourceClass,
  NewCaptureAuthorizationRequest,
  ToolContext,
} from '@scli/domain';
import { ManagedArtifactStore } from './ManagedArtifactStore';

/** Inputs to open (create) a new LIVE Tool Context. */
export interface OpenToolContextInput {
  projectId: string;
  targetRevisionId?: string | null;
  sourceDocumentId?: string | null;
  tool: string;
  expectedArtifactType: string;
  mode: string;
  channel: string;
  openedAt: string;
}

type LifecycleTransition = 'EXPIRED' | 'REBOUND' | 'CLOSED';

/**
 * One narrow service authority for Tool Context lifecycle + new-capture
 * authorization. Wraps the existing `ManagedArtifactStore` persistence; it does
 * NOT duplicate ToolContext storage.
 */
export class ToolContextService {
  private readonly store: ManagedArtifactStore;

  public constructor(store: ManagedArtifactStore) {
    this.store = store;
  }

  /** Open a new context. Starts LIVE (never implicitly REBOUND). */
  public open(input: OpenToolContextInput): ToolContext {
    return this.store.createToolContext({ ...input, state: 'LIVE' });
  }

  public get(toolContextId: string): ToolContext {
    return this.store.getToolContext(toolContextId);
  }

  public list(projectId?: string): ToolContext[] {
    return this.store.listToolContexts(projectId);
  }

  /** LIVE -> EXPIRED (stamps expiredAt). */
  public expire(toolContextId: string, at: string): ToolContext {
    return this.apply(this.get(toolContextId), 'EXPIRED', at);
  }

  /** EXPIRED -> REBOUND (explicit; preserves identity-defining fields). */
  public rebind(toolContextId: string, at: string): ToolContext {
    return this.apply(this.get(toolContextId), 'REBOUND', at);
  }

  /** LIVE/EXPIRED/REBOUND -> CLOSED (terminal; kept for audit, never deleted). */
  public close(toolContextId: string, at: string): ToolContext {
    return this.apply(this.get(toolContextId), 'CLOSED', at);
  }

  private apply(context: ToolContext, to: LifecycleTransition, at: string): ToolContext {
    // The domain policy validates the transition and throws INVALID_TRANSITION
    // (409) when forbidden. It never fabricates a second context.
    const next = transitionToolContext(context, to, at);
    return this.store.setToolContextState(next.toolContextId, to, at);
  }

  /**
   * THE canonical decision operation for a NEW automatic capture attempt.
   *
   * A valid context alone is NOT sufficient: authorization requires BOTH a
   * valid ToolContext AND an exact, operationally enabled allow-listed
   * capability. No wildcard (ANY TOOL / ANY PDF / ANY OUTPUT). An EXPIRED
   * context may only support recovery of an already-DETECTED capture (AUTO-01C),
   * never a new capture. Never reads Work Session state.
   */
  public authorizeNewCapture(
    projectId: string,
    toolContextId: string,
    tool: string,
    expectedArtifactType: string,
    mode: string,
    channel: string,
    sourceClass: ManagedSourceClass,
    capability: Parameters<typeof authorizeNewCapture>[1],
  ): CaptureAuthorizationResult {
    let context: ToolContext | null;
    try {
      context = this.get(toolContextId);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'NOT_FOUND') {
        context = null;
      } else {
        throw error;
      }
    }
    const request: NewCaptureAuthorizationRequest = {
      projectId,
      tool,
      expectedArtifactType,
      mode,
      channel,
      sourceClass,
    };
    return authorizeNewCapture(context, capability, request);
  }
}
