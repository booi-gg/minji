# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for security problems.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply as soon as possible; this is a personal project, so please allow some time for a fix.

## Supported versions

Only the latest commit on `main` is supported. Self-hosted copies should update from `main` to pick up fixes.

## How minji is designed to be safe

- **User code never leaves the browser.** Solutions run in a sandboxed iframe with an opaque origin (no `allow-same-origin`) and a strict Content Security Policy, inside a Web Worker that a watchdog stops when it runs too long. The runner has no access to the app's storage, cookies or network. See [specs/runner.md](specs/runner.md).
- **Problems are private.** Data lives in the browser's IndexedDB. With sign-in, it syncs only to the signing-in user's records in the Worker's D1 database.
- **Secrets stay out of the repository.** The GitHub OAuth client secret is a Worker secret (`wrangler secret put GITHUB_CLIENT_SECRET`), and local credentials go in the git-ignored `.dev.vars`. See [docs/self-hosting.md](docs/self-hosting.md).

Reports about escaping the runner sandbox, reading another user's synced data, or session handling are especially welcome.
