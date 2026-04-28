# Clip

Tiny clipboard sync daemon for macOS. Syncs text clipboard between two machines over LAN.

## Setup

```bash
npm install
```

## Run

```bash
# Machine A (e.g. M4 Mac Mini)
CLIP_NAME=M4 CLIP_PEER=10.0.0.100:4545 CLIP_TOKEN=my-secret node src/server.js

# Machine B (e.g. MacBook)
CLIP_NAME=MacBook CLIP_PEER=10.0.0.218:4545 CLIP_TOKEN=my-secret node src/server.js
```

## Status page

http://localhost:4545

## Install as launchd service

```bash
# Edit launchd/com.bunlong.clip.plist with your CLIP_PEER and CLIP_TOKEN
cp launchd/com.bunlong.clip.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.bunlong.clip.plist
```

## Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.bunlong.clip.plist
rm ~/Library/LaunchAgents/com.bunlong.clip.plist
```

## How it works

- Polls `pbpaste` every 400ms (compares SHA-256 hash, not content)
- On change → sends to peer via WebSocket
- On receive → writes via `pbcopy`
- Echo prevention: 2s cooldown after receiving
- launchd keeps it alive forever
- Status page at :4545
- Never stores or logs clipboard content
