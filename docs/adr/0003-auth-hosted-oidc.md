# ADR 0003: Auth hosted oidc

Status: Proposed

Use a hosted OIDC provider with organization and SSO support, behind our own interface so it can be swapped. Auth.js is not chosen because the API is a separate NestJS service. Candidates to compare in a spike (task P1-06): WorkOS, Clerk, Zitadel. Criteria: organizations, SAML/SSO for enterprise buyers, MFA, US region, pricing, exit path.
