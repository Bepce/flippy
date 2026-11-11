<?php
/*
 * flippy server: a catalogue library with sign-in, publishing from the builder, and click statistics.
 * https://github.com/Bepce/flippy · MIT licence
 *
 * Needs PHP 8.1+ with pdo_sqlite and zip. Settings: copy config.sample.php to config.php.
 * Local test:  php -S 127.0.0.1:8090 index.php
 */
declare(strict_types=1);

if (PHP_VERSION_ID < 80100) { http_response_code(500); exit('flippy needs PHP 8.1 or newer (this is ' . PHP_VERSION . ').'); }
foreach (['pdo_sqlite', 'zip'] as $ext) {
    if (!extension_loaded($ext)) { http_response_code(500); exit("flippy needs the PHP extension “{$ext}”. Ask your host to enable it."); }
}

define('APP_DIR', __DIR__);
require __DIR__ . '/lib/core.php';
require __DIR__ . '/lib/auth.php';
require __DIR__ . '/lib/catalogues.php';
require __DIR__ . '/lib/routes.php';

set_exception_handler(function (Throwable $e) {
    error_log('[flippy] ' . $e);
    fail(500, 'Something went wrong on the server. The details are in the PHP error log.');
});

handle_request();
