# Project instructions

## Architecture

- This is a static GitHub Pages application.
- Published files live in `site/`.
- Do not introduce npm, Node build tools, or frontend frameworks.
- Use vanilla JavaScript ES modules.
- Use hash routing.
- All asset paths must remain relative for GitHub project pages.
- Supabase is the backend (PostgREST/RPC/Auth) for this project.
- Keep responsibilities split across small modules and views.
- Keep the Supabase URL and anon key configured only in `site/js/config.js`.
- Use standard JSON requests for Supabase APIs.

## Security

- Never add secrets or Jira API tokens to the frontend.
- Treat all API data as untrusted.
- Prefer `textContent` over `innerHTML`.
- Do not expose vote values before reveal, including in hidden DOM or data attributes.
- Member and facilitator selection are convenience features, not authentication or authorization.
- Open external links with `rel="noopener noreferrer"`.

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
- Run a local static server.
- Check the browser console for errors where possible.
- Validate `.github/workflows/pages.yml`.
- Confirm `site/index.html`, `.nojekyll`, CSS and app entrypoint exist.
- Confirm no asset URL begins with `/` and no secrets are committed to frontend files.
- Check that hidden votes never render their numeric values before reveal.
- Keep the working tree clean when committing.
