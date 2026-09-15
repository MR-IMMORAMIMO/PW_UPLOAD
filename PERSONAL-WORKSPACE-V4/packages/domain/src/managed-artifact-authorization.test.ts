/**
 * AUTO-01B — Tool Context lifecycle + automatic-capture allow-list authority (domain).
 *
 * Pure domain authority proving the owner-locked rules:
 *   - Tool Context lifecycle transitions (CREATE->LIVE->EXPIRED/CLOSED, REBOUND, CLOSED terminal).
 *   - Exact capture-capability allow-list matching (no wildcard).
 *   - Source-class firewall (Received/Reference/Specification/Received Drawing), general
 *     Downloads/Desktop, existing/opened documents, and manual explicit intake.
 *   - Capture-loop protection (Package output, Revision snapshot, staging, recovery, internal).
 *   - No Work Session coupling.
 *   - Rebind preserves identity-defining fields.
 *
 * This is authority ONLY. No filesystem watcher, no staging, no capture execution, no UI.
 */

import { describe, expect, it } from 'vitest';
import {
  DomainError,
  toolContextCanAuthorizeNewCapture,
  canTransitionToolContext,
  transitionToolContext,
  type ToolContext,
  type ToolContextState,
} from './index';
import {
  CaptureCapabilityRegistry,
  AUTOMATIC_CAPTURE_SOURCE_CLASS,
  authorizeNewCapture,
  type CaptureCapability,
  type NewCaptureAuthorizationRequest,
} from './index';

const UUID_A = 'a0000000-0000-4000-8000-0000000000a1';
const UUID_B = 'a0000000-0000-4000-8000-0000000000a2';
const UUID_C = 'a0000000-0000-4000-8000-0000000000a3';
const AT = '2026-08-20T09:00:00.000Z';

function makeContext(overrides: Partial<ToolContext> & { state: ToolContextState }): ToolContext {
  return {
    toolContextId: UUID_A,
    projectId: UUID_B,
    targetRevisionId: null,
    sourceDocumentId: null,
    tool: 'AutoCAD',
    expectedArtifactType: 'LightingLayout',
    mode: 'Working',
    channel: 'autocad-session-1',
    openedAt: AT,
    closedAt: null,
    expiredAt: null,
    createdAt: AT,
    ...overrides,
  };
}

function makeCapability(overrides: Partial<CaptureCapability> = {}): CaptureCapability {
  return {
    tool: 'AutoCAD',
    artifactType: 'LightingLayout',
    mode: 'Working',
    channel: 'autocad-session-1',
    sourceClass: AUTOMATIC_CAPTURE_SOURCE_CLASS,
    automaticCaptureAllowed: true,
    operational: true,
    ...overrides,
  };
}

function authorizeRequest(
  overrides: Partial<NewCaptureAuthorizationRequest> = {},
): NewCaptureAuthorizationRequest {
  return {
    projectId: UUID_B,
    tool: 'AutoCAD',
    expectedArtifactType: 'LightingLayout',
    mode: 'Working',
    channel: 'autocad-session-1',
    sourceClass: AUTOMATIC_CAPTURE_SOURCE_CLASS,
    ...overrides,
  };
}

describe('AUTO-010B ToolContext lifecycle transitions', () => {
  it('A1: a newly created context is LIVE and may authorize', () => {
    const live = makeContext({ state: 'LIVE' });
    expect(live.state).toBe('LIVE');
    expect(toolContextCanAuthorizeNewCapture(live.state)).toBe(true);
  });

  it('A2: LIVE -> EXPIRED allowed', () => {
    expect(canTransitionToolContext('LIVE', 'EXPIRED')).toBe(true);
    const next = transitionToolContext(makeContext({ state: 'LIVE' }), 'EXPIRED', AT);
    expect(next.state).toBe('EXPIRED');
    expect(next.expiredAt).toBe(AT);
  });

  it('A3: LIVE -> CLOSED allowed', () => {
    expect(canTransitionToolContext('LIVE', 'CLOSED')).toBe(true);
    const next = transitionToolContext(makeContext({ state: 'LIVE' }), 'CLOSED', AT);
    expect(next.state).toBe('CLOSED');
    expect(next.closedAt).toBe(AT);
  });

  it('A4: EXPIRED -> REBOUND allowed', () => {
    expect(canTransitionToolContext('EXPIRED', 'REBOUND')).toBe(true);
    const next = transitionToolContext(makeContext({ state: 'EXPIRED' }), 'REBOUND', AT);
    expect(next.state).toBe('REBOUND');
  });

  it('A5: EXPIRED -> CLOSED allowed', () => {
    expect(canTransitionToolContext('EXPIRED', 'CLOSED')).toBe(true);
    const next = transitionToolContext(makeContext({ state: 'EXPIRED' }), 'CLOSED', AT);
    expect(next.state).toBe('CLOSED');
  });

  it('A6: REBOUND -> EXPIRED allowed', () => {
    expect(canTransitionToolContext('REBOUND', 'EXPIRED')).toBe(true);
    const next = transitionToolContext(makeContext({ state: 'REBOUND' }), 'EXPIRED', AT);
    expect(next.state).toBe('EXPIRED');
    expect(next.expiredAt).toBe(AT);
  });

  it('A7: REBOUND -> CLOSED allowed', () => {
    expect(canTransitionToolContext('REBOUND', 'CLOSED')).toBe(true);
    const next = transitionToolContext(makeContext({ state: 'REBOUND' }), 'CLOSED', AT);
    expect(next.state).toBe('CLOSED');
  });

  it('A8: CLOSED is terminal (no outgoing transitions)', () => {
    for (const target of ['LIVE', 'REBOUND', 'EXPIRED', 'CLOSED'] as const) {
      expect(canTransitionToolContext('CLOSED', target)).toBe(false);
    }
  });

  it('A9: EXPIRED -> LIVE rejected truthfully', () => {
    expect(canTransitionToolContext('EXPIRED', 'LIVE')).toBe(false);
    expect(() => transitionToolContext(makeContext({ state: 'EXPIRED' }), 'LIVE', AT)).toThrow(
      DomainError,
    );
  });

  it('A10: LIVE -> REBOUND rejected truthfully', () => {
    expect(canTransitionToolContext('LIVE', 'REBOUND')).toBe(false);
    expect(() => transitionToolContext(makeContext({ state: 'LIVE' }), 'REBOUND', AT)).toThrow(
      DomainError,
    );
  });
});

describe('AUTO-010 Authorization state eligibility', () => {
  it('A11: LIVE authorizes when the exact capability exists', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest(),
    );
    expect(result.outcome).toBe('AUTHORIZED');
  });

  it('A12: REBOUND authorizes when the exact capability exists', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'REBOUND' }),
      makeCapability(),
      authorizeRequest(),
    );
    expect(result.outcome).toBe('AUTHORIZED');
  });

  it('A13: EXPIRED cannot authorize a new capture', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'EXPIRED' }),
      makeCapability(),
      authorizeRequest(),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('CONTEXT_EXPIRED');
  });

  it('A14: CLOSED cannot authorize a new capture', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'CLOSED' }),
      makeCapability(),
      authorizeRequest(),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('CONTEXT_CLOSED');
  });
});

describe('AUTO-010 Ownership', () => {
  it('C15: project mismatch denies', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE', projectId: UUID_B }),
      makeCapability(),
      authorizeRequest({ projectId: UUID_C }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('PROJECT_MISMATCH');
  });

  it('C16: context identity is the UUID authority', () => {
    const context = makeContext({ state: 'LIVE', toolContextId: UUID_A });
    expect(context.toolContextId).toBe(UUID_A);
    expect(context.toolContextId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('C17: concurrent contexts across projects/tools coexist (no global active project)', () => {
    const ctxA = makeContext({ state: 'LIVE', toolContextId: UUID_A, tool: 'AutoCAD' });
    const ctxB = makeContext({ state: 'LIVE', toolContextId: UUID_B, tool: 'DIALux' });
    const ctxC = makeContext({ state: 'LIVE', toolContextId: UUID_C, tool: 'Presentation' });
    // All three coexist as independent authorities.
    expect(ctxA.toolContextId).not.toBe(ctxB.toolContextId);
    expect(ctxB.toolContextId).not.toBe(ctxC.toolContextId);
    expect(toolContextCanAuthorize(ctxA.state)).toBe(true);
    expect(toolContextCanAuthorize(ctxB.state)).toBe(true);
    expect(toolContextCanAuthorize(ctxC.state)).toBe(true);
  });
});

describe('AUTO-010 Exact capability matching', () => {
  it('D18: exact tool match required', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest({ tool: 'DIALux' }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('TOOL_MISMATCH');
  });

  it('D19: exact artifact type required', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest({ expectedArtifactType: 'DialuxReport' }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('ARTIFACT_TYPE_MISMATCH');
  });

  it('D20: exact mode required', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest({ mode: 'Production' }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('MODE_MISMATCH');
  });

  it('D21: exact channel required', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest({ channel: 'dialux-session-2' }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('CHANNEL_MISMATCH');
  });

  it('D22: unknown capability denied', () => {
    // Registry returns no capability for an unregistered combination -> capability null.
    const result = authorizeNewCapture(makeContext({ state: 'LIVE' }), null, authorizeRequest());
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('CAPABILITY_NOT_ALLOWLISTED');
  });

  it('D23: declared-but-not-operational capability denied (readiness separate)', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability({ automaticCaptureAllowed: true, operational: false }),
      authorizeRequest(),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('CAPABILITY_NOT_READY');
  });

  it('D24: no wildcard fallthrough', () => {
    // A capability that claims any tool must not authorize a specific tool.
    const wildcard = makeCapability({
      tool: 'ANY',
      operational: true,
      automaticCaptureAllowed: true,
    });
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      wildcard,
      authorizeRequest(),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('CAPABILITY_NOT_ALLOWLISTED');
  });
});

describe('AUTO-010 Firewall and source classes', () => {
  it('E25: Received / Reference / Specification source classes are denied', () => {
    for (const sourceClass of [
      'CLIENT_RECEIVED',
      'REFERENCE',
      'SPECIFICATION',
      'RECEIVED_DRAWING',
    ] as const) {
      const result = authorizeNewCapture(
        makeContext({ state: 'LIVE' }),
        makeCapability(),
        authorizeRequest({ sourceClass }),
      );
      expect(result.outcome).toBe('DENIED');
      if (result.outcome === 'DENIED') expect(result.reason).toBe('SOURCE_FIREWALLED');
    }
  });

  it('E26: arbitrary Downloads / Desktop sources denied', () => {
    for (const sourceClass of ['GENERAL_DOWNLOAD', 'DESKTOP'] as const) {
      const result = authorizeNewCapture(
        makeContext({ state: 'LIVE' }),
        makeCapability(),
        authorizeRequest({ sourceClass }),
      );
      expect(result.outcome).toBe('DENIED');
      if (result.outcome === 'DENIED') expect(result.reason).toBe('SOURCE_FIREWALLED');
    }
  });

  it('E27: package output / revision snapshot / staging / internal generated denied', () => {
    for (const sourceClass of [
      'PACKAGE_OUTPUT',
      'REVISION_SNAPSHOT',
      'CAPTURE_STAGING',
      'RECOVERY_VERSION',
      'INTERNAL_GENERATED',
    ] as const) {
      const result = authorizeNewCapture(
        makeContext({ state: 'LIVE' }),
        makeCapability(),
        authorizeRequest({ sourceClass }),
      );
      expect(result.outcome).toBe('DENIED');
      if (result.outcome === 'DENIED') expect(result.reason).toBe('CAPTURE_LOOP_PROTECTED');
    }
  });

  it('E28: an existing / opened document does not become automatically authorized', () => {
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest({ sourceClass: 'OPENED_DOCUMENT' }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('SOURCE_FIREWALLED');
  });

  it('E29: explicit/manual intake is NOT silently treated as automatic capture', () => {
    // Manual explicit intake never routes through the automatic authorization path.
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest({ sourceClass: 'MANUAL_EXPLICIT' }),
    );
    expect(result.outcome).toBe('DENIED');
    if (result.outcome === 'DENIED') expect(result.reason).toBe('SOURCE_FIREWALLED');
  });
});

describe('AUTO-010 Work Session separation', () => {
  it('G30: a valid ToolContext authorizes without any active Work Session', () => {
    // The automatic-authorization decision has NO Work Session dependency: no
    // work-session state is read or required. A LIVE managed context with an
    // exact capability authorizes regardless of any WorkSession.
    const result = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      makeCapability(),
      authorizeRequest(),
    );
    expect(result.outcome).toBe('AUTHORIZED');
  });
});

describe('AUTO-010 Rebind identity preservation', () => {
  it('H31: an explicit rebind preserves toolContextId', () => {
    const rebound = transitionToolContext(makeContext({ state: 'EXPIRED' }), 'REBOUND', AT);
    expect(rebound.toolContextId).toBe(UUID_A);
    expect(rebound.state).toBe('REBOUND');
  });

  it('H32: rebind preserves project identity', () => {
    const rebound = transitionToolContext(
      makeContext({ state: 'EXPIRED', projectId: UUID_B }),
      'REBOUND',
      AT,
    );
    expect(rebound.projectId).toBe(UUID_B);
    expect(rebound.tool).toBe('AutoCAD');
    expect(rebound.expectedArtifactType).toBe('LightingLayout');
  });

  it('H33: a CLOSED context cannot rebind', () => {
    expect(canTransitionToolContext('CLOSED', 'REBOUND')).toBe(false);
    expect(() => transitionToolContext(makeContext({ state: 'CLOSED' }), 'REBOUND', AT)).toThrow(
      DomainError,
    );
  });
});

describe('AUTO-010 Capture capability registry', () => {
  it('I34: production default is fail-closed (no runtime capability registered)', () => {
    const registry = new CaptureCapabilityRegistry();
    expect(registry.findExact('AutoCAD', 'LightingLayout', 'Working', 'autocad-session-1')).toBe(
      undefined,
    );
    const decision = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      registry.findExact('AutoCAD', 'LightingLayout', 'Working', 'autocad-session-1'),
      authorizeRequest(),
    );
    expect(decision.outcome).toBe('DENIED');
    if (decision.outcome === 'DENIED') expect(decision.reason).toBe('CAPABILITY_NOT_ALLOWLISTED');
  });

  it('I35: registering an exact capability enables it', () => {
    const registry = new CaptureCapabilityRegistry();
    registry.register(makeCapability());
    const capability = registry.findExact(
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-session-1',
    );
    expect(capability).toBeDefined();
    const decision = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      capability,
      authorizeRequest(),
    );
    expect(decision.outcome).toBe('AUTHORIZED');
  });

  it('I36: first exact capability registration succeeds; duplicate exact tuple rejects', () => {
    const registry = new CaptureCapabilityRegistry();
    const first = makeCapability();
    registry.register(first);
    expect(() => registry.register(makeCapability())).toThrow(DomainError);
    expect(() => registry.register(makeCapability())).toThrow(/already registered/i);
  });

  it('I37: original capability remains unchanged after a duplicate rejection', () => {
    const registry = new CaptureCapabilityRegistry();
    const first = makeCapability({ automaticCaptureAllowed: true, operational: true });
    registry.register(first);
    expect(() => registry.register(makeCapability())).toThrow(DomainError);
    const retained = registry.findExact(
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-session-1',
    );
    expect(retained).toBe(first);
    expect(retained?.operational).toBe(true);
  });

  it('I38: a duplicate with operational=false cannot downgrade the original true capability', () => {
    const registry = new CaptureCapabilityRegistry();
    const first = makeCapability({ automaticCaptureAllowed: true, operational: true });
    registry.register(first);
    expect(() => registry.register(makeCapability({ operational: false }))).toThrow(DomainError);
    const retained = registry.findExact(
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-session-1',
    );
    expect(retained?.operational).toBe(true);
    const decision = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      retained,
      authorizeRequest(),
    );
    expect(decision.outcome).toBe('AUTHORIZED');
  });

  it('I39: a duplicate with operational=true cannot upgrade the original operational=false capability', () => {
    const registry = new CaptureCapabilityRegistry();
    const first = makeCapability({ automaticCaptureAllowed: true, operational: false });
    registry.register(first);
    expect(() => registry.register(makeCapability({ operational: true }))).toThrow(DomainError);
    const retained = registry.findExact(
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-session-1',
    );
    expect(retained?.operational).toBe(false);
    const decision = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      retained,
      authorizeRequest(),
    );
    expect(decision.outcome).toBe('DENIED');
    if (decision.outcome === 'DENIED') expect(decision.reason).toBe('CAPABILITY_NOT_READY');
  });

  it('I40: same tool with a DIFFERENT artifactType is a separate valid capability', () => {
    const registry = new CaptureCapabilityRegistry();
    registry.register(makeCapability({ artifactType: 'LightingLayout' }));
    registry.register(makeCapability({ artifactType: 'BOQ' }));
    expect(
      registry.findExact('AutoCAD', 'LightingLayout', 'Working', 'autocad-session-1'),
    ).toBeDefined();
    expect(registry.findExact('AutoCAD', 'BOQ', 'Working', 'autocad-session-1')).toBeDefined();
    // Same tool + a differing artifactType is a distinct capability tuple:
    // registering a THIRD distinct artifactType does not collide with the first two.
    const pdf = makeCapability({ artifactType: 'PDFExport' });
    registry.register(pdf); // must not throw (distinct tuple)
    expect(registry.findExact('AutoCAD', 'PDFExport', 'Working', 'autocad-session-1')).toBe(pdf);
  });
});

describe('AUTO-010 Firewall dominance over an operational capability', () => {
  it('N2a: an exact operational capability cannot override PACKAGE_OUTPUT loop protection', () => {
    const registry = new CaptureCapabilityRegistry();
    registry.register(makeCapability());
    const capability = registry.findExact(
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-session-1',
    )!;
    // Same tuple capability that would authorize an AUTOMATIC_CAPTURE source, but
    // the source is loop-protected: denial happens BEFORE capability readiness.
    const decision = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      capability,
      authorizeRequest({ sourceClass: 'PACKAGE_OUTPUT' }),
    );
    expect(decision.outcome).toBe('DENIED');
    if (decision.outcome === 'DENIED') expect(decision.reason).toBe('CAPTURE_LOOP_PROTECTED');
  });

  it('N2b: an exact operational capability cannot override CLIENT_RECEIVED firewall', () => {
    const registry = new CaptureCapabilityRegistry();
    registry.register(makeCapability());
    const capability = registry.findExact(
      'AutoCAD',
      'LightingLayout',
      'Working',
      'autocad-session-1',
    )!;
    const decision = authorizeNewCapture(
      makeContext({ state: 'LIVE' }),
      capability,
      authorizeRequest({ sourceClass: 'CLIENT_RECEIVED' }),
    );
    expect(decision.outcome).toBe('DENIED');
    if (decision.outcome === 'DENIED') expect(decision.reason).toBe('SOURCE_FIREWALLED');
  });
});

/** Domain eligibility mirror of `toolContextCanAuthorizeNewCapture` (guard rail). */
function toolContextCanAuthorize(state: ToolContextState): boolean {
  return state === 'LIVE' || state === 'REBOUND';
}
