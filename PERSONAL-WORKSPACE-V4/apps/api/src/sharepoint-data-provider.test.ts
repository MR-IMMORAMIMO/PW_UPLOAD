import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '@scli/config';
import { SharePointDataProvider } from './sharepoint-data-provider';

const config = loadConfig({
  APP_MODE: 'm365',
  NODE_ENV: 'test',
  SHAREPOINT_SITE_ID: 'site-id',
  SP_LIST_APP_USERS_ID: 'users',
  SP_LIST_PROJECTS_ID: 'projects',
  SP_LIST_ACTIVITIES_ID: 'activities',
  SP_LIST_COMMENTS_ID: 'comments',
  SP_LIST_NOTIFICATIONS_ID: 'notifications',
  SP_LIST_SEQUENCE_ID: 'sequence',
  SP_LIST_PROJECT_TYPES_ID: 'types',
  SP_LIST_SETTINGS_ID: 'settings',
  SP_SEQUENCE_ITEM_ID: 'sequence-item',
});

afterEach(() => vi.unstubAllGlobals());

describe('SharePoint sequence allocation', () => {
  it('re-reads and retries after an ETag conflict', async () => {
    const responses = [
      new Response(
        JSON.stringify({ id: 'sequence-item', eTag: '"1"', fields: { LastNumber: 41 } }),
        { status: 200 },
      ),
      new Response('conflict', { status: 412 }),
      new Response(
        JSON.stringify({ id: 'sequence-item', eTag: '"2"', fields: { LastNumber: 42 } }),
        { status: 200 },
      ),
      new Response(null, { status: 204 }),
    ];
    const fetchMock = vi.fn(async (...request: Parameters<typeof fetch>) => {
      void request;
      return responses.shift() ?? new Response(null, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const provider = new SharePointDataProvider(config, {
      getToken: async () => ({ token: 'test-token', expiresOnTimestamp: Date.now() + 60_000 }),
    });

    await expect(provider.allocateProjectNumber()).resolves.toBe(43);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({ 'if-match': '"1"' });
    expect(fetchMock.mock.calls[3]?.[1]?.headers).toMatchObject({ 'if-match': '"2"' });
  });
});
