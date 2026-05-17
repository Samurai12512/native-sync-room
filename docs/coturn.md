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

## Install

```bash
sudo apt update
sudo apt install -y coturn certbot
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
no-multicast-peers
no-cli
min-port=49152
max-port=65535
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

## Railway environment variables

Set these on the Railway app:

```text
TURN_URL=turn:turn.yourdomain.com:3478,turns:turn.yourdomain.com:5349
TURN_USERNAME=syncuser
TURN_CREDENTIAL=replace-with-a-long-random-password
```

## Test

After Railway deploys, open your public app URL, start a room, share your screen, and have the remote viewer open the room link.

If it fails only on some networks, the usual causes are closed UDP relay ports, DNS pointing at the wrong machine, wrong TURN credentials, or missing TLS setup for `turns:`.
