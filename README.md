# Estimation Poker

Estimation Poker is a small internal web app that helps teams estimate tickets independently in hours. A facilitator selects the active ticket, sees who has voted, reveals all votes at the same time, and records a final estimate after the team discussion.

The first version supports teams, sessions, manually entered Jira tickets, blind voting rounds, basic statistics, multiple rounds, and session completion. It requires no build step or frontend framework.

## Architecture

```text
GitHub Pages static frontend
        ↓ Google OAuth authorization code
Google Apps Script Web App (authentication + authorization)
        ↓
Google Sheet
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
│       ├── auth.js               # Google OAuth code flow and sign-in UI
│       ├── authSession.js        # tab-scoped signed application session
│       ├── api.js                # all Fetch API communication
│       ├── config.js             # Apps Script URL and timeouts
│       ├── router.js             # hash routing
│       ├── state.js              # small central state
│       ├── storage.js            # safe browser storage
│       ├── polling.js            # adaptive, non-overlapping polling
│       ├── notifications.js      # accessible notifications
│       ├── utils.js              # DOM, status, and statistics helpers
│       └── views/                # route views
├── AGENTS.md
├── LICENSE
├── resources/Code.gs            # Google Apps Script backend
├── tests/smoke.mjs              # framework-free router and statistics tests
└── README.md
```

## Configuration

Open [`site/js/config.js`](site/js/config.js) and configure both public values:

```javascript
apiUrl: "PASTE_HERE_THE_GOOGLE_APPS_SCRIPT_EXEC_URL",
googleClientId: "PASTE_HERE_THE_GOOGLE_OAUTH_CLIENT_ID"
```

The Apps Script URL must end in `/exec`. The Google OAuth client ID is public and ends in `.apps.googleusercontent.com`. Never put the OAuth client secret in this file.

## Configure Google authentication

1. Create a **Web application** OAuth client in the Google Cloud project used for this application.
2. Add the production site origin under **Authorized JavaScript origins**: `https://estimation-poker.markvermeltfoort.nl`. If the custom domain is removed later, use the GitHub Pages origin instead; a project path such as `/estimation-poker` is never part of the origin.
3. Add `http://localhost:8080` as an authorized JavaScript origin for local testing.
4. Configure the OAuth consent screen. Only the `openid`, `email`, and `profile` scopes are requested.
5. Copy the client ID to `googleClientId` in `site/js/config.js`.
6. In Apps Script, open **Project Settings → Script properties** and add:

   | Property | Value |
   | --- | --- |
   | `GOOGLE_CLIENT_ID` | The same web client ID used by the frontend |
   | `GOOGLE_CLIENT_SECRET` | The web client secret; keep this server-side |
   | `GOOGLE_ALLOWED_ORIGINS` | `https://estimation-poker.markvermeltfoort.nl,http://localhost:8080` |
   | `GOOGLE_ALLOWED_DOMAIN` | Optional but recommended Workspace domain, such as `example.com` |

Apps Script creates `ESTIMATION_POKER_SESSION_SECRET` automatically on the first successful sign-in. Treat it as a secret and do not copy it to the frontend.

Authentication is invite-only. Before someone can sign in, create an active row in `TeamMembers` with their exact Google email address, team, display name, and role. On first sign-in the server permanently binds that team-member ID to the stable Google account subject in Script Properties. An email can be present in multiple teams for the same person.

If an invitation was linked to the wrong Google account, run `resetGoogleBindingForMember(memberId)` from an administrator-only Apps Script wrapper, then let the intended user sign in again.

## Run locally

Run this command from the repository root:

```bash
python3 -m http.server 8080 --directory site
```

Then open [http://localhost:8080](http://localhost:8080). Do not use `file://` directly: ES modules and browser security make that unreliable.

## Publish the Apps Script

1. Open the Google Sheet.
2. Select `Extensions → Apps Script`.
3. Copy the contents of [`resources/Code.gs`](resources/Code.gs) into the Apps Script project.
4. Select `Deploy → New deployment`.
5. Select `Web app`.
6. Run the app as the owner.
7. Set access to **Anyone** so the cross-origin frontend can reach the endpoint. The application performs its own signed-session validation before every protected action.
8. Copy the deployment URL ending in `/exec`.
9. Add that URL to `site/js/config.js`.

A `/dev` URL is only for testing by authorized script editors and is not suitable for the published frontend.

## Routes

| Hash route | Purpose |
| --- | --- |
| `#/` | View teams and sessions |
| `#/sessions/new` | Create a new draft session |
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

- Google performs user authentication through the OAuth authorization-code flow.
- Apps Script exchanges the one-time code directly with Google; the OAuth client secret remains in Script Properties.
- The application session is short-lived, HMAC-signed, and stored only in the browser tab's `sessionStorage`.
- Every protected API operation requires a valid session and an active team membership.
- Participant identity is derived server-side. Member IDs in URLs or request bodies cannot change who casts a vote.
- Facilitator permissions are enforced server-side for session changes, ticket changes, reveal, and finalization.
- A facilitator remains a normal team participant: the same Google account can use **Join** to vote and **Facilitate** to manage the session.
- Team-member email addresses and Google account identifiers are not returned by team/session APIs.
- Hidden vote values are redacted by Apps Script until the facilitator reveals the round.
- All protected requests use `POST` with `text/plain;charset=utf-8`; bearer credentials are never placed in URLs.
- A restrictive Content Security Policy limits the frontend to its own assets, Google Identity Services, and the configured Apps Script hosts.

The Apps Script `/exec` endpoint remains publicly reachable and is still subject to Apps Script quotas and denial-of-service limits. Do not store Jira tokens or other secrets in the frontend, and restrict edit access to the Apps Script project and backing Sheet.

## Known limitations

- The app uses polling instead of real-time WebSockets.
- Jira tickets are entered manually; there is no Jira integration.
- Signing out removes the browser session, but an already copied token remains valid until its two-hour expiry or until all linked team memberships are deactivated.
- There is no offline support or service worker.
- There is no automatic statistics dashboard or historical reporting.
- Apps Script and Google Sheets are not designed for large numbers of concurrent users.

## Troubleshooting deployments

- **Workflow fails:** check the failed validation or Pages step in Actions, and confirm that `site/index.html`, `site/css/styles.css`, `site/js/app.js`, and `site/.nojekyll` exist.
- **No Pages URL:** under `Settings → Pages`, set the source to `GitHub Actions`.
- **Configuration notice remains visible:** replace the placeholder in `site/js/config.js` and push again.
- **CORS or redirect error:** confirm that Apps Script is published as a Web App, has the correct access level, and uses `text/plain;charset=utf-8` for POST requests.
- **Wrong URL:** use the `/exec` URL, not `/dev` or the editor URL.
- **CSS or modules do not load:** confirm that asset paths are relative and do not begin with `/`.
- **Old version remains visible:** perform a hard refresh or clear the browser cache after the Pages deployment completes.

## Manual acceptance tests

The unconfigured scenario can always be tested without a real Apps Script backend:

1. Start the app with the placeholder URL.
2. Confirm that the warning is visible.
3. Confirm that the app remains functional and makes no API requests.

With configured Google OAuth credentials and invited team-member emails, test the complete flow: sign in, vote as a participant, confirm that the DOM contains only “Voted” before reveal, reveal as a facilitator, save the final estimate, and start a new round. Also verify that a regular member receives `403` responses for facilitator actions and that changing request member IDs never changes the voting identity.

When GJS is available, run the framework-free smoke tests with:

```bash
gjs -m tests/smoke.mjs
gjs -m tests/auth-smoke.mjs
gjs -m tests/codegs-smoke.mjs
```

## License

This project is available under the [MIT License](LICENSE).
