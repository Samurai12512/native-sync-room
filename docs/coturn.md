# Self-host coturn for Native Sync Room

This app uses WebRTC. For worldwide connections, STUN is not enough; TURN is the relay that keeps calls working when direct peer-to-peer networking fails.

## Recommended layout

- Railway: runs the Node app and Socket.IO signaling.
- VPS: runs coturn.
- DNS: points one subdomain to Railway and another to coturn.

Example:

```text
sync.yourdomain.com -> Railway app
turn.yourdomain.com -> VPS running coturn
```

## VPS requirements

Use a small Ubuntu VPS with a public IPv4 address. Open these firewall ports:

```text
3478/tcp
3478/udp
5349/tcp
5349/udp
49152-65535/udp
```

## Fast install

Point DNS first:

```text
turn.yourdomain.com -> your VPS IPv4 address
```

Then SSH into the VPS and run:

```bash
git clone https://github.com/Samurai12512/native-sync-room.git
cd native-sync-room
sudo ./scripts/install-coturn-ubuntu.sh turn.yourdomain.com syncuser 'replace-with-a-long-random-password' you@example.com
```

The script installs coturn, gets a Let's Encrypt certificate, configures TURN plus TURNS, opens common `ufw` ports when `ufw` exists, and restarts coturn when certificates renew.

## Manual install

```bash
sudo apt update
sudo apt install -y coturn certbot curl
sudo systemctl stop coturn || true
sudo certbot certonly --standalone -d turn.yourdomain.com
```

Enable coturn:

```bash
sudo sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

Create `/etc/turnserver.conf`:

```text
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=turn.yourdomain.com
server-name=turn.yourdomain.com
user=syncuser:replace-with-a-long-random-password
cert=/etc/letsencrypt/live/turn.yourdomain.com/fullchain.pem
pkey=/etc/letsencrypt/live/turn.yourdomain.com/privkey.pem
no-multicast-peers
no-cli
min-port=49152
max-port=65535
```

If your VPS is behind one-to-one NAT, add:

```text
external-ip=YOUR_PUBLIC_IPV4
```

If your VPS has a firewall:

```bash
sudo ufw allow 3478/tcp
sudo ufw allow 3478/udp
sudo ufw allow 5349/tcp
sudo ufw allow 5349/udp
sudo ufw allow 49152:65535/udp
```

Start coturn:

```bash
sudo systemctl enable coturn
sudo systemctl restart coturn
sudo systemctl status coturn
```

Restart coturn after certificate renewals:

```bash
sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
sudo tee /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh >/dev/null <<'EOF'
#!/usr/bin/env bash
systemctl restart coturn
EOF
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/restart-coturn.sh
```

## Railway environment variables

Set these on the Railway app:

```text
TURN_URL=turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349
TURN_USERNAME=syncuser
TURN_CREDENTIAL=replace-with-a-long-random-password
```

## Test

After Railway deploys, open your public app URL, start a room, share your screen, and have the remote viewer open the room link.

To confirm the frontend has the TURN config, open:

```text
https://your-railway-domain/config.js
```

If it fails only on some networks, the usual causes are closed UDP relay ports, DNS pointing at the wrong machine, wrong TURN credentials, or missing TLS setup for `turns:`.
