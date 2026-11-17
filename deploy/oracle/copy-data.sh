#!/usr/bin/env bash
# Copies the site's data from this PC to the Oracle server (deploy/oracle/README.md). Run in Git Bash on the PC:
#
#   bash deploy/oracle/copy-data.sh <server-ip> [part ...]
#
# parts:
#   data    the D: drive folders the server keeps (archives, map layers, the studio's terrain ...); the model frames,
#           caches and live layers are not copied: the server makes its own
#   local   the files the PC's builds always took from its own copy, not from git (index.html, the static data,
#           ...), to /srv/mwuk/local: every build on the server lays them over the code
#   env     .env (the secret keys), to /srv/mwuk/app/.env, readable only by the site
#   server  server/data (the database ...) and server/uploads. The site on BOTH machines must be stopped first,
#           or each rewrites its database from memory and the copy is lost or overwritten (README.md, the switch).
# default: data local env. Each folder goes as one tar stream over ssh (gzip -1) and replaces what is there.
set -euo pipefail
IP=${1:?"the server's IP, e.g.  bash deploy/oracle/copy-data.sh 132.145.10.20"}
shift
PARTS=${*:-data local env}
KEY=$HOME/.ssh/mwuk_oracle
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 "ubuntu@$IP")
SITE=$(cd "$(dirname "$0")/../.." && pwd)
D=/d/MyWeatherUK-data
N=/d/TCM-NOVA

# send <folder on the PC> <what inside it> <folder on the server>
send() {
  local base=$1 rel=$2 dest=$3
  if [ ! -e "$base/$rel" ]; then echo "   (not on this PC: $base/$rel)"; return; fi
  local mb; mb=$(du -sm "$base/$rel" 2>/dev/null | cut -f1)
  echo "-> $rel (${mb:-?} MB) into $dest"
  tar -C "$base" -cf - "$rel" | gzip -1 | "${SSH[@]}" "sudo mkdir -p '$dest' && gunzip | sudo tar -C '$dest' -xf - && sudo chown -R mwuk:mwuk '$dest'"
}

for part in $PARTS; do
  case $part in
    data)
      send "$D" lightning /srv/mwuk/data
      send "$D" aiw-env /srv/mwuk/data
      send "$D" studio /srv/mwuk/data
      send "$D" patterns /srv/mwuk/data
      send "$D" frost /srv/mwuk/data
      send "$D" tcm-archive /srv/mwuk/data
      for x in observed static shares roads climate consensus.json run_arrivals.json kp_forecast.json; do
        send "$D/modeldata" "$x" /srv/mwuk/data/modeldata
      done
      send "$N/data" terrain /srv/mwuk/data/tcm-nova/data
      send "$N" tcm-v3 /srv/mwuk/data/tcm-nova
      ;;
    local)
      cd "$SITE"
      files=(index.html public/static-data/Announcement.json public/static-data/SiteSettings.json src/components/TrafficLightGraphicTool.jsx)
      while IFS= read -r f; do files+=("$f"); done < <(git ls-files --others --exclude-standard public/uploads)
      echo "-> local overlay: ${files[*]}"
      tar -cf - "${files[@]}" | gzip -1 | "${SSH[@]}" "sudo mkdir -p /srv/mwuk/local && gunzip | sudo tar -C /srv/mwuk/local -xf - && sudo chown -R mwuk:mwuk /srv/mwuk/local"
      ;;
    env)
      echo "-> .env (the secret keys)"
      "${SSH[@]}" "sudo tee /srv/mwuk/app/.env >/dev/null && sudo chown mwuk:mwuk /srv/mwuk/app/.env && sudo chmod 600 /srv/mwuk/app/.env" < "$SITE/.env"
      ;;
    server)
      if curl -s -m 3 -o /dev/null http://localhost:8787/; then echo "the site on this PC is running: stop it first (README.md, the switch)"; exit 1; fi
      "${SSH[@]}" "sudo systemctl stop mwuk"
      cd "$SITE/server"
      echo "-> server/data (without its caches) and server/uploads"
      tar --exclude=data/ens-cache --exclude=data/img-cache --exclude=data/geo/raw --exclude='data/db.json.corrupt-*' \
          --exclude=data/trusted-devices.json -cf - data uploads \
        | gzip -1 | "${SSH[@]}" "gunzip | sudo tar -C /srv/mwuk/app/server -xf - && sudo chown -R mwuk:mwuk /srv/mwuk/app/server/data /srv/mwuk/app/server/uploads"
      "${SSH[@]}" "sudo systemctl start mwuk"
      ;;
    *) echo "unknown part: $part (data, local, env, server)"; exit 1 ;;
  esac
done
echo "copied: $PARTS"
