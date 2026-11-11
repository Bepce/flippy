<?php
// Sessions, sign-in, users, CSRF.
declare(strict_types=1);

const MIN_PASSWORD = 10;

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $dir = data_path('sessions');
    if (!is_dir($dir)) @mkdir($dir, 0770, true);
    if (is_dir($dir) && is_writable($dir)) session_save_path($dir);     // shared hosts often clean the default folder too eagerly
    session_name('flippy_sid');
    session_set_cookie_params([
        'lifetime' => 0, 'path' => (base_path() ?: '') . '/', 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string) (60 * 60 * 12));
    session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

function current_user(): ?array
{
    start_session();
    if (empty($_SESSION['uid'])) return null;
    static $u = false;
    if ($u === false) {
        $s = db()->prepare('SELECT id, username, name, role, created, last_login FROM users WHERE id = ?');
        $s->execute([$_SESSION['uid']]);
        $u = $s->fetch() ?: null;
        if (!$u) unset($_SESSION['uid']);
    }
    return $u;
}

function require_user(): array
{
    $u = current_user();
    if (!$u) fail(401, 'Please sign in.');
    return $u;
}

function require_admin(): array
{
    $u = require_user();
    if ($u['role'] !== 'admin') fail(403, 'Only admins can do that.');
    return $u;
}

// every change made through the API carries the session's token in X-CSRF-Token
function check_csrf(): void
{
    start_session();
    $t = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['csrf'] ?? '');
    if (!is_string($t) || !hash_equals($_SESSION['csrf'], $t)) fail(403, 'The page is out of date. Reload it and try again.');
}

function user_count(): int
{
    return (int) db()->query('SELECT COUNT(*) FROM users')->fetchColumn();
}

function check_password_rules(string $pw): void
{
    if (mb_strlen($pw) < MIN_PASSWORD) fail(422, 'Use a password of at least ' . MIN_PASSWORD . ' characters.');
}

function create_user(string $username, string $name, string $role, string $password): int
{
    $username = trim($username);
    if (!preg_match('/^[A-Za-z0-9._@-]{2,60}$/', $username)) fail(422, 'A username is 2–60 letters, digits, dots, dashes, underscores or @.');
    if (!in_array($role, ['admin', 'editor'], true)) fail(422, 'Unknown role.');
    check_password_rules($password);
    try {
        $s = db()->prepare('INSERT INTO users (username, name, role, pass_hash, created) VALUES (?, ?, ?, ?, ?)');
        $s->execute([$username, mb_substr(trim($name), 0, 100), $role, password_hash($password, PASSWORD_DEFAULT), time()]);
    } catch (PDOException $e) {
        fail(409, 'That username is taken.');
    }
    return (int) db()->lastInsertId();
}

// 8 failed attempts in 15 minutes, per address or per username, pause sign-in for that one
function throttle_keys(string $username): array
{
    return ['ip:' . client_ip(), 'user:' . strtolower($username)];
}

function login(string $username, string $password): array
{
    $keys = throttle_keys($username);
    $since = time() - 900;
    db()->prepare('DELETE FROM login_fails WHERE at < ?')->execute([time() - 86400]);
    $s = db()->prepare('SELECT COUNT(*) FROM login_fails WHERE who = ? AND at > ?');
    foreach ($keys as $k) {
        $s->bindValue(1, $k);
        $s->bindValue(2, $since, PDO::PARAM_INT);
        $s->execute();
        $n = (int) $s->fetchColumn();
        $s->closeCursor();
        if ($n >= 8) fail(429, 'Too many failed attempts. Try again in 15 minutes.');
    }
    $q = db()->prepare('SELECT * FROM users WHERE username = ?');
    $q->execute([trim($username)]);
    $u = $q->fetch();
    // verify against a dummy hash when the user doesn't exist, so timing doesn't reveal usernames
    // unknown username: still check a (never matching) hash, so the response time doesn't reveal it
    $ok = password_verify($password, $u['pass_hash'] ?? '$2y$10$TtF4wg/3W0snbHVRLZcnQ.Fj57N6LwoLLgYhNNBapXpfl8WVOgK8G');
    if (!$u || !$ok) {
        $ins = db()->prepare('INSERT INTO login_fails (who, at) VALUES (?, ?)');
        foreach ($keys as $k) { $ins->bindValue(1, $k); $ins->bindValue(2, time(), PDO::PARAM_INT); $ins->execute(); }
        fail(401, 'Wrong username or password.');
    }
    if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) {
        db()->prepare('UPDATE users SET pass_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $u['id']]);
    }
    db()->prepare('DELETE FROM login_fails WHERE who = ?')->execute([$keys[1]]);
    db()->prepare('UPDATE users SET last_login = ? WHERE id = ?')->execute([time(), $u['id']]);
    sign_in((int) $u['id']);
    return $u;
}

function sign_in(int $uid): void
{
    start_session();
    session_regenerate_id(true);
    $_SESSION['uid'] = $uid;
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

function logout(): void
{
    start_session();
    $_SESSION = [];
    session_regenerate_id(true);
    $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

function public_user(array $u): array
{
    return ['id' => (int) $u['id'], 'username' => $u['username'], 'name' => $u['name'], 'role' => $u['role'],
        'created' => (int) $u['created'], 'lastLogin' => $u['last_login'] ? (int) $u['last_login'] : null];
}
