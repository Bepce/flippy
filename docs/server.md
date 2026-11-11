# flippy server

An optional server for a catalogue library on your own site:

- **Library**: all your catalogues in one place, with a public page and embed code for each.
- **Sign-in**: named users. Admins manage users; editors manage catalogues.
- **Publish from the builder**: make or edit a catalogue in the builder and press *Publish*.
  *Edit in builder* opens a published catalogue again, links and settings included.
- **Statistics**: views, pages seen and product clicks per day, per page and per link.
  Anonymous daily totals: no cookies, no IP addresses, nothing to put in a cookie banner.

It's PHP with an SQLite database, so it runs on ordinary shared hosting as well as in Docker.
You don't need it: a catalogue exported from the builder works as plain files on any website.

## Install

### On PHP hosting

You need PHP 8.1 or newer with the `pdo_sqlite` and `zip` extensions (most hosts have both).

1. Download `flippy-server-<version>.zip` from the
   [latest release](https://github.com/Bepce/flippy/releases/latest) and unzip it.
2. Upload the `flippy-server` folder to your site, for example as `/catalogues/`
   or a subdomain such as `catalogues.your-shop.com`.
3. Open it in your browser and create the first account.

The included `.htaccess` sets everything up on Apache, including keeping the data folder private.
For large catalogues PHP has to accept large uploads: set `upload_max_filesize = 300M` and
`post_max_size = 310M` in your host's PHP settings (the admin warns you when the limit is low).

**Keep the data folder private.** It holds the database and the catalogue files. Inside the web
root it's protected by `.htaccess` on Apache; the admin shows a warning if it can be downloaded.
Safest is outside the web root: copy `config.sample.php` to `config.php` and set `data_dir`.

### With Docker

```sh
docker run -d --name flippy -p 8080:80 -v flippy-data:/data ghcr.io/bepce/flippy-server
```

Then open http://localhost:8080/. Or use the [docker-compose.yml](../docker-compose.yml) in the
repository. Put it behind your usual HTTPS reverse proxy and set `FLIPPY_TRUST_PROXY=1`.

### On nginx with PHP-FPM

```nginx
server {
    server_name catalogues.your-shop.com;
    root /var/www/flippy-server;
    client_max_body_size 310m;

    location ~ ^/(data|lib)/ { deny all; }
    location ~ ^/(dist|builder)/ { try_files $uri =404; }
    location / {
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
        fastcgi_param SCRIPT_NAME /index.php;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
    }
}
```

In a subfolder (`/catalogues/`), use `SCRIPT_NAME /catalogues/index.php` and prefix the locations.

### Trying it locally

```sh
php -S 127.0.0.1:8090 server/index.php        # from the repository
```

On Windows: `winget install PHP.PHP.8.3`, then in PHP's folder copy `php.ini-development` to
`php.ini` and remove the `;` before `extension_dir = "ext"`, `extension=pdo_sqlite` and
`extension=zip`. Run `php -S localhost:8090 index.php` in the folder that contains `index.php`.

## Settings

Copy `config.sample.php` to `config.php`. Each setting can also be an environment variable.

| Setting | Variable | Default | |
|---|---|---|---|
| `data_dir` | `FLIPPY_DATA_DIR` | `data/` next to index.php | database and catalogue files |
| `site_name` | `FLIPPY_SITE_NAME` | `Catalogues` | shown in the admin |
| `max_upload_mb` | `FLIPPY_MAX_UPLOAD_MB` | `300` | largest catalogue, unpacked |
| `cors` | `FLIPPY_CORS` | `*` | which sites may embed catalogues: `*` or `https://shop.example` |
| `stats` | | `true` | count views and clicks |
| `ignore_bots` | | `true` | don't count crawlers and headless browsers |
| `trust_proxy` | `FLIPPY_TRUST_PROXY` | `false` | behind a reverse proxy that sets `X-Forwarded-*` |
| `base_path` | | worked out | the folder the app is in, if detection gets it wrong |

## Using it

- **New catalogue** opens the builder. Make the catalogue, then *Export → Publish*.
- **Upload zip** adds a zip exported from the builder (or drop it on the library).
- Each catalogue has a public page at `/c/<address>/`, and embed code for other pages:

  ```html
  <script src="https://catalogues.your-shop.com/dist/flippy.min.js"></script>
  <flip-book src="https://catalogues.your-shop.com/c/spring-2026/"></flip-book>
  ```

  Embedding on another domain works because catalogue files are served with CORS
  (`cors` setting). Products still open in a new tab there, unless the shop is on the same site;
  see "Popup or new tab" in the README.
- **Appearance** sets a catalogue's theme, background, accent colour, link highlight and toolbar
  language, with a live preview. It applies wherever the catalogue is shown: its own page,
  iframes and `<flip-book>` embeds (where the site's CSS can still override it). The address
  can override it too: `/c/spring/?theme=light&bg=ffffff`.
- **Iframe code** is there for sites that don't allow scripts in their pages. Products then
  open in a new tab.
- Views by signed-in users (your team, the admin's preview) aren't counted.
- **Hide** takes a catalogue offline without deleting it. Signed-in users can still preview it.
- **Replace with zip** or **Edit in builder → Publish** updates a catalogue in place; its address,
  embeds and statistics stay.

## Statistics

The viewer sends a small message when a catalogue from the server is opened, when new pages
come into view, and when a product link is clicked. The server adds them to daily totals:

| Counted | How |
|---|---|
| Views | each time the catalogue is opened (a reload counts again) |
| Pages seen | each page once per visit |
| Product clicks | per link address, only addresses that are in the catalogue |

Nothing identifies a visitor: no cookies, no IP addresses, no user agents are stored. Bots are
ignored. A site that embeds a catalogue can turn this off with `<flip-book track="false">`.

## Backups

Back up the data folder. To copy it safely while the site is running:
`sqlite3 data/flippy.sqlite ".backup flippy-backup.sqlite"`, plus `data/catalogues/`.

## Security notes

- Passwords are hashed with PHP's `password_hash`. Sign-in pauses after 8 failed attempts
  within 15 minutes, per address and per username.
- Sessions use HttpOnly, SameSite=Lax cookies (Secure on HTTPS). Every change needs the
  session's CSRF token. Use HTTPS; the admin warns you if it isn't.
- Uploaded zips are never unpacked as they are: only the expected files (page images checked by
  their content, the PDF, catalogue.json) are copied, and catalogue.json is rebuilt from known
  fields, so only `http(s)` links reach visitors.

## API

JSON over HTTP, used by the admin and the builder. Requests that change something need the
`X-CSRF-Token` header from `GET /api/me`.

| | |
|---|---|
| `GET /api/me` | server version, signed-in user, CSRF token |
| `POST /api/setup` | first account (only while there are no users) |
| `POST /api/login`, `POST /api/logout` | |
| `POST /api/password` | change your password |
| `GET /api/catalogues` | the library, with 30-day views and clicks |
| `POST /api/catalogues` | multipart: `zip`, `slug`, `replace=1` to overwrite (409 if it exists) |
| `GET /api/catalogues/<slug>` | one catalogue |
| `PATCH /api/catalogues/<slug>` | `title`, `slug`, `published` |
| `DELETE /api/catalogues/<slug>` | |
| `GET /api/catalogues/<slug>/zip` | the catalogue as a builder zip |
| `GET /api/catalogues/<slug>/stats?days=30` | daily views and clicks, pages, links |
| `GET/POST /api/users`, `PATCH/DELETE /api/users/<id>` | admins only |
| `POST /api/hit?c=<slug>` | the viewer's statistics beacon |
