/**
 * AUTO-01B — Automatic capture capability registry + authorization authority.
 *
 * This is the centralized capture-capability allow-list authority for automatic
 * managed capture. It answers: "Is this exact managed tool / expected artifact /
 * mode / channel combination declared as capable of participating in automatic
 * capture, and is that capability operationally enabled right now?"
 *
 * Design rules (owner-locked):
 *   - Automatic capture is STRICT ALLOW-LIST. No wildcard (ANY TOOL / ANY PDF /
 *     ANY OUTPUT), no "unknown tool -> classify", no "new PDF -> guess project".
 *   - The existence of a ToolContext alone is NOT sufficient. Authorization
 *     requires BOTH a valid ToolContext AND an exact, operationally enabled
 *     allow-listed capability.
 *   - Fail-closed production default: no runtime capability is registered, so
 *     automatic capture is DENIED until a future adapter explicitly registers it.
 *   - A tool/artifact name in an enum does NOT operationally enable capture.
 *   - No filesystem watcher, staging, hashing, materialization, OCR, or capture
 *     execution lives here. This is authority only.
 */

import { DomainError } from './errors';
import type { ToolContext } from './managed-artifact';
import { toolContextCanAuthorizeNewCapture } from './managed-artifact';

/**
 * Source classes. The narrowest useful firewall authority: automatic capture is
 * NEVER authorized for protected/manual source classes, and internal-generated
 * output is capture-loop protected.
 */
export const managedSourceClasses = [
  // Protected / manual analysis source classes — never auto-captured.
  'CLIENT_RECEIVED',
  'REFERENCE',
  'SPECIFICATION',
  'RECEIVED_DRAWING',
  // General, non-managed surfaces — never auto-captured.
  'GENERAL_DOWNLOAD',
  'DESKTOP',
  'OPENED_DOCUMENT',
  // Manual explicit intake — never routed through automatic capture.
  'MANUAL_EXPLICIT',
  // The single class eligible for automatic capture (declared by a real adapter).
  'AUTOMATIC_CAPTURE',
  // Capture-loop-protected / internal-generated output — never re-ingested.
  'PACKAGE_OUTPUT',
  'REVISION_SNAPSHOT',
  'CAPTURE_STAGING',
  'RECOVERY_VERSION',
  'INTERNAL_GENERATED',
] as const;
export type ManagedSourceClass = (typeof managedSourceClasses)[number];

/** Automatic managed capture is the only source class eligible for authorization. */
export const AUTOMATIC_CAPTURE_SOURCE_CLASS = 'AUTOMATIC_CAPTURE' as const;

const protectedSourceClasses: ReadonlySet<ManagedSourceClass> = new Set([
  'CLIENT_RECEIVED',
  'REFERENCE',
  'SPECIFICATION',
  'RECEIVED_DRAWING',
  'GENERAL_DOWNLOAD',
  'DESKTOP',
  'OPENED_DOCUMENT',
  'MANUAL_EXPLICIT',
]);

const loopProtectedSourceClasses: ReadonlySet<ManagedSourceClass> = new Set([
  'PACKAGE_OUTPUT',
  'REVISION_SNAPSHOT',
  'CAPTURE_STAGING',
  'RECOVERY_VERSION',
  'INTERNAL_GENERATED',
]);

/**
 * Automatic capture must NEVER be authorized for protected or loop-protected
 * source classes (fail-closed). Returns the denial reason, or null when the
 * source class is the sole auto-capture class.
 */
export function sourceClassDenialReason(
  sourceClass: ManagedSourceClass,
): 'SOURCE_FIREWALLED' | 'CAPTURE_LOOP_PROTECTED' | null {
  if (protectedSourceClasses.has(sourceClass)) return 'SOURCE_FIREWALLED';
  if (loopProtectedSourceClasses.has(sourceClass)) return 'CAPTURE_LOOP_PROTECTED';
  return null;
}

/**
 * A single, exact, allow-listed capture capability. Automatic capture is
 * authorized only when ALL of these match the request exactly.
 */
export interface CaptureCapability {
  tool: string;
  artifactType: string;
  mode: string;
  channel: string;
  sourceClass: ManagedSourceClass;
  /** Whether automatic capture is declared allowed for this exact combination. */
  automaticCaptureAllowed: boolean;
  /**
   * Whether the capability is operationally ENABLED right now. Separate from
   * declaration so a tool/artifact combination is never authorized merely
   * because its name appears in an enum or registry entry.
   */
  operational: boolean;
}

/**
 * In-code strict allow-list registry. Future adapters explicitly call
 * `register(...)` when they become operationally capable; nothing is
 * auto-enabled by naming. Fail-closed: an empty registry denies everything.
 */
export class CaptureCapabilityRegistry {
  private readonly capabilities = new Map<string, CaptureCapability>();

  private static key(tool: string, artifactType: string, mode: string, channel: string): string {
    return [tool, artifactType, mode, channel].join('\u0000');
  }

  /**
   * Register a single exact capture capability.
   *
   * Fail-closed: capability identity is exactly the (tool, artifactType, mode,
   * channel) tuple. A SECOND registration of the same exact tuple is REJECTED
   * truthfully (DomainError CONFLICT) and the registry state is left unchanged.
   * This guarantees authorization never depends on adapter registration order:
   * a later duplicate can neither downgrade nor upgrade the original
   * registration, regardless of `operational` / `automaticCaptureAllowed`.
   */
  public register(capability: CaptureCapability): void {
    const key = CaptureCapabilityRegistry.key(
      capability.tool,
      capability.artifactType,
      capability.mode,
      capability.channel,
    );
    if (this.capabilities.has(key)) {
      throw new DomainError(
        'CONFLICT',
        `A capture capability for tool "${capability.tool}", artifact type "${capability.artifactType}", mode "${capability.mode}", channel "${capability.channel}" is already registered.`,
        409,
        {
          tool: capability.tool,
          artifactType: capability.artifactType,
          mode: capability.mode,
          channel: capability.channel,
        },
      );
    }
    this.capabilities.set(key, capability);
  }

  /**
   * Exact capability lookup. Returns `undefined` when no exact combination is
   * registered — never a wildcard fallthrough.
   */
  public findExact(
    tool: string,
    artifactType: string,
    mode: string,
    channel: string,
  ): CaptureCapability | undefined {
    return this.capabilities.get(CaptureCapabilityRegistry.key(tool, artifactType, mode, channel));
  }
}

/** Stable, explainable authorization outcome for a new automatic capture attempt. */
export type CaptureAuthorizationOutcome = 'AUTHORIZED' | 'DENIED';

export type CaptureAuthorizationReason =
  | 'CONTEXT_NOT_FOUND'
  | 'PROJECT_MISMATCH'
  | 'CONTEXT_EXPIRED'
  | 'CONTEXT_CLOSED'
  | 'TOOL_MISMATCH'
  | 'ARTIFACT_TYPE_MISMATCH'
  | 'MODE_MISMATCH'
  | 'CHANNEL_MISMATCH'
  | 'CAPABILITY_NOT_ALLOWLISTED'
  | 'CAPABILITY_NOT_READY'
  | 'SOURCE_FIREWALLED'
  | 'CAPTURE_LOOP_PROTECTED';

export type CaptureAuthorizationResult =
  { outcome: 'AUTHORIZED' } | { outcome: 'DENIED'; reason: CaptureAuthorizationReason };

/** Minimal inputs needed to authorize a NEW automatic capture attempt. */
export interface NewCaptureAuthorizationRequest {
  projectId: string;
  tool: string;
  expectedArtifactType: string;
  mode: string;
  channel: string;
  sourceClass: ManagedSourceClass;
}

/**
 * The ONE canonical decision operation for a NEW automatic capture attempt.
 *
 * Verifies (in order):
 *   1. ToolContext exists            -> CONTEXT_NOT_FOUND
 *   2. context.projectId === project -> PROJECT_MISMATCH
 *   3. state LIVE/REBOUND            -> CONTEXT_EXPIRED / CONTEXT_CLOSED
 *   4. tool matches                  -> TOOL_MISMATCH
 *   5. artifact type matches         -> ARTIFACT_TYPE_MISMATCH
 *   6. mode matches                  -> MODE_MISMATCH
 *   7. channel matches               -> CHANNEL_MISMATCH
 *   8. source class not firewalled/loop-protected -> SOURCE_FIREWALLED / CAPTURE_LOOP_PROTECTED
 *   9. exact allow-listed capability -> CAPABILITY_NOT_ALLOWLISTED
 *  10. capability operationally enabled -> CAPABILITY_NOT_READY
 *
 * This does NOT authorize recovery of an already-DETECTED capture (that is a
 * separate, AUTO-01C concern driven by the CaptureLedger). It never reads Work
 * Session state: a managed ToolContext authorizes without any active Work
 * Session. `context` is nullable so an unknown context fails truthfully.
 */
export function authorizeNewCapture(
  context: ToolContext | null,
  capability: CaptureCapability | null | undefined,
  request: NewCaptureAuthorizationRequest,
): CaptureAuthorizationResult {
  if (context === null) return { outcome: 'DENIED', reason: 'CONTEXT_NOT_FOUND' };
  if (context.projectId !== request.projectId) {
    return { outcome: 'DENIED', reason: 'PROJECT_MISMATCH' };
  }
  if (context.state === 'EXPIRED') return { outcome: 'DENIED', reason: 'CONTEXT_EXPIRED' };
  if (context.state === 'CLOSED') return { outcome: 'DENIED', reason: 'CONTEXT_CLOSED' };
  if (!toolContextCanAuthorizeNewCapture(context.state)) {
    // Defensive: only LIVE/REBOUND may authorize; never fall through.
    return { outcome: 'DENIED', reason: 'CONTEXT_CLOSED' };
  }
  if (context.tool !== request.tool) return { outcome: 'DENIED', reason: 'TOOL_MISMATCH' };
  if (context.expectedArtifactType !== request.expectedArtifactType) {
    return { outcome: 'DENIED', reason: 'ARTIFACT_TYPE_MISMATCH' };
  }
  if (context.mode !== request.mode) return { outcome: 'DENIED', reason: 'MODE_MISMATCH' };
  if (context.channel !== request.channel) return { outcome: 'DENIED', reason: 'CHANNEL_MISMATCH' };

  const sourceBlock = sourceClassDenialReason(request.sourceClass);
  if (sourceBlock === 'SOURCE_FIREWALLED')
    return { outcome: 'DENIED', reason: 'SOURCE_FIREWALLED' };
  if (sourceBlock === 'CAPTURE_LOOP_PROTECTED') {
    return { outcome: 'DENIED', reason: 'CAPTURE_LOOP_PROTECTED' };
  }

  if (capability === undefined || capability === null) {
    return { outcome: 'DENIED', reason: 'CAPABILITY_NOT_ALLOWLISTED' };
  }
  if (
    capability.tool !== request.tool ||
    capability.artifactType !== request.expectedArtifactType ||
    capability.mode !== request.mode ||
    capability.channel !== request.channel
  ) {
    return { outcome: 'DENIED', reason: 'CAPABILITY_NOT_ALLOWLISTED' };
  }
  if (!capability.automaticCaptureAllowed) {
    return { outcome: 'DENIED', reason: 'CAPABILITY_NOT_ALLOWLISTED' };
  }
  if (!capability.operational) return { outcome: 'DENIED', reason: 'CAPABILITY_NOT_READY' };
  return { outcome: 'AUTHORIZED' };
}
