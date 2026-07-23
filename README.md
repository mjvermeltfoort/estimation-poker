# Estimation Poker

Estimation Poker is a small internal web app that helps teams estimate tickets independently in hours. A facilitator selects the active ticket, sees who has voted, reveals all votes at the same time, and records a final estimate after the team discussion.

The first version supports teams, sessions, manually entered Jira tickets, blind voting rounds, basic statistics, multiple rounds, and session completion. It requires no build step or frontend framework.

The frontend targets Supabase Auth + PostgREST/RPC.

## Architecture

```text
GitHub Pages static frontend
        ↓ Google OAuth (via Supabase Auth)
Supabase (Postgres + RLS + RPC)
        ↓
PostgreSQL tables
```

The frontend uses HTML5, modern CSS, and vanilla JavaScript ES modules. All browser requests go through the central API client. Hash routing makes the app suitable for a GitHub Pages project site without a server-side route fallback.

## Project structure

```text
.
├── .github/workflows/pages.yml   # GitHub Pages deployment
├── site/
│   ├── index.html                # app shell
│   ├── 404.html                  # static error page
│   ├── .nojekyll
│   ├── favicon.svg
│   ├── css/styles.css
│   └── js/
│       ├── app.js                # startup, routes, and polling
│       ├── auth.js               # Supabase Google sign-in flow and sign-in UI
│       ├── authSession.js        # tab-scoped auth session
│       ├── api.js                # Supabase REST/RPC communication
│       ├── config.js             # Supabase URL, anon key, and timeouts
│       ├── router.js             # hash routing
│       ├── state.js              # small central state
│       ├── storage.js            # safe browser storage
│       ├── polling.js            # adaptive, non-overlapping polling
│       ├── notifications.js      # accessible notifications
│       ├── utils.js              # DOM, status, and statistics helpers
│       └── views/                # route views
├── AGENTS.md
├── LICENSE
├── supabase/migrations/         # Supabase SQL migrations
├── tests/smoke.mjs              # framework-free router and statistics tests
└── README.md
```

## Configuration

Open [`site/js/config.js`](site/js/config.js) and configure both public values:

```javascript
supabaseUrl: "PASTE_HERE_THE_SUPABASE_URL",
supabaseAnonKey: "PASTE_HERE_THE_SUPABASE_ANON_KEY"
```

The Supabase URL and anon key are public frontend values. Never commit a service-role key or any private secret to this repository.

## Configure Supabase authentication

1. In Supabase, enable the Google provider under `Authentication -> Providers`.
2. Add redirect URLs for production and local development (for example `https://estimation-poker.markvermeltfoort.nl` and `http://localhost:8080`).
3. Apply migrations from [supabase/migrations](supabase/migrations) (for example [supabase/migrations/001_initial_schema.sql](supabase/migrations/001_initial_schema.sql)).
4. Populate `teams` and `team_members` with active records. Use the invited Google email addresses in `team_members.email`.
5. Set `supabaseUrl` and `supabaseAnonKey` in [site/js/config.js](site/js/config.js).

Authentication remains invite-only via `team_members`: users must have active membership rows to access team data.

## Run locally

Run this command from the repository root:

```bash
python3 -m http.server 8080 --directory site
```

Then open [http://localhost:8080](http://localhost:8080). Do not use `file://` directly: ES modules and browser security make that unreliable.

## Database bootstrap

Apply the SQL files in [supabase/migrations](supabase/migrations) to create tables, constraints, row-level security, and RPC functions used by the frontend.

If migrations are not detected, verify both [supabase/config.toml](supabase/config.toml) and [supabase/migrations](supabase/migrations) exist. Supabase CLI picks up files matching `YYYYMMDDHHMMSS_name.sql`.

## Routes

| Hash route | Purpose |
| --- | --- |
| `#/` | View teams and sessions |
| `#/sessions/new` | Create a new draft session |
| `#/admin` | Manage team users and roles (admin only) |
| `#/session/{sessionId}` | Join and vote |
| `#/facilitate/{sessionId}` | Facilitate a session |

## Enable GitHub Pages

1. Open the repository on GitHub.
2. Go to `Settings`.
3. Go to `Pages`.
4. Under `Source`, select `GitHub Actions`.
5. Push to `main` or manually run `Deploy GitHub Pages`.
6. Check the deployment under `Actions`.
7. Open the URL shown for the deployment.

The workflow validates the essential files, uploads only `site/`, and deploys to the `github-pages` environment. All assets use relative paths, so a project site works under `username.github.io/repository-name/`.

## Security model

- Google authentication is handled by Supabase Auth.
- The app stores the access token in browser `sessionStorage` for tab-scoped sessions.
- Row-level security and RPC checks enforce team membership and facilitator-only mutations.
- Hidden vote values remain redacted until reveal in the session state payload.
- Bearer credentials are sent via `Authorization` headers and never via URLs.
- Do not store Jira tokens or any secrets in frontend files.

## Known limitations

- The app uses polling instead of real-time WebSockets.
- Jira tickets are entered manually; there is no Jira integration.
- Signing out removes the browser session, but access-token lifetime still applies until expiry.
- There is no offline support or service worker.
- There is no automatic statistics dashboard or historical reporting.

## Troubleshooting deployments

- **Workflow fails:** check the failed validation or Pages step in Actions, and confirm that `site/index.html`, `site/css/styles.css`, `site/js/app.js`, and `site/.nojekyll` exist.
- **No Pages URL:** under `Settings → Pages`, set the source to `GitHub Actions`.
- **Configuration notice remains visible:** replace the placeholder in `site/js/config.js` and push again.
- **CORS or redirect error:** confirm Supabase Google provider redirect URLs and site origin configuration.
- **Wrong URL:** use the Supabase project URL and anon key from project settings.
- **CSS or modules do not load:** confirm that asset paths are relative and do not begin with `/`.
- **Old version remains visible:** perform a hard refresh or clear the browser cache after the Pages deployment completes.

## Manual acceptance tests

The unconfigured scenario can always be tested without a real backend:

1. Start the app with the placeholder URL.
2. Confirm that the warning is visible.
3. Confirm that the app remains functional and makes no API requests.

With configured Supabase + Google provider and invited team-member emails, test the complete flow: sign in, vote as a participant, confirm that the DOM contains only "Voted" before reveal, reveal as a facilitator, save the final estimate, and start a new round. Also verify that a regular member receives `403`-equivalent responses for facilitator actions and that request tampering does not change voting identity.

When GJS is available, run the framework-free smoke tests with:

```bash
gjs -m tests/smoke.mjs
gjs -m tests/auth-smoke.mjs
```

## License

This project is available under the [MIT License](LICENSE).
