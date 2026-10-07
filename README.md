# Claude Hub

One window for every Claude Code session on this machine, styled like claude.ai.

```bash
./run.sh            # starts the server (port 4777) and opens an app window
# or
node server.js      # then visit http://localhost:4777
```

No dependencies beyond Node 18+ and the `claude` CLI.

## What it does

- **Sidebar** lists every session from `~/.claude/projects`, newest first. "Live now" shows
  sessions open in a terminal or running in the hub, with a pulsing dot while they work.
  `Ctrl+K` searches by title or folder.
- **Live view**: transcripts update as they're written, so you can watch a terminal session work.
- **Chat in place**: sending a message runs `claude -p --resume <id>` in the session's folder
  with streaming output. The process stays open for follow-ups and exits after 30 idle minutes
  (or click *Disconnect*). The conversation is the same session, so `claude --resume <id>` in a
  terminal picks it up later. *Terminal command* copies that command.
- **Permissions**: in *Ask permissions* mode, tool requests appear as Allow / Always allow / Deny
  cards. Questions from Claude and plan approvals get their own cards.
- **Sessions open in a terminal**: a running terminal can't be typed into from outside, so the
  first message asks you to **Take over** (closes that terminal's claude process and continues
  here) or **Fork a copy** (new session with the same history; the terminal is left alone).
- **New chat** starts a session in any folder you pick.

## Apps

Click the plug icon in the sidebar footer, or the **Apps** chip by the message box, then
**Add app**: give it a name and add rows of name | value, whatever the app needs (URL, API key,
account ID…).

Each row becomes an environment variable in chats run from the hub. App **Resend** with rows
`url` and `api key` gives `$RESEND_URL` and `$RESEND_API_KEY`. Claude is told which apps exist.
Values of rows whose name contains *key, token, secret, password, auth* stay hidden: they're
masked in the list and never put in the conversation. Other values (like URLs) are shown to
Claude.

Changes apply from the next message. Stored in `~/.config/claude-hub/connections.json` (mode 600).

## Security

The server listens on 127.0.0.1 only, rejects non-localhost `Host` headers, and requires a
per-run token that is embedded in the page, so other websites can't drive it.
