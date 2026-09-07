# Security

HEY Agent is early testing software. There is no independent security certification or guaranteed response SLA. Use the newest tested release; older prereleases do not have a separate maintenance branch.

## Reporting a vulnerability

Do not publish credentials, personal mail, transcripts, exploit details, or account identifiers in a public issue. Use GitHub's **Security → Report a vulnerability** when available. Before public distribution, the maintainer must enable private vulnerability reporting and test this route. If the option is unavailable, contact the maintainer privately to arrange a secure channel; do not assume a public issue is private.

Describe the affected version, reproduction using synthetic data, impact, and any mitigations. Review logs before sharing them. If a credential was exposed, revoke/rotate it with its provider; deleting a Git commit does not revoke a credential.

## Release security

- Source builds need no release credentials.
- Official publication requires a signed checksum manifest verified against the project's independently obtained public key.
- Never trust a replacement public key merely because it came in the same download as an update.
- Signing credentials are loaded only during a separate local signing step, not during dependency installation, tests, or packaging.
- Never run unreviewed pull-request code in a terminal with access to release credentials.
- No release should disable Electron's sandbox or require running the application as root.

## Runtime boundaries

The renderer is sandboxed and uses a restricted preload bridge. The main process and locally launched CLI/agent processes still have substantial authority as your desktop user. Account profiles separate app state, not OS permissions. Mail and model output are untrusted input. A release signature verifies the publisher's key, not the safety of every dependency, Helper, or external agent.
