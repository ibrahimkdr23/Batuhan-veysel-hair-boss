#!/usr/bin/env bash
# Hetzner (Ubuntu 24.04) sunucuya tek komutla kurulum.
# Kullanım (sunucuda root olarak):
#   DOMAIN=randevu.ornek.com ADMIN_PASSWORD='guclu-sifre' bash setup.sh
# DOMAIN verilmezse sunucunun IP'sinden ücretsiz bir sslip.io adresi kullanılır (HTTPS dahil).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/ibrahimkdr23/Batuhan-veysel-hair-boss.git}"
BRANCH="${BRANCH:-main}"
APP_DIR=/opt/hairboss

if [ -z "${DOMAIN:-}" ]; then
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${IP//./-}.sslip.io"
fi
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD gerekli}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

# Node.js 22
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Caddy (otomatik HTTPS)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

id hairboss >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin hairboss
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" reset --hard "origin/$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
cd "$APP_DIR"
npm ci --omit=dev

if [ ! -f .env ]; then
  cat > .env <<ENV
PORT=3000
ADMIN_PASSWORD=${ADMIN_PASSWORD}
SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
DB_PATH=${APP_DIR}/data/randevu.db
NETGSM_USERCODE=
NETGSM_PASSWORD=
NETGSM_HEADER=
OWNER_PHONE=
SALON_ADDRESS=
SALON_PHONE=
ENV
fi
mkdir -p data
chown -R hairboss:hairboss "$APP_DIR"
chmod 600 .env

cp deploy/hairboss.service /etc/systemd/system/hairboss.service
sed "s/{DOMAIN}/${DOMAIN}/" deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now hairboss
systemctl restart hairboss
systemctl reload caddy || systemctl restart caddy

ufw allow OpenSSH >/dev/null; ufw allow 80 >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null

echo
echo "Kurulum tamam!"
echo "Müşteri sayfası : https://${DOMAIN}/"
echo "Yönetim paneli  : https://${DOMAIN}/admin"
echo "Ayarlar dosyası : ${APP_DIR}/.env  (değiştirince: systemctl restart hairboss)"
