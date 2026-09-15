import { createRemoteJWKSet, jwtVerify, SignJWT } from 'jose';
import type { FastifyRequest } from 'fastify';
import type { AppConfig } from '@scli/config';
import { DomainError, type AppUser, type DataProvider } from '@scli/domain';
import { seedUserIds } from '@scli/test-data';

export type ActorResolver = (request: FastifyRequest) => Promise<AppUser>;

const standaloneIssuer = 'scli-standalone';
const standaloneAudience = 'scli-web';

function bearerToken(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) {
    throw new DomainError('AUTHENTICATION_REQUIRED', 'Sign in is required.', 401);
  }
  return authorization.slice('Bearer '.length).trim();
}

export function createActorResolver(config: AppConfig, provider: DataProvider): ActorResolver {
  if (config.APP_MODE === 'mock') {
    return async (request) => {
      const requestedId = request.headers['x-mock-user-id'];
      if (
        config.WORKSPACE_VARIANT === 'personal' &&
        config.PERSONAL_AUTO_LOGIN &&
        typeof requestedId !== 'string'
      ) {
        const users = await provider.listUsers();
        const owner = users.find((candidate) => candidate.isActive && candidate.role === 'Admin');
        if (!owner) {
          throw new DomainError(
            'AUTHENTICATION_REQUIRED',
            'No active disposable Personal workspace owner is available.',
            401,
          );
        }
        return owner;
      }
      const userId = typeof requestedId === 'string' ? requestedId : seedUserIds.manager;
      const user = await provider.getUser(userId);
      if (!user?.isActive) {
        throw new DomainError('AUTHENTICATION_REQUIRED', 'Mock user is not active.', 401);
      }
      return user;
    };
  }

  if (config.APP_MODE === 'standalone') {
    if (config.WORKSPACE_VARIANT === 'personal' && config.PERSONAL_AUTO_LOGIN) {
      return async () => {
        const users = await provider.listUsers();
        const user =
          users.find((candidate) => candidate.isActive && candidate.role === 'Admin') ??
          users.find((candidate) => candidate.isActive);
        if (!user) {
          throw new DomainError(
            'AUTHENTICATION_REQUIRED',
            'No active local workspace owner is available.',
            401,
          );
        }
        return user;
      };
    }
    const secret = new TextEncoder().encode(config.STANDALONE_SESSION_SECRET);
    return async (request) => {
      const token = bearerToken(request);
      let subject: string | undefined;
      let roleVersion: string | undefined;
      try {
        const { payload } = await jwtVerify(token, secret, {
          issuer: standaloneIssuer,
          audience: standaloneAudience,
          algorithms: ['HS256'],
        });
        subject = payload.sub;
        roleVersion = typeof payload.roleVersion === 'string' ? payload.roleVersion : undefined;
      } catch {
        throw new DomainError(
          'AUTHENTICATION_REQUIRED',
          'Your session is invalid or has expired. Sign in again.',
          401,
        );
      }
      const user = subject ? await provider.getUser(subject) : null;
      if (!user?.isActive) {
        throw new DomainError('AUTHENTICATION_REQUIRED', 'This account is not active.', 401);
      }
      if (!roleVersion || user.updatedAt !== roleVersion) {
        throw new DomainError(
          'AUTHENTICATION_REQUIRED',
          'Your account changed. Sign in again to continue.',
          401,
        );
      }
      return user;
    };
  }

  const tenantId = config.ENTRA_TENANT_ID;
  const clientId = config.ENTRA_CLIENT_ID;
  if (!tenantId || !clientId) {
    return async () => {
      throw new DomainError(
        'CONFIGURATION_REQUIRED',
        'Microsoft 365 sign-in is not configured. Contact the application administrator.',
        503,
      );
    };
  }

  const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  const jwks = createRemoteJWKSet(
    new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`),
  );
  return async (request) => {
    const token = bearerToken(request);
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: clientId,
    });
    const entraObjectId = typeof payload.oid === 'string' ? payload.oid : undefined;
    if (!entraObjectId) {
      throw new DomainError(
        'AUTHENTICATION_REQUIRED',
        'The sign-in token has no user identity.',
        401,
      );
    }
    const user = await provider.getUserByEntraObjectId(entraObjectId);
    if (!user?.isActive) {
      throw new DomainError(
        'PERMISSION_DENIED',
        'Your account is not active in SCT Workspace.',
        403,
      );
    }
    return user;
  };
}

export async function createStandaloneSession(config: AppConfig, user: AppUser): Promise<string> {
  if (config.APP_MODE !== 'standalone') {
    throw new DomainError('NOT_FOUND', 'Standalone sign-in is not available.', 404);
  }
  const secret = new TextEncoder().encode(config.STANDALONE_SESSION_SECRET);
  return new SignJWT({ roleVersion: user.updatedAt })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(standaloneIssuer)
    .setAudience(standaloneAudience)
    .setIssuedAt()
    .setExpirationTime(`${config.STANDALONE_SESSION_HOURS}h`)
    .sign(secret);
}
