# Project instructions

## Architecture

- This is a static GitHub Pages application.
- Published files live in `site/`.
- Do not introduce npm, Node build tools, or frontend frameworks.
- Use vanilla JavaScript ES modules.
- Use hash routing.
- All asset paths must remain relative for GitHub project pages.
- Supabase is the backend for this project and must be consumed through PostgREST, RPC and Auth APIs.
- Keep responsibilities split across small modules and views.
- Keep the Supabase URL and anon key configured only in `site/js/config.js`.
- Use `site/js/api.js` as the central place for Supabase HTTP calls.
- Keep Supabase request paths relative to the configured project URL, e.g. `/rest/v1/...`, `/rpc/...`, `/auth/v1/...`.
- Use standard JSON requests and responses for Supabase APIs.
- Prefer explicit `select` columns in PostgREST queries; avoid `select=*` in new code unless there is a clear need.
- Keep PostgREST filters explicit and deterministic (`eq`, `neq`, `in`, `order`, `limit`) to avoid ambiguous client behavior.
- Use RPC endpoints for privileged or multi-step server-side logic rather than recreating business rules in the client.
- Any schema or policy change must be made in `supabase/migrations/` with additive migrations; never edit an old migration file in place.

## Security

- Never add secrets or Jira API tokens to the frontend.
- Treat all API data as untrusted.
- Prefer `textContent` over `innerHTML`.
- Do not expose vote values before reveal, including in hidden DOM or data attributes.
- Member and facilitator selection are convenience features, not authentication or authorization.
- Open external links with `rel="noopener noreferrer"`.
- Assume Row Level Security (RLS) is the primary authorization boundary; do not rely on client-side checks for access control.
- Include Supabase auth context (`Authorization: Bearer <access_token>`) for requests that depend on user identity.
- Do not send the Supabase service role key to the browser.
- For PostgREST writes, send only allowed fields; do not forward raw, unvalidated objects from UI state.
- Handle 401/403/404/409 responses explicitly and surface safe user-facing errors.

## User experience

- Keep participant and facilitator flows usable from 360 px through meeting-room screens.
- Preserve keyboard operation, focus visibility, labels, semantic disabled states and live announcements.
- Respect `prefers-reduced-motion`.
- Do not replace useful session content with a full-page loader during polling.
- Stop polling outside session and facilitator routes.

## Validation

Before finishing:

- Check all imports and relative file paths.
- Run `gjs -m tests/smoke.mjs` when GJS is available.
- Run `gjs -m tests/auth-smoke.mjs` when GJS is available.
- Run a local static server.
- Check the browser console for errors where possible.
- Validate `.github/workflows/pages.yml`.
- Confirm `site/index.html`, `.nojekyll`, CSS and app entrypoint exist.
- Confirm no asset URL begins with `/` and no secrets are committed to frontend files.
- Check that hidden votes never render their numeric values before reveal.
- Verify new PostgREST queries include required filters and do not leak admin-only data.
- Verify auth-required routes stop polling and clear session state after sign-out.
- Keep the working tree clean when committing.

## Maintenance

- Keep this file up to date whenever architecture, Supabase integration patterns, security constraints, or validation expectations change.
- Update this file in the same pull request as related code or migration changes.
- When adding new API modules, routes, or Supabase RPC endpoints, add or revise the relevant guidance here.
- When a rule in this file no longer matches the codebase, update the rule promptly instead of leaving stale instructions.
- During reviews, treat stale `AGENTS.md` guidance as a documentation defect that must be fixed before merge.
