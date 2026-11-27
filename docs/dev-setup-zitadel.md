# Local sign-in setup with ZITADEL Cloud

This guide connects your local Loadlane (web on port 3000, API on port 4000) to a ZITADEL Cloud instance. Do it once per developer. The steps and setting names come from ZITADEL's official documentation as read on 2026-11-27; ZITADEL may rename things, so if a label differs, follow the current ZITADEL quickstart: https://zitadel.com/docs/guides/start/quickstart

Never paste passwords or secrets into chat, issues or commits. The setup below needs no client secret at all.

## 1. Create an instance

1. Sign up at https://zitadel.com and open the Customer Portal.
2. Create an instance. **Choose the US region** (the region cannot be changed later) and create the first admin user.
3. The free plan is enough for development. Whether it asks for payment details was not stated in the docs. If it does, decide yourself whether to continue.

## 2. Create a project and an application

1. In the ZITADEL Console open Projects and create a project, for example `Loadlane (dev)`.
2. In that project add an application of type **Web**. The type cannot be changed afterwards.
3. Authentication method: **PKCE**. Do not pick a method with a client secret.
4. Enable **Development mode** on the application. It is required to use `http://localhost` redirect addresses.
5. Redirect URIs: `http://localhost:3000/auth/callback`
6. Post-logout redirect URIs: `http://localhost:3000/`
7. Token settings: set the token type to **JWT** (the default is an opaque bearer token, which our API cannot verify locally).
8. After creating the application, copy the **Client ID** shown by ZITADEL. It is not a secret.

## 3. Collect the values

| Value                                                | Where                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| Issuer, like `https://<your-instance>.zitadel.cloud` | Console, URLs in the left sidebar. No trailing slash.         |
| Client ID                                            | Shown after creating the application, also in its details.    |
| Project ID                                           | Console, the project's page. Used as the audience of the API. |

By default the access token's `aud` claim contains the client IDs and the project ID of the application, so the API accepts the project ID as audience.

## 4. Create a test user

1. In the Console open Users and create a user with **New**.
2. Tick the option that marks the e-mail address as verified. Without it ZITADEL sends an initialization mail and the user has to verify first. Loadlane refuses users whose e-mail is not verified.

## 5. Configure Loadlane

Copy `.env.example` to `.env` if you have not done so, then set:

```
OIDC_ISSUER=https://<your-instance>.zitadel.cloud
OIDC_CLIENT_ID=<client id from step 2>
OIDC_AUDIENCE=<project id from step 3>
```

Start the stack, then the API and the web app (each in its own terminal):

```powershell
pnpm infra:up
pnpm db:migrate
```

```powershell
pnpm api:start
```

```powershell
pnpm web:dev
```

Open http://localhost:3000 (not 127.0.0.1: the redirect URI registered in ZITADEL must match exactly) and sign in with the test user. A new user has no organization yet, so the page shows an empty state. Creating organizations arrives with backlog item P1-09.

Next.js sends anonymous usage data unless you opt out. To disable it on your machine run `pnpm --filter @loadlane/web exec next telemetry disable` once.

## What was tested

The unit and integration tests use a local stand-in for the provider and prove Loadlane's own checks (token verification, registration, tenant isolation, session handling). They do not prove that ZITADEL behaves the same way. That is checked by signing in once against your instance; ADR 0003 is updated when this has been done.

## Logout

`/logout` ends the Loadlane session and then calls ZITADEL's end-session endpoint, which needs the post-logout redirect URI from step 2 to match exactly.
