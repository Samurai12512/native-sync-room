#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "Usage: sudo ./scripts/install-coturn-ubuntu.sh turn.example.com username password"
  exit 1
fi

TURN_DOMAIN="$1"
TURN_USERNAME="$2"
TURN_PASSWORD="$3"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run this script with sudo."
  exit 1
fi

apt update
apt install -y coturn

cat >/etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=5349
fingerprint
lt-cred-mech
realm=${TURN_DOMAIN}
server-name=${TURN_DOMAIN}
user=${TURN_USERNAME}:${TURN_PASSWORD}
no-multicast-peers
no-cli
min-port=49152
max-port=65535
EOF

sed -i 's/^#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn

if command -v ufw >/dev/null 2>&1; then
  ufw allow 3478/tcp || true
  ufw allow 3478/udp || true
  ufw allow 5349/tcp || true
  ufw allow 5349/udp || true
  ufw allow 49152:65535/udp || true
fi

systemctl enable coturn
systemctl restart coturn
systemctl status coturn --no-pager

echo "Set these on Railway:"
echo "TURN_URL=turn:${TURN_DOMAIN}:3478,turns:${TURN_DOMAIN}:5349"
echo "TURN_USERNAME=${TURN_USERNAME}"
echo "TURN_CREDENTIAL=${TURN_PASSWORD}"
