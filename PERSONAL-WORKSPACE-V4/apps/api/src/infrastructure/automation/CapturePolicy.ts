import { CaptureCapabilityRegistry, type CaptureCapability } from '@scli/domain';

export const p4bArtifactTypes = ['DIALUX_REPORT', 'CAD_LAYOUT_PDF', 'CAD_WORKING_DRAWING'] as const;
export type P4bArtifactType = (typeof p4bArtifactTypes)[number];
export type P4bCaptureLevel = 'PROJECT' | 'REVISION';

export interface P4bCapturePolicy {
  application: 'AUTOCAD' | 'DIALUX';
  artifactType: P4bArtifactType;
  extensions: readonly string[];
  level: P4bCaptureLevel;
  outputTypeId: 'dialuxReport' | 'cadLayoutPdf' | 'cadWorkingDrawing';
  documentCategory: 'LuxReport' | 'Drawing';
  documentStatus: 'InternalReview' | 'Working';
  createRevisionSnapshot: boolean;
  namingToken: 'DIALUX_REPORT' | 'LIGHTING_LAYOUT' | 'CAD_WORKING';
}

export const P4B_CAPTURE_MODE = 'EXTERNAL_OUTPUT_SESSION' as const;
export const P4B_CAPTURE_CHANNEL = 'DEDICATED_SESSION_INBOX' as const;

export const P4B_CAPTURE_POLICIES: readonly P4bCapturePolicy[] = Object.freeze([
  {
    application: 'DIALUX',
    artifactType: 'DIALUX_REPORT',
    extensions: ['.pdf'],
    level: 'REVISION',
    outputTypeId: 'dialuxReport',
    documentCategory: 'LuxReport',
    documentStatus: 'InternalReview',
    createRevisionSnapshot: true,
    namingToken: 'DIALUX_REPORT',
  },
  {
    application: 'AUTOCAD',
    artifactType: 'CAD_LAYOUT_PDF',
    extensions: ['.pdf'],
    level: 'REVISION',
    outputTypeId: 'cadLayoutPdf',
    documentCategory: 'Drawing',
    documentStatus: 'InternalReview',
    createRevisionSnapshot: true,
    namingToken: 'LIGHTING_LAYOUT',
  },
  {
    application: 'AUTOCAD',
    artifactType: 'CAD_WORKING_DRAWING',
    extensions: ['.dwg', '.dxf'],
    level: 'PROJECT',
    outputTypeId: 'cadWorkingDrawing',
    documentCategory: 'Drawing',
    documentStatus: 'Working',
    createRevisionSnapshot: false,
    namingToken: 'CAD_WORKING',
  },
]);

export function findP4bCapturePolicy(
  application: string,
  artifactType: string,
): P4bCapturePolicy | null {
  return (
    P4B_CAPTURE_POLICIES.find(
      (policy) => policy.application === application && policy.artifactType === artifactType,
    ) ?? null
  );
}

export function createP4bCapabilityRegistry(): CaptureCapabilityRegistry {
  const registry = new CaptureCapabilityRegistry();
  for (const policy of P4B_CAPTURE_POLICIES) {
    const capability: CaptureCapability = {
      tool: policy.application,
      artifactType: policy.artifactType,
      mode: P4B_CAPTURE_MODE,
      channel: P4B_CAPTURE_CHANNEL,
      sourceClass: 'AUTOMATIC_CAPTURE',
      automaticCaptureAllowed: true,
      operational: true,
    };
    registry.register(capability);
  }
  return registry;
}

export function policyAcceptsFile(policy: P4bCapturePolicy, fileName: string): boolean {
  const normalized = fileName.normalize('NFC').toLowerCase();
  return policy.extensions.some((extension) => normalized.endsWith(extension));
}
