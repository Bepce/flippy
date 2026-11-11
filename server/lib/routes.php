<?php
// Every request comes through here.
declare(strict_types=1);

function handle_request(): void
{
    $path = route_path();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    security_headers();

    // private folders, in case the web server serves them directly
    if (preg_match('#^/(data|lib)(/|$)|^/config\.php$|\.(sqlite|php)$#i', $path)) fail(404, 'Not found');

    if ($path === '/') { header('Location: ' . base_path() . '/admin/'); exit; }
    if ($path === '/admin') { header('Location: ' . base_path() . '/admin/'); exit; }
    if ($path === '/builder') { header('Location: ' . base_path() . '/builder/'); exit; }

    if (preg_match('#^/admin/(.*)$#', $path, $m)) {
        send_asset(APP_DIR . '/admin', $m[1], 0, [
            'Content-Security-Policy' => "default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'",
            'X-Frame-Options' => 'SAMEORIGIN',
        ]);
    }
    if (preg_match('#^/builder/(.*)$#', $path, $m)) send_asset(app_asset_dir('builder'), $m[1], 0, ['X-Frame-Options' => 'SAMEORIGIN']);
    if (preg_match('#^/dist/(.*)$#', $path, $m)) send_asset(app_asset_dir('dist'), $m[1], 3600, ['Access-Control-Allow-Origin' => '*']);
    if (preg_match('#^/c/([a-z0-9-]+)/?(.*)$#', $path, $m)) {
        if ($m[2] === '' && substr($path, -1) !== '/') { header('Location: ' . base_path() . '/c/' . $m[1] . '/'); exit; }
        serve_catalogue($m[1], $m[2]);
    }
    if (strpos($path, '/api/') === 0) { api($method, substr($path, 4)); }
    fail(404, 'Not found');
}

function api(string $method, string $p): void
{
    // the viewer's beacon: public, no session, no CSRF
    if ($p === '/hit' && $method === 'POST') record_hit((string) ($_GET['c'] ?? ''));
    if ($p === '/hit' && $method === 'OPTIONS') { header('Access-Control-Allow-Origin: *'); http_response_code(204); exit; }

    if ($p === '/me' && $method === 'GET') {
        $u = current_user();
        json_out(['flippyServer' => FLIPPY_VERSION, 'site' => cfg('site_name'), 'setup' => user_count() === 0,
            'user' => $u ? public_user($u) : null, 'csrf' => $_SESSION['csrf'], 'base' => base_path(), 'siteUrl' => site_url(),
            'maxUploadMb' => min((int) cfg('max_upload_mb'), upload_limit_mb())]);
    }
    if ($method !== 'GET') check_csrf();

    if ($p === '/setup' && $method === 'POST') {
        if (user_count() > 0) fail(409, 'This site is already set up. Sign in instead.');
        $b = body_json();
        $id = create_user((string) ($b['username'] ?? ''), (string) ($b['name'] ?? ''), 'admin', (string) ($b['password'] ?? ''));
        sign_in($id);
        json_out(['ok' => true]);
    }
    if ($p === '/login' && $method === 'POST') {
        $b = body_json();
        login((string) ($b['username'] ?? ''), (string) ($b['password'] ?? ''));
        json_out(['ok' => true]);
    }
    if ($p === '/logout' && $method === 'POST') { logout(); json_out(['ok' => true]); }

    $user = require_user();

    if ($p === '/password' && $method === 'POST') {
        $b = body_json();
        $s = db()->prepare('SELECT pass_hash FROM users WHERE id = ?');
        $s->execute([$user['id']]);
        if (!password_verify((string) ($b['current'] ?? ''), (string) $s->fetchColumn())) fail(422, 'Your current password isn’t right.');
        check_password_rules((string) ($b['password'] ?? ''));
        db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash((string) $b['password'], PASSWORD_DEFAULT), $user['id']]);
        sign_in((int) $user['id']);
        json_out(['ok' => true, 'csrf' => $_SESSION['csrf']]);
    }

    /* catalogues */
    if ($p === '/catalogues' && $method === 'GET') {
        $rows = db()->query('SELECT * FROM catalogues ORDER BY updated DESC')->fetchAll();
        json_out(['catalogues' => array_map(fn($c) => catalogue_public($c, true), $rows)]);
    }
    if ($p === '/catalogues' && $method === 'POST') {
        $f = $_FILES['zip'] ?? null;
        if (!$f || ($f['error'] ?? 1) !== UPLOAD_ERR_OK) {
            $code = $f['error'] ?? null;
            fail(in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || (!$f && ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) ? 413 : 422,
                in_array($code, [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || (!$f && ($_SERVER['CONTENT_LENGTH'] ?? 0) > 0)
                    ? 'The file is larger than this server accepts (' . upload_limit_mb() . ' MB). Raise upload_max_filesize and post_max_size in PHP.'
                    : 'No zip received.');
        }
        $slug = (string) ($_POST['slug'] ?? '');
        json_out(['catalogue' => save_catalogue($f['tmp_name'], $slug, ($_POST['replace'] ?? '') === '1', $user)]);
    }
    if (preg_match('#^/catalogues/([a-z0-9-]+)(/(zip|stats))?$#', $p, $m)) {
        $c = find_catalogue($m[1]);
        if (!$c) fail(404, 'No such catalogue.');
        $sub = $m[3] ?? '';
        if ($sub === 'zip' && $method === 'GET') send_catalogue_zip($c);
        if ($sub === 'stats' && $method === 'GET') json_out(catalogue_stats($c, (int) ($_GET['days'] ?? 30)));
        if ($sub === '' && $method === 'GET') json_out(['catalogue' => catalogue_public($c, true)]);
        if ($sub === '' && $method === 'PATCH') {
            $b = body_json();
            if (isset($b['title'])) {
                $t = mb_substr(trim(preg_replace('/\s+/u', ' ', (string) $b['title'])), 0, 200);
                if ($t === '') fail(422, 'Give the catalogue a title.');
                db()->prepare('UPDATE catalogues SET title = ? WHERE id = ?')->execute([$t, $c['id']]);
            }
            if (isset($b['published'])) db()->prepare('UPDATE catalogues SET published = ? WHERE id = ?')->execute([$b['published'] ? 1 : 0, $c['id']]);
            if (isset($b['slug']) && $b['slug'] !== $c['slug']) {
                if (!valid_slug((string) $b['slug'])) fail(422, 'An address is lowercase letters, digits and dashes.');
                if (find_catalogue((string) $b['slug'])) fail(409, 'Another catalogue already uses that address.');
                db()->prepare('UPDATE catalogues SET slug = ? WHERE id = ?')->execute([$b['slug'], $c['id']]);
                $c['slug'] = $b['slug'];
            }
            db()->prepare('UPDATE catalogues SET updated = ?, updated_by = ? WHERE id = ?')->execute([time(), $user['id'], $c['id']]);
            json_out(['catalogue' => catalogue_public(find_catalogue($c['slug']), true)]);
        }
        if ($sub === '' && $method === 'DELETE') { delete_catalogue($c); json_out(['ok' => true]); }
    }

    /* users (admins only) */
    if ($p === '/users') {
        require_admin();
        if ($method === 'GET') json_out(['users' => array_map('public_user', db()->query('SELECT * FROM users ORDER BY username')->fetchAll())]);
        if ($method === 'POST') {
            $b = body_json();
            $id = create_user((string) ($b['username'] ?? ''), (string) ($b['name'] ?? ''), (string) ($b['role'] ?? 'editor'), (string) ($b['password'] ?? ''));
            $s = db()->prepare('SELECT * FROM users WHERE id = ?'); $s->execute([$id]);
            json_out(['user' => public_user($s->fetch())]);
        }
    }
    if (preg_match('#^/users/(\d+)$#', $p, $m)) {
        require_admin();
        $s = db()->prepare('SELECT * FROM users WHERE id = ?'); $s->execute([(int) $m[1]]);
        $target = $s->fetch();
        if (!$target) fail(404, 'No such user.');
        $admins = (int) db()->query("SELECT COUNT(*) FROM users WHERE role = 'admin'")->fetchColumn();
        if ($method === 'PATCH') {
            $b = body_json();
            if (isset($b['role'])) {
                if (!in_array($b['role'], ['admin', 'editor'], true)) fail(422, 'Unknown role.');
                if ($target['role'] === 'admin' && $b['role'] !== 'admin' && $admins <= 1) fail(422, 'There has to be at least one admin.');
                db()->prepare('UPDATE users SET role = ? WHERE id = ?')->execute([$b['role'], $target['id']]);
            }
            if (isset($b['name'])) db()->prepare('UPDATE users SET name = ? WHERE id = ?')->execute([mb_substr(trim((string) $b['name']), 0, 100), $target['id']]);
            if (!empty($b['password'])) {
                check_password_rules((string) $b['password']);
                db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash((string) $b['password'], PASSWORD_DEFAULT), $target['id']]);
            }
            $s->execute([(int) $m[1]]);
            json_out(['user' => public_user($s->fetch())]);
        }
        if ($method === 'DELETE') {
            if ((int) $target['id'] === (int) $user['id']) fail(422, 'You can’t delete your own account.');
            if ($target['role'] === 'admin' && $admins <= 1) fail(422, 'There has to be at least one admin.');
            db()->prepare('DELETE FROM users WHERE id = ?')->execute([$target['id']]);
            json_out(['ok' => true]);
        }
    }
    fail(404, 'Not found');
}

function upload_limit_mb(): int
{
    $toMb = function ($v) {
        $v = trim((string) $v); $n = (float) $v; $u = strtolower(substr($v, -1));
        return (int) floor($u === 'g' ? $n * 1024 : ($u === 'm' ? $n : ($u === 'k' ? $n / 1024 : $n / 1048576)));
    };
    $vals = array_filter([$toMb(ini_get('upload_max_filesize')), $toMb(ini_get('post_max_size'))], fn($x) => $x > 0);
    return $vals ? min($vals) : 0;
}
