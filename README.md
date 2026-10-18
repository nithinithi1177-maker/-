# OAuth2 Discord Bot v5.9.8 — Clean Hardened

Discord OAuth2 verification bot for desktop, Android/Termux, VPS, and bot-hosting platforms.

## Project structure

```text
OAuth2-Discord-Bot-v5.9.8/
├── .env.example
├── .gitignore
├── README.md
├── index.html
├── index.js
├── package.json
├── public/
│   ├── app.js
│   └── style.css
├── src/
│   ├── commands.js
│   ├── config.js
│   ├── http.js
│   ├── interactions.js
│   ├── jobs.js
│   ├── oauth.js
│   ├── smart.js
│   ├── store.js
│   └── ui.js
└── tests/
    ├── test-env.js
    ├── self-test.js
    ├── release-audit.js
    ├── deep-audit.js
    ├── command-runtime-audit.js
    ├── interaction-runtime-audit.js
    ├── jobs-runtime-audit.js
    └── dependency-stub-loader.js
```

## Commands

All slash commands are Owner-only.

- `/oauthinfo`
- `/servercount`
- `/refreshtokens`
- `/smartstatus`
- `/deleteexpired`
- `/joinall guild_id:<ID>`
- `/addroleall role:<Role>`
- `/addrole user:<Member> role:<Role>`
- `/removeroleall role:<Role>`
- `/banall key:<BAN_ALL_KEY>`
- `/koks role:<Role> channel:<Channel> [options]`

`/banall` requires both the Owner lock and the exact `BAN_ALL_KEY`, compared in constant time.

## OAuth2 flow

`/koks` creates a verification panel whose button points to this bot's `/oauth/start` endpoint. Each click creates a fresh, signed, one-time OAuth state with a short expiration. The user is redirected to Discord, the callback validates and consumes the state, exchanges the one-time authorization code without retrying it, validates the actually authorized scopes through `/oauth2/@me` on every authorization and refresh, stores the fresh grant encrypted, joins the configured guild, and attempts to assign the configured role.

Transient OAuth/Discord failures start a fresh authorization flow instead of reusing an authorization code or an already-consumed state.

The redirect URI must exactly match the Discord Developer Portal configuration:

```text
https://your-domain.example/oauth/callback
```

## Environment

Copy `.env.example` to `.env` and set:

```text
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
OAUTH_REDIRECT_URI=https://your-domain.example/oauth/callback
OWNER_IDS=
PORT=3000
TOKEN_ENCRYPTION_KEY=
TRUST_PROXY=0
OAUTH_STATE_TTL_MS=600000
BAN_ALL_KEY=CHANGE_THIS_TO_A_LONG_RANDOM_SECRET
```

`TOKEN_ENCRYPTION_KEY` must be exactly 64 hexadecimal characters. `BAN_ALL_KEY` must be 32–128 characters and must be unpredictable.

`TRUST_PROXY=0` is appropriate for a direct Termux/VPS deployment. Set it to the exact number of trusted reverse-proxy hops when a reverse proxy is actually in front of the application.

## Discord Developer Portal

Before starting the bot, enable **Server Members Intent** under **Bot → Privileged Gateway Intents**.

For OAuth2 guild joining, the bot must already be a member of the target guild and have **Create Instant Invite** permission. Role verification also requires **Manage Roles**, with the verification role below the bot's highest role.

For bulk member operations, the project expects member access through the configured Gateway intent and uses the bot's actual current role hierarchy before attempting mutations.

## Install and run

```bash
npm install
npm test
npm run audit
npm run check
npm start
```

Node.js `>=22.12.0` is required. Node.js 24 LTS is recommended for new deployments.

## Storage and recovery

Runtime data is stored under `data/` and is excluded from the ZIP. The files use AES-256-GCM encryption and atomic writes. Each successful replacement keeps an encrypted `.bak` snapshot. If a primary file is corrupt, startup can recover from a valid backup. Runtime reads use the backup only when it is cryptographically valid for the same collection. If both primary and backup are missing or invalid, the bot fails closed instead of silently resetting data. Storage format v1 is migrated to the collection-bound v2 format automatically during startup.

The process also acquires an atomic single-instance lock at `data/.process.lock/` so two bot processes do not intentionally share the same file store. A stale lock with valid owner metadata can be quarantined safely; malformed or structurally invalid lock metadata is never auto-deleted.

User token changes are protected by a per-user lock. Callback and token-revocation cleanup also use a shared OAuth lifecycle lock so callback issuance cannot overlap with cleanup revocation. This prevents stale-token revocation from racing with a new authorization callback.

## Bulk jobs

Bulk role, ban, and guild-join jobs are persisted with checkpoints and can resume after restart. Expected target hierarchy failures are classified as skipped members rather than systemic bot failures. Repeated real permission failures stop the job safely and keep remaining items in `pendingIds` for recovery.

`/addroleall` and `/removeroleall` re-check target-member manageability at execution time. `/joinall` checks Create Instant Invite before creating the job. `/banall` keeps owner, configured Owner IDs, bot accounts, and unmanageable members out of the active queue.

## HTTP security

The web server uses security headers, strict same-origin CSP, rate limiting, no-store OAuth responses, HTTPS-only production callback validation, and static assets served from `/public`.

The web result page does not expose OAuth tokens in the URL.

## Validation

```bash
npm test
npm run audit
npm run check
```

The tests include strict storage-record validation, recovery-counter invariants, refresh/revocation race hardening, runtime execution of all 11 slash-command builders and all 11 owner-gated interaction handlers plus runtime execution of all four bulk-job engines, storage backup recovery, one-time OAuth flow state, expired-flow cleanup, process-lock ownership, authoritative OAuth scope validation, denied-authorization retry handling, uncommitted-token revocation, command ordering semantics, pending-job data sanitization, current panel recovery matching, CSP checks, secret redaction, interaction acknowledgement invariants, duplicate/legacy-file checks, and static source/release checks. Command definitions are also statically audited; live Discord.js builder execution still requires installing the declared dependencies.

Live Discord Gateway/REST/OAuth2 behavior still requires the bot's real credentials, permissions, OAuth application configuration, and a real Discord environment.

## Production verification note

The release does not ship `node_modules/` or runtime data. Install the pinned dependencies on the target machine before `npm start`. Node.js 24 LTS is recommended; Node.js 22.12.0+ is supported.
