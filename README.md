# Claude Hub

One window for every Claude Code session on this machine, styled like claude.ai.

## Install / open

```bash
./run.sh
```

The first time, this installs dependencies, builds the desktop app and adds **Claude Hub** to
your app launcher, then opens it. Afterwards it just opens the app, rebuilding first if you've
changed the code. You can also open it from the launcher; there's no terminal step.

The app runs its own server and stops it when you quit. It opens at login by default (press Alt
for the menu → Claude Hub → Open at login). When a reply finishes while the window is in the
background, you get a desktop notification.

Other ways to run it:

```bash
./run.sh --browser  # browser version (server + app-style browser window)
npm start           # desktop window straight from the source folder, no install
node server.js      # just the server, at http://localhost:4777
```

Needs Node 18+ and the `claude` CLI.

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

## Google (local, read-only)

`mcp/google.js` is a local connector that lets Claude Code read your Gmail and Google Calendar. It runs on
this machine with no dependencies, uses read-only scopes (it can't send, delete or change anything), and
keeps your OAuth client and tokens in `~/.config/claude-hub/` (mode 600). They're only ever sent to Google.

One-time setup:

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable the
   **Gmail API** and **Google Calendar API**.
2. *APIs & Services → OAuth consent screen*: choose **Internal** if your Workspace allows it, otherwise
   **External** and add yourself as a test user.
3. *Credentials → Create credentials → OAuth client ID → Desktop app*, then **Download JSON** and save it as
   `~/.config/claude-hub/google-credentials.json`.
4. Sign in: `node mcp/google.js auth` (opens the browser). Check with `node mcp/google.js whoami`.
5. Register it with Claude Code (once): `claude mcp add -s user google-local -- node <path>/mcp/google.js`

Tools: `gmail_search`, `gmail_read_message`, `gmail_read_thread`, `calendar_list_events`, `google_whoami`.
To disconnect, delete `~/.config/claude-hub/google-token.json` (and revoke at
https://myaccount.google.com/permissions), or `claude mcp remove google-local -s user`.

## Security

The server listens on 127.0.0.1 only, rejects non-localhost `Host` headers, and requires a
per-run token that is embedded in the page, so other websites can't drive it.
