# Security review — October 14, 2026

The initial review covered every file and all 11 commits reachable from the public repository's main branch at `53e9eb4`, plus the GitHub Pages response and the matching parent-frame bridge in the main PlexPlus project.

No matches were found for private keys, GitHub/AWS token patterns, JWTs, credential-bearing URLs, Plex authorization literals, secret/password/API-key literals, or private IP addresses. This is a source/history audit, not a guarantee that every possible unknown secret pattern is detectable. No backend, package dependencies or Actions workflows were present in that audited snapshot.

## Protections

- Parent window, per-frame nonce and command schemas are checked before invoking the player.
- No playback snapshots are sent until a valid parent command establishes the origin.
- HTTPS/HTTP parents receive replies at their exact validated origin. Packaged opaque origins require `*`, but only after parent-window and nonce validation.
- No dynamic command names, arbitrary object arguments, or unbounded feedback strings are accepted.
- CSP allows the local code and required YouTube scripts/frames, blocks unknown script hosts, and prohibits form submission, base URL overrides and object embedding.
- Referrer metadata uses strict-origin-when-cross-origin, keeping the per-frame query value out of cross-origin Referer headers.
- Private account/config/key/cookie file types are excluded from Git.

Seven bridge tests passed, as did the main application's existing parent-bridge validation. An isolated Chromium check loaded the actual YouTube API, reached player ready, reported no provider CSP violations or JavaScript errors, and blocked a script from an unapproved origin. No Plex account, saved browser profile or media-server credentials were used in that test.

## Limits and ongoing maintenance

This does not audit GitHub account security, all collaborator permissions, private repository secrets/settings, or YouTube's own code. Enable account two-factor authentication, review collaborators/deploy access, and keep secrets out of this repository. Public client-side code is not an authentication boundary.

Never put private media/library information into bridge messages. An account/repository compromise could replace the served page, so source/deploy permissions remain important. The audit does not claim zero risk or that the Samsung port has completed physical-TV testing.

References: [postMessage security](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage), [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).
