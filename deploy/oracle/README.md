# MyWeatherUK on an Oracle Cloud "Always Free" server

Since 17 Nov 2026 the plan is that the site runs here, 24/7, with the owner's PC off. The owner asked for a free
way; Oracle's Always Free tier gives one Arm server: 2 cores, 12 GB of memory, 200 GB of disk and 10 TB of
traffic a month, in the account's home region (UK South, London).

## What runs where

- **The server**, Ubuntu 24.04 on Arm. User `ubuntu` logs in with the key `~/.ssh/mwuk_oracle` on the PC.
  - **Caddy** answers on 80/443 and gets the HTTPS certificates for myweatheruk.com.
  - Caddy passes each request to the site, `node server/index.js` on port 8787: the systemd service `mwuk`, user `mwuk`.
  - The site starts its own Python jobs and workers (`/srv/mwuk/venv`).
- `/srv/mwuk/app`: the code, a clone of GitHub's `main`. The database (`server/data/db.json`), the uploads and `.env`
  are git-ignored, so they sit in it untouched by updates.
- `/srv/mwuk/data`: everything the PC keeps on D:. The paths are in `mwuk.env`.
- `/srv/mwuk/local`: the files the PC's builds always took from its own copy rather than git (`index.html`, the static
  data, a few more). Every build lays them over the code.
- **Updates**: `mwuk-update.timer` runs `update.sh` every 10 minutes.
  - A push to GitHub's `main` reaches the site within about 10 minutes, or longer when the page has to be rebuilt.
  - It restarts the site when the server's code, its Python or these files changed.
- **GitHub Actions** keeps making TCM NOVA, MWUK FROST and the rest as before. The site mirrors their releases.

## Setting it up (once)

1. In Oracle's console, create the instance:
   - **VM.Standard.A1.Flex**, 2 OCPUs, 12 GB, image Canonical Ubuntu 24.04, 200 GB boot volume.
   - A public IPv4 address, and the public key `~/.ssh/mwuk_oracle.pub`.
   - "Out of host capacity" is common on the free tier: try again later.
2. In the instance's subnet → Security Lists, add **ingress rules**: TCP **80** and **443** from `0.0.0.0/0`.
   setup.sh opens them in the server's own firewall as well.
3. From the PC (Git Bash, in the site's folder):

   ```bash
   scp -i ~/.ssh/mwuk_oracle deploy/oracle/setup.sh ubuntu@IP:
   ssh -i ~/.ssh/mwuk_oracle ubuntu@IP "sudo bash setup.sh IP"
   bash deploy/oracle/copy-data.sh IP data local env
   ```

4. Check `http://IP`.

## The switch (myweatheruk.com, then the PC can be off)

1. Stop the site on the PC: the "MyWeatherUK Server" task's watchdog, then node.
2. The owner runs `node deploy/oracle/set-admin-password.mjs` in their own terminal. The site's only account
   (`admin@localhost`, the admin) gets an email and password they know. The password is typed hidden and never seen.
3. `bash deploy/oracle/copy-data.sh IP server`: the database and uploads, with the server's site stopped meanwhile.
4. At IONOS (the domain's DNS), point **myweatheruk.com** and **www** at the server.
   - `A` record = the server's IP, in place of Netlify's 75.2.60.5.
   - `www` becomes an `A` record to the same IP, or a CNAME to `myweatheruk.com`.
   - Caddy gets the certificates within minutes of the change reaching it.
5. On the PC, disable the "MyWeatherUK Server" scheduled task, which would otherwise start the PC's copy again.
6. Point the iPhone app at `https://myweatheruk.com`: `eas.json` `EXPO_PUBLIC_API_URL`, then a new build.

## Everyday

- **Log:** `ssh -i ~/.ssh/mwuk_oracle ubuntu@IP "journalctl -u mwuk -f"`. The updates: `journalctl -u mwuk-update`.
- **Restart:** `sudo systemctl restart mwuk`. **Update now:** `sudo bash /srv/mwuk/app/deploy/oracle/update.sh`.
- **Settings only this server should have:** `/srv/mwuk/mwuk.local.env`, read after `mwuk.env`.
- **Free-tier rules:**
  - Never upgrade the account.
  - Oracle may take back an instance that idles for a week (its processor, network and memory all under 20 %). This site never idles.
