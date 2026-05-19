# Security

## Reporting a vulnerability

If you find a vulnerability — for example, a way for the importer or
the dashboard to execute attacker-controlled code in a transcript, a
way to expose tracked data that should be local-only, or a credential
leak through generated artifacts — please **do not** open a public
issue.

**Preferred channel:** GitHub Security Advisories (private disclosure).
[Open a private report here.](https://github.com/zhuyihenzheng/ai-replay-studio/security/advisories/new)

Include:

- A short description of the issue.
- Reproduction steps if you have them.
- The version/commit you tested against.

You should expect an acknowledgement within 5 business days.

## Project privacy model

This is a **local-first** tool. Nothing is sent to a server.

The intended privacy boundary is:

- Source files in this repository never contain real transcripts.
- The tracked stub `src/data/claudeSessions.json` stays as `[]`.
- Real synced data goes into `src/data/claudeSessions.local.json`,
  which is in `.gitignore`.
- The screenshot script forces `VITE_FORCE_DEMO=1` so captures cannot
  include real local data.

If you find a path that breaks this boundary — for example, the build
output bundling local data, a route that leaks the local file path, or
a script that reads beyond the documented locations — that counts as a
security issue and we want to know about it.

## What is *not* in scope

- The importer reads transcripts from `~/.claude/projects` and
  `~/.codex/sessions`. If those transcripts already contain secrets
  (e.g., because an agent ran `cat .env`), the importer will preserve
  them. Removing secrets from your own local transcripts is your
  responsibility — we cannot do it safely on your behalf.
- The cost model is not a billing source of truth. It is explicitly
  described as an estimate with a `confidence` label and `evidence[]`.
  Inaccurate billing classification is a normal-priority bug, not a
  security issue.
