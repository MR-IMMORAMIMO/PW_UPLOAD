import { app, authentication } from '@microsoft/teams-js';

type TeamsContext = Awaited<ReturnType<typeof app.getContext>>;
let context: TeamsContext | null = null;
let initialized = false;

export async function initializeTeamsHost(): Promise<TeamsContext | null> {
  if (initialized) return context;
  initialized = true;
  if (window.self === window.top) return null;
  try {
    await app.initialize();
    context = await app.getContext();
    return context;
  } catch {
    context = null;
    return null;
  }
}

export async function getTeamsSsoToken(): Promise<string> {
  await initializeTeamsHost();
  if (!context) {
    throw new Error('Open this production app inside Microsoft Teams to sign in.');
  }
  return authentication.getAuthToken();
}

export async function getTeamsTheme(): Promise<'light' | 'dark' | null> {
  const teamsContext = await initializeTeamsHost();
  if (!teamsContext) return null;
  return teamsContext.app.theme === 'default' ? 'light' : 'dark';
}

export async function watchTeamsTheme(listener: (theme: 'light' | 'dark') => void): Promise<void> {
  const teamsContext = await initializeTeamsHost();
  if (!teamsContext) return;
  app.registerOnThemeChangeHandler((theme) => listener(theme === 'default' ? 'light' : 'dark'));
}
