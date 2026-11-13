<?php
// Copy this file to config.php and change what you need. Everything here is optional.
// The same settings can be given as environment variables (FLIPPY_DATA_DIR, FLIPPY_SITE_NAME,
// FLIPPY_MAX_UPLOAD_MB, FLIPPY_CORS, FLIPPY_TRUST_PROXY), which is handy with Docker.
return [
    // Database and catalogue files. Safest outside the web root, e.g. '/home/you/flippy-data'.
    // Inside the web root it is protected by .htaccess on Apache; on nginx, block it (see the README).
    'data_dir' => __DIR__ . '/data',

    // Shown in the admin.
    'site_name' => 'Catalogues',

    // Largest catalogue zip, unpacked, in MB. PHP's upload_max_filesize and post_max_size must
    // allow it too.
    'max_upload_mb' => 300,

    // Which sites may embed your catalogues with <flip-book>: '*' for any, or a comma-separated
    // list of origins, e.g. 'https://palltex.bg, https://www.palltex.bg, https://beta.palltex.bg'.
    'cors' => '*',

    // Count views, pages and product clicks (anonymous daily totals, no cookies).
    'stats' => true,
    'ignore_bots' => true,

    // Behind a reverse proxy or load balancer that sets X-Forwarded-Proto / -For / -Host.
    'trust_proxy' => false,
];
