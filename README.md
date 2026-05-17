# Native Sync Room

A lightweight WebRTC screen-sync room. The host starts a room, shares a screen/window/tab, and sends one link. Viewers open that link and the stream starts in their browser.

## Run it

```powershell
npm install
npm start
```

Open:

```text
http://localhost:3030
```

Click **Start hosting**, copy the viewer link, then click **Share screen**. Viewers only need to open the link.

## Make it worldwide

For someone far away to watch, `localhost` will not work because it only exists on your own computer. You need:

1. A public HTTPS app URL.
2. A TURN server for reliable WebRTC connections.

The simplest setup is:

- Deploy this Node app on Railway, Render, Fly.io, or a small VPS.
- Add a TURN provider such as Metered.ca, Twilio Network Traversal, Xirsys, or your own coturn server.
- Set these environment variables on your deployed app:

```text
PORT=3030
TURN_URL=turn:your-turn-domain.com:3478,turns:your-turn-domain.com:5349
TURN_USERNAME=your-turn-username
TURN_CREDENTIAL=your-turn-password
```

For local testing, copy `.env.example` to `.env` and replace the TURN values.

More detailed setup:

- Railway app deployment: `docs/railway.md`
- Self-hosted coturn: `docs/coturn.md`
- Railway steps after coturn: `docs/railway-after-coturn.md`
- Ubuntu coturn helper script: `scripts/install-coturn-ubuntu.sh`

After deployment, you will use a URL like:

```text
https://your-sync-app.example.com
```

You start hosting there, click **Share screen**, then send the generated room link to the viewer.

### Recommended production path

Use Railway or Render for the Node app, and use a managed TURN provider first. That gets you worldwide testing fastest. Later, if you want lower recurring costs and more control, run coturn on a VPS.

### Self-hosted coturn example

On an Ubuntu VPS:

```bash
sudo apt update
sudo apt install coturn
sudo nano /etc/turnserver.conf
```

Minimal `turnserver.conf`:

```text
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=your-domain.com
user=syncuser:replace-with-a-long-password
no-multicast-peers
no-cli
```

Then open firewall ports:

```text
3478/tcp
3478/udp
5349/tcp
5349/udp
49152-65535/udp
```

For serious use, put TLS certificates on coturn and use `turns:` as well as `turn:`.

## What this version does

- Creates private room links.
- Uses WebRTC for low-latency host-to-viewer streaming.
- Uses Socket.IO only for room signaling.
- Sends screen video and optional tab/system audio when the browser allows it.
- Lets new viewers join an existing host stream automatically.
- Adapts host bitrate per viewer using WebRTC connection stats.
- Includes fullscreen viewing and responsive mobile layouts.

## Browser limits

Browsers intentionally require the host to approve screen sharing. A program cannot silently capture your screen from a web page without that permission prompt.

For internet use beyond your own machine, deploy the server to a public HTTPS host and add a TURN server. TURN is what keeps WebRTC reliable when viewers are behind strict Wi-Fi, school, work, hotel, or cellular networks.

## Good next upgrades

- Add host auth so only you can create rooms.
- Add TURN credentials through environment variables.
- Add adaptive bitrate controls for weak connections.
- Add a native desktop host app with Electron or Tauri for deeper browser integration.
- Add optional viewer chat, reactions, and remote pointer overlay.
