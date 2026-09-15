declare global {
  interface Window {
    scliDesktop?: {
      selectFolder: () => Promise<string | null>;
      selectFile: (
        filters?: Array<{ name: string; extensions: string[] }>,
      ) => Promise<string | null>;
      openPath: (target: string) => Promise<string>;
      openExternal: (target: string) => Promise<boolean>;
      openContactLink?: (input: { kind: 'email' | 'phone'; value: string }) => Promise<boolean>;
      exportPdf: (input: {
        html: string;
        suggestedName: string;
        defaultDirectory?: string;
      }) => Promise<string | null>;
      restart: () => Promise<boolean>;
      integrationStatus: () => Promise<
        Array<{
          application: 'AUTOCAD' | 'DIALUX';
          available: boolean;
          executablePath: string | null;
          source: 'CONFIGURED' | 'DISCOVERED' | 'NOT_FOUND';
        }>
      >;
      configureIntegration: (application: 'AUTOCAD' | 'DIALUX') => Promise<unknown>;
      prepareAutomationInbox: (toolContextId: string) => Promise<string>;
      launchIntegratedApplication: (input: {
        application: 'AUTOCAD' | 'DIALUX';
        toolContextId: string;
        projectId: string;
        authorizedProjectRoot: string;
        sourcePath?: string | null;
      }) => Promise<{ application: 'AUTOCAD' | 'DIALUX'; launched: true; inboxPath: string }>;
      isDesktop: boolean;
    };
  }
}

export const desktop = {
  available: () => Boolean(window.scliDesktop?.isDesktop),
  selectFolder: () => window.scliDesktop?.selectFolder() ?? Promise.resolve(null),
  selectFile: (filters?: Array<{ name: string; extensions: string[] }>) =>
    window.scliDesktop?.selectFile(filters) ?? Promise.resolve(null),
  openPath: (target: string) =>
    window.scliDesktop?.openPath(target) ?? Promise.resolve('Desktop app required.'),
  openExternal: (target: string) => {
    if (window.scliDesktop) return window.scliDesktop.openExternal(target);
    window.open(target, '_blank', 'noopener,noreferrer');
    return Promise.resolve(true);
  },
  exportPdf: (input: { html: string; suggestedName: string; defaultDirectory?: string }) =>
    window.scliDesktop?.exportPdf(input) ?? Promise.resolve(null),
  restart: () => window.scliDesktop?.restart() ?? Promise.resolve(false),
};

export {};
