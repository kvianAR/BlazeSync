# Security reporting

Do not post keys, private file contents, signed URLs or a vulnerability that exposes accounts in a public issue.

Use GitHub's **Report a vulnerability** flow under this repository's Security tab when available. If private reporting is not available, open a minimal issue requesting a private reporting channel **without exploit details or sensitive data**. Do not invent or assume a maintainer email address.

For a report, describe the affected behavior/version, impact, reproduction using synthetic/disposable data, and a proposed fix if known. There is no paid bug-bounty program or guaranteed response SLA.

## Boundaries

- The app uses B2 keys and must honor bucket permissions, retention, Object Lock and legal holds.
- Credentials belong in protected local storage, not renderer state, logs, screenshots or Git.
- Never bypass certificate validation or macOS security protections to work around installation problems.
- Use a disposable bucket when testing uploads/deletion; do not attack other users' accounts or services.

Only the latest published version is actively maintained. Local signing is not Apple notarization. A dependency audit covers reported advisories, not every possible security flaw.
