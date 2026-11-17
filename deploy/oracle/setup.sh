#!/usr/bin/env bash
# MyWeatherUK on an Oracle Cloud "Always Free" server (Ubuntu 24.04 on Arm), set up from nothing (17 Nov 2026, the
# user: "make it so that I DO NOT NEED my PC on at all ... so everyone can enjoy and use the app/website 24/7").
#
#   sudo bash setup.sh <the server's public IP>
#
# Safe to run again: each step looks at what is there first. In order: swap, system packages, Node.js, Caddy
# (HTTPS), the web ports in this server's own firewall, a 'mwuk' user owning /srv/mwuk/{app,data,local,venv}, the
# code from GitHub, Python 3.11 with requirements.txt, the settings and services (the site; its update from GitHub
# every 10 minutes), and a first build. The data and the secret keys are copied from the PC afterwards
# (copy-data.sh): see README.md.
set -euo pipefail

IP=${1:?"the server's public IP, e.g.  sudo bash setup.sh 132.145.10.20"}
REPO=https://github.com/dailymeteorology-code/myweatherukwebsite.git
NODE_VERSION=24.19.0                                  # what the PC runs
ROOT=/srv/mwuk
APP=$ROOT/app
say() { printf '\n== %s\n' "$*"; }

say "4 GB of swap: a build while the model jobs run can pass 12 GB for a moment"
if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
  [ -f /swapfile ] || { fallocate -l 4G /swapfile; chmod 600 /swapfile; mkswap /swapfile >/dev/null; }
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

say "system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y -q
apt-get install -y -q git curl ca-certificates gnupg build-essential pkg-config xz-utils tar unzip \
  libeccodes-dev iptables-persistent netfilter-persistent debian-keyring debian-archive-keyring apt-transport-https

say "Node.js $NODE_VERSION"
case "$(uname -m)" in aarch64) NA=arm64 ;; x86_64) NA=x64 ;; *) echo "unknown machine: $(uname -m)"; exit 1 ;; esac
if [ "$(/usr/local/bin/node --version 2>/dev/null || true)" != "v$NODE_VERSION" ]; then
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$NA.tar.xz" -o /tmp/node.tar.xz
  rm -rf /opt/node && mkdir -p /opt/node
  tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
  ln -sf /opt/node/bin/node /usr/local/bin/node
  ln -sf /opt/node/bin/npm /usr/local/bin/npm
  ln -sf /opt/node/bin/npx /usr/local/bin/npx
fi

say "Caddy (HTTPS certificates, fetched and renewed by itself)"
if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y -q
  apt-get install -y -q caddy
fi

say "the web ports (80, 443) in this server's own firewall (Oracle's network has its own: README.md)"
for p in 80 443; do
  if ! iptables -C INPUT -p tcp -m state --state NEW --dport "$p" -j ACCEPT 2>/dev/null; then
    n=$(iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" { print $1; exit }')   # Oracle's images end in a REJECT
    iptables -I INPUT "${n:-1}" -p tcp -m state --state NEW --dport "$p" -j ACCEPT
  fi
done
netfilter-persistent save >/dev/null

say "the site's own user and folders"
id mwuk >/dev/null 2>&1 || useradd --system --create-home --home-dir "$ROOT" --shell /bin/bash mwuk
mkdir -p "$ROOT"/data/{modeldata,lightning,tcm-nova/data,tcm-nova/tcm-v3,frost,patterns,patterns-cache,tcm-archive,studio,aiw-env,ens-cache} "$ROOT/local"
chown mwuk:mwuk "$ROOT" "$ROOT/local" "$ROOT/data" "$ROOT"/data/* "$ROOT"/data/tcm-nova/*
echo "$IP" > "$ROOT/ip"

say "the code, from GitHub"
[ -d "$APP/.git" ] || runuser -u mwuk -- git clone --quiet "$REPO" "$APP"

say "Python 3.11 and the site's packages (uv)"
UV=$ROOT/.local/bin/uv
[ -x "$UV" ] || runuser -u mwuk -- env UV_NO_MODIFY_PATH=1 INSTALLER_NO_MODIFY_PATH=1 bash -c 'curl -LsSf https://astral.sh/uv/install.sh | sh'
[ -x "$ROOT/venv/bin/python" ] || runuser -u mwuk -- "$UV" venv --quiet --python 3.11 "$ROOT/venv"
runuser -u mwuk -- "$UV" pip install --quiet --python "$ROOT/venv/bin/python" -r "$APP/deploy/oracle/requirements.txt"
runuser -u mwuk -- "$ROOT/venv/bin/python" -c "import numpy, scipy, numba, pyproj, eccodes, h5py, netCDF4, PIL, matplotlib, tifffile; print('python packages ok')"

say "settings and services"
install -m 644 "$APP/deploy/oracle/mwuk.env" "$ROOT/mwuk.env"
install -m 644 "$APP/deploy/oracle/mwuk.service" "$APP/deploy/oracle/mwuk-update.service" "$APP/deploy/oracle/mwuk-update.timer" /etc/systemd/system/
sed "s/__IP__/$IP/" "$APP/deploy/oracle/Caddyfile" > /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --quiet mwuk.service mwuk-update.timer caddy
systemctl reload-or-restart caddy

say "the first build and start (several minutes on 2 cores)"
bash "$APP/deploy/oracle/update.sh" --force
systemctl start mwuk-update.timer

say "done: the site is on http://$IP (myweatheruk.com once its DNS points here). Next: copy-data.sh on the PC (README.md)"
