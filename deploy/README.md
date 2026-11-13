# Running flippy for customers on your own server

One small server runs a separate flippy for each customer, each on its own subdomain
(`palltex.flippy.io`, later `acme.flippy.io`), with HTTPS handled automatically by Caddy.
Each customer has their own catalogues, users and statistics in their own data volume.

The public website (`flippy.io`) is separate: it is served by GitHub Pages from this repository.

## What you need

- A domain, e.g. `flippy.io`, with access to its DNS settings.
- A small Linux server (VPS): 2 GB RAM and 40 GB disk is plenty to start, e.g. Hetzner CX22 or a
  DigitalOcean basic droplet (around €5 a month), with Ubuntu 24.04.

## 1. DNS

At your domain registrar, add:

| Name | Type | Value | For |
|---|---|---|---|
| `palltex` | A | your server's IP address | the Palltex flippy |
| `@` | A | `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` (four records) | the website on GitHub Pages |
| `www` | CNAME | `bepce.github.io` | the website |

Then, on GitHub: the repository's **Settings → Pages → Custom domain**, enter `flippy.io` and tick
**Enforce HTTPS** once it's offered.

## 2. The server, once

Log in to the server (`ssh root@your-server-ip`) and run:

```sh
# Docker
curl -fsSL https://get.docker.com | sh

# firewall: SSH and web only
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable

# flippy's deployment files
git clone https://github.com/Bepce/flippy.git /opt/flippy
cd /opt/flippy/deploy
cp .env.example .env
nano .env            # check PALLTEX_HOST and PALLTEX_CORS (the shop's addresses)

docker compose up -d
```

Wait a minute for the certificate, then open `https://palltex.flippy.io`. You'll see
**Set up flippy**: create the first account (yours), then add Palltex's people under **Users**.

## 3. Backups, once

```sh
crontab -e
# add this line: every night at 03:15
15 3 * * *  cd /opt/flippy/deploy && sh backup.sh >> backups/backup.log 2>&1
```

Backups land in `/opt/flippy/deploy/backups` (14 days kept). Also copy them off the server now and
then, or turn on your VPS provider's backups (a few euros a month), which covers everything.

To restore one: `docker compose stop palltex`, unpack the archive into the volume, rename
`backup.sqlite` to `flippy.sqlite`, `docker compose start palltex`.

## Updating flippy

When there's a new release, set it in `.env` (`FLIPPY_VERSION=0.5.0`), then:

```sh
cd /opt/flippy/deploy
git pull                         # newest deployment files
docker compose pull && docker compose up -d
```

Catalogues, users and statistics are in the volumes and stay as they are. To go back, set the
previous version and run the same two commands.

## Adding a customer

1. DNS: an A record for `acme` pointing at the server.
2. `docker-compose.yml`: copy the `palltex` block, rename it `acme`, and add an `acme-data` volume
   (and `ACME_HOST` under `caddy` → `environment`).
3. `Caddyfile`: copy the site block for `{$ACME_HOST}` → `acme:80`.
4. `.env`: add `ACME_HOST`, `ACME_SITE_NAME`, `ACME_CORS`.
5. `docker compose up -d`, then open the new address and create its first account.

## On the customer's website

In the flippy admin, open a catalogue and copy **Share and embed**. Paste it into a page of the
shop, e.g.

```html
<script src="https://palltex.flippy.io/dist/flippy.min.js"></script>
<flip-book src="https://palltex.flippy.io/c/bwell/"></flip-book>
```

Use the script embed, not the iframe: the viewer then runs inside the shop's page, so products
open in a popup on the shop's own site and the cart keeps working.
