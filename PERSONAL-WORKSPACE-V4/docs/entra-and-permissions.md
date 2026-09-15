# Microsoft Entra and permissions

## Registration model

The app is single-tenant (`AzureADMyOrg`). `appPackage/aad.manifest.json` defines the `access_as_user` API scope, Teams desktop/web client preauthorization, the identifier URI, and Graph application permission metadata. The Teams manifest links the same client ID through `webApplicationInfo`.

The browser requests only the Teams SSO token. It does not receive a Graph application token or storage credential. The API verifies the token against the tenant's v2 issuer and signing keys, then maps the `oid` claim to an active `SCLI_AppUsers` record.

## Permission inventory

| Permission                           | Type                          | Required                | Purpose                                                                                |
| ------------------------------------ | ----------------------------- | ----------------------- | -------------------------------------------------------------------------------------- |
| `access_as_user`                     | Application's delegated scope | Yes                     | Allows Teams to obtain a token for the SCLI API on behalf of the signed-in user.       |
| `Sites.Selected`                     | Microsoft Graph application   | Yes for SharePoint mode | Lets the API access only SharePoint sites explicitly granted to its service principal. |
| Teams `identity` manifest permission | Teams app capability          | Yes                     | Enables the tab SSO identity flow.                                                     |
| Bot personal scope                   | Teams app capability          | Optional                | Enables proactive personal notifications after installation and conversation capture.  |

No directory-wide delegated search permission is required. The Sales people picker reads active configured AppUsers. Profile photos are optional and currently fall back to initials; do not add `User.Read.All` merely for avatars without a separate privacy/least-privilege review.

## Site grant

`Sites.Selected` grants no site access by itself. A SharePoint/Graph administrator must create a site permission for the application's service principal on the dedicated site, normally with `write`. Record the site ID, grant evidence, approver, and review date. Do not grant tenant-wide `Sites.ReadWrite.All` as a shortcut.

## Credentials

Preferred order:

1. Managed identity on supported Azure hosting.
2. Certificate credential with the private key in an approved secret manager.
3. Client secret in an approved secret manager only when the first two are unavailable.

The current provider accepts certificate path/password, client secret, or `DefaultAzureCredential`. Rotate credentials according to company policy and restart instances safely. Never set secrets in the Teams app package or browser variables.

## Token validation checklist

- HTTPS only.
- Validate signature through tenant JWKS.
- Exact v2 issuer for the configured tenant.
- API client ID audience.
- Expiration/not-before enforced by the JWT library.
- Require `oid` and map it server-side.
- Reject missing, inactive, or unconfigured AppUsers.
- Ignore Teams context and any client-supplied role.

## Consent and ownership

IT must identify an app owner, security owner and operational owner. Admin consent and the site-specific write grant must be approved separately. Review the app registration, credentials, site grant, active AppUsers and bot installation at the organization's normal access-review interval.
