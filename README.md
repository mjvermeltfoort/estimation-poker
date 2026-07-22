# Estimation Poker

Estimation Poker is a small internal web app that helps teams estimate tickets independently in hours. A facilitator selects the active ticket, sees who has voted, reveals all votes at the same time, and records a final estimate after the team discussion.

The first version supports teams, sessions, manually entered Jira tickets, blind voting rounds, basic statistics, multiple rounds, and session completion. It requires no build step or frontend framework.

## Architecture

```text
GitHub Pages static frontend
        ↓
Google Apps Script Web App
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

Open [`site/js/config.js`](site/js/config.js) and replace:

```javascript
apiUrl: "PASTE_HERE_THE_GOOGLE_APPS_SCRIPT_EXEC_URL"
```

with the published Google Apps Script URL ending in `/exec`. The URL is not a secret, but it should be configured in one place only. While the placeholder is present, the app displays a configuration notice and intentionally makes no network requests.

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
7. Choose the required access level for the internal MVP.
8. Copy the deployment URL ending in `/exec`.
9. Add that URL to `site/js/config.js`.

A `/dev` URL is only for testing by authorized script editors and is not suitable for the published frontend.

## Routes

| Hash route | Purpose |
| --- | --- |
| `#/` | View teams and sessions |
| `#/sessions/new` | Create a new draft session |
| `#/session/{sessionId}` | Join and vote |
| `#/session/{sessionId}?member={memberId}` | Join with a preselected team member |
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

## Security limitations

- There is no real login yet.
- Team member and facilitator selection do not provide authentication or authorization.
- Anyone with the Pages link can access the frontend.
- An Apps Script Web App configured for public access is publicly reachable.
- Never put Jira tokens, API keys, or other secrets in the frontend.
- This version is an internal MVP; do not use it as a secure external product.
- Do not store sensitive or confidential information in the connected Sheet.
- Roles are used in the interface but are not securely enforced.

## Known limitations

- The app uses polling instead of real-time WebSockets.
- Jira tickets are entered manually; there is no Jira integration.
- There are no secure accounts, roles, or backend authorization.
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

With demo records (`team-demo`, `session-demo`, `ticket-demo`, `member-demo`), the complete voting flow can be tested: vote as a participant, confirm that the DOM contains only “Voted” before reveal, reveal as the facilitator, save the final estimate, and start a new round. Also test the participant link from a GitHub Pages project subdirectory.

When GJS is available, run the framework-free smoke tests with:

```bash
gjs -m tests/smoke.mjs
gjs -m tests/codegs-smoke.mjs
```

## License

This project is available under the [MIT License](LICENSE).
