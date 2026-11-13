<?php
// Configuration, database, requests and responses.
declare(strict_types=1);

const FLIPPY_VERSION = '0.4.0';

// Windows PHP leaves mbstring off by default; these stand in for the two functions used here
if (!function_exists('mb_strlen')) {
    function mb_strlen($s): int { return (int) preg_match_all('/./us', (string) $s); }
}
if (!function_exists('mb_substr')) {
    function mb_substr($s, int $start, ?int $length = null): string
    {
        return implode('', array_slice(preg_split('//u', (string) $s, -1, PREG_SPLIT_NO_EMPTY) ?: [], $start, $length));
    }
}

function cfg(string $key)
{
    static $c = null;
    if ($c === null) {
        $c = [
            'data_dir' => APP_DIR . '/data',      // database and catalogue files; best kept outside the web root
            'site_name' => 'Catalogues',
            'max_upload_mb' => 300,               // largest catalogue zip, unpacked
            'trust_proxy' => false,               // true behind a reverse proxy that sets X-Forwarded-Proto/-For
            'cors' => '*',                        // who may embed catalogues: '*' or 'https://shop.example'
            'stats' => true,
            'ignore_bots' => true,
            'base_path' => null,                  // the folder the app is in, as seen from the browser; normally worked out
        ];
        foreach ([APP_DIR . '/config.php', getenv('FLIPPY_CONFIG') ?: ''] as $f) {
            if ($f && is_file($f)) $c = array_merge($c, (array) require $f);
        }
        foreach (['data_dir', 'site_name', 'max_upload_mb', 'cors'] as $k) {
            $env = getenv('FLIPPY_' . strtoupper($k));
            if ($env !== false && $env !== '') $c[$k] = is_numeric($env) ? +$env : $env;
        }
        if (getenv('FLIPPY_TRUST_PROXY')) $c['trust_proxy'] = true;
    }
    return $c[$key] ?? null;
}

function data_path(string $sub = ''): string
{
    return rtrim((string) cfg('data_dir'), '/') . ($sub !== '' ? '/' . $sub : '');
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $dir = data_path();
    if (!is_dir($dir) && !@mkdir($dir, 0770, true)) {
        fail(500, 'The data folder ' . $dir . ' can’t be created. Make it writable by the web server.');
    }
    protect_dir($dir);
    $pdo = new PDO('sqlite:' . $dir . '/flippy.sqlite', null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $pdo->exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    migrate($pdo);
    return $pdo;
}

// keep the data folder private on Apache even when it sits inside the web root
function protect_dir(string $dir): void
{
    if (!is_file($dir . '/.htaccess')) @file_put_contents($dir . '/.htaccess', "Require all denied\nDeny from all\n");
    if (!is_file($dir . '/index.html')) @file_put_contents($dir . '/index.html', '');
}

function migrate(PDO $pdo): void
{
    $v = (int) $pdo->query('PRAGMA user_version')->fetchColumn();
    if ($v < 1) {
        $pdo->exec("
            CREATE TABLE users (
                id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL DEFAULT '',
                role TEXT NOT NULL CHECK (role IN ('admin','editor')), pass_hash TEXT NOT NULL,
                created INTEGER NOT NULL, last_login INTEGER
            );
            CREATE TABLE catalogues (
                id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL, pages INTEGER NOT NULL,
                images TEXT NOT NULL DEFAULT 'webp', has_pdf INTEGER NOT NULL DEFAULT 0, published INTEGER NOT NULL DEFAULT 1,
                bytes INTEGER NOT NULL DEFAULT 0, rev INTEGER NOT NULL DEFAULT 1,
                created INTEGER NOT NULL, updated INTEGER NOT NULL, updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
            );
            CREATE TABLE stats (
                catalogue_id INTEGER NOT NULL REFERENCES catalogues(id) ON DELETE CASCADE,
                day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (catalogue_id, day, kind, key)
            ) WITHOUT ROWID;
            CREATE TABLE login_fails (who TEXT NOT NULL, at INTEGER NOT NULL);
            CREATE INDEX login_fails_who ON login_fails (who, at);
            PRAGMA user_version = 1;
        ");
        $v = 1;
    }
    if ($v < 2) {
        // per-catalogue appearance: theme, colours, link colour, language (JSON)
        $pdo->exec("ALTER TABLE catalogues ADD COLUMN look TEXT NOT NULL DEFAULT '{}'; PRAGMA user_version = 2;");
    }
}

/* ---------- request ---------- */

function is_https(): bool
{
    if (cfg('trust_proxy') && !empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) return strtolower($_SERVER['HTTP_X_FORWARDED_PROTO']) === 'https';
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || ($_SERVER['SERVER_PORT'] ?? '') == 443;
}

function client_ip(): string
{
    if (cfg('trust_proxy') && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) return trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
    return $_SERVER['REMOTE_ADDR'] ?? '';
}

// the folder the app is installed in, as seen from the browser: '' or '/flippy'
function base_path(): string
{
    if (cfg('base_path') !== null) return rtrim((string) cfg('base_path'), '/');
    if (PHP_SAPI === 'cli-server') return '';                 // php -S: SCRIPT_NAME is the requested path, not index.php
    $sn = $_SERVER['SCRIPT_NAME'] ?? '/index.php';
    if (basename($sn) !== 'index.php') return '';
    $dir = str_replace('\\', '/', dirname($sn));
    return rtrim($dir === '.' ? '' : $dir, '/');
}

function site_url(): string
{
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    if (cfg('trust_proxy') && !empty($_SERVER['HTTP_X_FORWARDED_HOST'])) $host = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_HOST'])[0]);
    return (is_https() ? 'https' : 'http') . '://' . $host . base_path();
}

function route_path(): string
{
    $p = rawurldecode(parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/');
    $b = base_path();
    if ($b !== '' && strpos($p, $b) === 0) $p = substr($p, strlen($b));
    if (strpos($p, '/index.php') === 0) $p = substr($p, 10);
    return $p === '' ? '/' : $p;
}

function body_json(): array
{
    $raw = file_get_contents('php://input', false, null, 0, 1 << 20);
    $d = json_decode($raw ?: '[]', true);
    return is_array($d) ? $d : [];
}

/* ---------- response ---------- */

function security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
}

function json_out($data, int $status = 200): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function fail(int $status, string $msg): void
{
    if (strpos(route_path(), '/api/') === 0 || !headers_sent() && stripos($_SERVER['HTTP_ACCEPT'] ?? '', 'json') !== false) {
        json_out(['error' => $msg], $status);
    }
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . $status
        . '</title><body style="font:16px system-ui;padding:40px;color:#333"><h1 style="font-size:20px">' . h($msg) . '</h1>';
    exit;
}

function h(?string $s): string
{
    return htmlspecialchars((string) $s, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

const MIME = [
    'html' => 'text/html; charset=utf-8', 'js' => 'text/javascript; charset=utf-8', 'mjs' => 'text/javascript; charset=utf-8',
    'css' => 'text/css; charset=utf-8', 'json' => 'application/json; charset=utf-8', 'svg' => 'image/svg+xml',
    'png' => 'image/png', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'webp' => 'image/webp', 'ico' => 'image/x-icon',
    'mp3' => 'audio/mpeg', 'pdf' => 'application/pdf', 'txt' => 'text/plain; charset=utf-8', 'map' => 'application/json',
    'woff2' => 'font/woff2',
];

// a file with caching (ETag / Last-Modified, answered with 304 when unchanged)
function send_file(string $path, ?string $type = null, int $maxAge = 300, array $extra = []): void
{
    if (!is_file($path)) fail(404, 'Not found');
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    $mtime = filemtime($path);
    $size = filesize($path);
    $etag = '"' . dechex($mtime) . '-' . dechex($size) . '"';
    foreach ($extra as $k => $v) header($k . ': ' . $v);
    header('Content-Type: ' . ($type ?: (MIME[$ext] ?? 'application/octet-stream')));
    header('Cache-Control: public, max-age=' . $maxAge);
    header('ETag: ' . $etag);
    header('Last-Modified: ' . gmdate('D, d M Y H:i:s', $mtime) . ' GMT');
    $inm = $_SERVER['HTTP_IF_NONE_MATCH'] ?? '';
    if ($inm !== '' && trim($inm) === $etag) { http_response_code(304); exit; }
    header('Content-Length: ' . $size);
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD') exit;
    readfile($path);
    exit;
}

// a file from one of the app's asset folders (admin, builder, dist), never outside it
function send_asset(string $root, string $rel, int $maxAge = 300, array $extra = []): void
{
    $rootReal = realpath($root);
    if ($rel === '' || substr($rel, -1) === '/') $rel .= 'index.html';
    $path = $rootReal ? realpath($rootReal . '/' . $rel) : false;
    if (!$path || strpos($path, $rootReal . DIRECTORY_SEPARATOR) !== 0 || !is_file($path)) fail(404, 'Not found');
    $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
    if (!isset(MIME[$ext]) || $ext === 'php') fail(404, 'Not found');
    send_file($path, null, $maxAge, $extra);
}

// where the builder and viewer files are: next to index.php in a release, one level up in the repository
function app_asset_dir(string $name): string
{
    foreach ([APP_DIR . '/' . $name, dirname(APP_DIR) . '/' . $name] as $d) if (is_dir($d)) return $d;
    return APP_DIR . '/' . $name;
}

function slugify(string $s): string
{
    $s = strtolower(trim(preg_replace('/[^A-Za-z0-9]+/', '-', (function_exists('iconv') ? @iconv('UTF-8', 'ASCII//TRANSLIT//IGNORE', $s) : '') ?: $s), '-'));
    return substr($s, 0, 60) ?: 'catalogue';
}

function valid_slug(string $s): bool
{
    return (bool) preg_match('/^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/', $s);
}

function rrmdir(string $dir): void
{
    if (!is_dir($dir)) return;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($dir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $f) $f->isDir() && !$f->isLink() ? rmdir($f->getPathname()) : unlink($f->getPathname());
    rmdir($dir);
}
