<?php
// The catalogue library: importing zips, serving files, statistics.
declare(strict_types=1);

const MAX_PAGES = 2000;

function catalogue_dir(int $id): string
{
    return data_path('catalogues/' . $id);
}

function find_catalogue(string $slug): ?array
{
    $s = db()->prepare('SELECT * FROM catalogues WHERE slug = ?');
    $s->execute([$slug]);
    return $s->fetch() ?: null;
}

// Only known keys and safe values: these end up in visitors' pages
function clean_look($in): array
{
    $in = is_array($in) ? $in : [];
    $out = [];
    if (in_array($in['theme'] ?? '', ['light', 'dark'], true)) $out['theme'] = $in['theme'];
    foreach (['bg', 'accent'] as $k) {
        $v = strtolower(ltrim(trim((string) ($in[$k] ?? '')), '#'));
        if (preg_match('/^[0-9a-f]{6}$/', $v)) $out[$k] = '#' . $v;
    }
    if (in_array($in['linkColor'] ?? '', ['grey', 'red', 'blue', 'white'], true)) $out['linkColor'] = $in['linkColor'];
    if (preg_match('/^[a-z]{2}$/', (string) ($in['lang'] ?? ''))) $out['lang'] = $in['lang'];
    return $out;
}

function catalogue_look(array $c): array
{
    return clean_look(json_decode((string) ($c['look'] ?? '{}'), true));
}

function catalogue_public(array $c, bool $withStats = false): array
{
    $base = site_url() . '/c/' . $c['slug'] . '/';
    $out = [
        'slug' => $c['slug'], 'title' => $c['title'], 'pages' => (int) $c['pages'], 'published' => (bool) $c['published'],
        'hasPdf' => (bool) $c['has_pdf'], 'bytes' => (int) $c['bytes'], 'created' => (int) $c['created'], 'updated' => (int) $c['updated'],
        'url' => $base, 'thumb' => $base . 'thumbs/001.' . $c['images'] . '?r=' . $c['rev'],
        'look' => (object) catalogue_look($c),
    ];
    if ($withStats) {
        $s = db()->prepare("SELECT kind, SUM(n) n FROM stats WHERE catalogue_id = ? AND day >= ? AND kind IN ('view','click') GROUP BY kind");
        $s->execute([$c['id'], gmdate('Y-m-d', time() - 29 * 86400)]);
        $t = ['view' => 0, 'click' => 0];
        foreach ($s as $r) $t[$r['kind']] = (int) $r['n'];
        $out['views30'] = $t['view'];
        $out['clicks30'] = $t['click'];
    }
    return $out;
}

/* ---------- import ---------- */

// Checks a catalogue.json from an upload and rebuilds it from known fields only, so nothing
// unexpected (javascript: links, huge strings, extra keys) reaches visitors.
function clean_catalogue_json($d): array
{
    if (!is_array($d)) fail(422, 'catalogue.json isn’t valid JSON.');
    $n = (int) ($d['pageCount'] ?? 0);
    if ($n < 1 || $n > MAX_PAGES) fail(422, 'catalogue.json has no pages, or more than ' . MAX_PAGES . '.');
    $aspect = (float) ($d['aspect'] ?? 0);
    if ($aspect < 0.1 || $aspect > 10) fail(422, 'catalogue.json has no valid page aspect ratio.');
    $images = $d['images'] ?? 'webp';
    if (!in_array($images, ['webp', 'jpg', 'png'], true)) fail(422, 'Page images must be WebP, JPEG or PNG.');
    $pages = [];
    for ($i = 0; $i < $n; $i++) {
        $src = $d['pages'][$i]['links'] ?? [];
        $links = [];
        foreach (is_array($src) ? array_slice($src, 0, 2000) : [] as $l) {
            if (!is_array($l)) continue;
            $box = [];
            foreach (['x', 'y', 'w', 'h'] as $k) $box[$k] = round(max(0, min(1, (float) ($l[$k] ?? 0))), 4);
            if ($box['w'] <= 0 || $box['h'] <= 0) continue;
            $kind = preg_replace('/[^a-z]/', '', strtolower((string) ($l['kind'] ?? 'link'))) ?: 'link';
            $box['kind'] = substr($kind, 0, 20);
            if (!empty($l['page'])) {
                $p = (int) $l['page'];
                if ($p < 1 || $p > $n) continue;
                $box['page'] = $p;
            } elseif (!empty($l['url']) && is_string($l['url']) && strlen($l['url']) <= 2000 && preg_match('#^https?://#i', $l['url'])) {
                $box['url'] = $l['url'];
            } else continue;
            $links[] = $box;
        }
        $pages[] = ['n' => $i + 1, 'links' => $links];
    }
    $title = trim(preg_replace('/\s+/u', ' ', (string) ($d['title'] ?? '')));
    return ['title' => mb_substr($title ?: 'Catalogue', 0, 200), 'aspect' => round($aspect, 4), 'pageCount' => $n,
        'images' => $images, 'pdf' => empty($d['pdf']) ? null : 'catalogue.pdf', 'pages' => $pages];
}

// Unpack an uploaded zip (from the builder, or any catalogue folder zipped) into a new folder.
// Only known file names are written, so the zip's paths never decide where anything goes.
function unpack_catalogue(string $zipPath): array
{
    if (!class_exists('ZipArchive')) fail(500, 'PHP’s zip extension is missing on this server.');
    $zip = new ZipArchive();
    if ($zip->open($zipPath) !== true) fail(422, 'That isn’t a zip file.');
    if ($zip->numFiles > 10000) fail(422, 'The zip has too many files.');
    $jsonAt = null;
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if (preg_match('#(^|/)catalogue\.json$#', $name) && ($jsonAt === null || strlen($name) < strlen($jsonAt))) $jsonAt = $name;
    }
    if ($jsonAt === null) fail(422, 'No catalogue.json in the zip. Export the catalogue from the builder and upload that zip.');
    $prefix = substr($jsonAt, 0, -strlen('catalogue.json'));
    $raw = $zip->getFromName($jsonAt, 50 << 20);
    $data = clean_catalogue_json(json_decode((string) $raw, true));
    $ext = $data['images'];

    $limit = (int) cfg('max_upload_mb') << 20;
    $total = 0;
    $tmp = data_path('tmp/' . bin2hex(random_bytes(8)));
    mkdir($tmp . '/pages', 0770, true);
    mkdir($tmp . '/thumbs', 0770, true);
    $copy = function (string $entry, string $dest, string $magic) use ($zip, &$total, $limit, $tmp): bool {
        $st = $zip->statName($entry);
        if (!$st) return false;
        $total += $st['size'];
        if ($total > $limit) { rrmdir($tmp); fail(413, 'The catalogue is larger than ' . cfg('max_upload_mb') . ' MB.'); }
        $in = $zip->getStream($entry);
        if (!$in) return false;
        $head = fread($in, 16);
        if (!magic_ok($head, $magic)) { fclose($in); rrmdir($tmp); fail(422, basename($dest) . ' isn’t a ' . strtoupper($magic) . ' file.'); }
        $out = fopen($tmp . '/' . $dest, 'wb');
        fwrite($out, $head);
        stream_copy_to_stream($in, $out);
        fclose($in); fclose($out);
        return true;
    };
    $magicFor = $ext === 'jpg' ? 'jpeg' : $ext;
    for ($p = 1; $p <= $data['pageCount']; $p++) {
        $f = sprintf('%03d.%s', $p, $ext);
        if (!$copy($prefix . 'pages/' . $f, 'pages/' . $f, $magicFor)) { rrmdir($tmp); fail(422, "Page image pages/$f is missing from the zip."); }
        $copy($prefix . 'thumbs/' . $f, 'thumbs/' . $f, $magicFor) || copy($tmp . '/pages/' . $f, $tmp . '/thumbs/' . $f);
    }
    $hasPdf = false;
    if ($data['pdf']) {
        $src = $zip->locateName($prefix . 'catalogue.pdf') !== false ? 'catalogue.pdf' : basename((string) json_decode((string) $raw, true)['pdf']);
        $hasPdf = $copy($prefix . $src, 'catalogue.pdf', 'pdf');
        if (!$hasPdf) $data['pdf'] = null;
    }
    // each page's text for the viewer's search: a list of strings, one per page
    $search = $zip->getFromName($prefix . 'search.json', 30 << 20);
    if ($search !== false) {
        $list = json_decode($search, true);
        if (is_array($list) && count($list) <= $data['pageCount']) {
            $list = array_map(fn($t) => is_string($t) ? mb_substr($t, 0, 50000) : '', array_values($list));
            file_put_contents($tmp . '/search.json', json_encode($list, JSON_UNESCAPED_UNICODE));
        }
    }
    // the builder's project file (codes, settings), so the catalogue can be edited again; never served publicly
    $proj = $zip->getFromName($prefix . 'flippy-project.json', 30 << 20);
    if ($proj !== false && is_array(json_decode($proj, true))) file_put_contents($tmp . '/flippy-project.json', $proj);
    $zip->close();
    file_put_contents($tmp . '/catalogue.json', json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    return ['dir' => $tmp, 'data' => $data, 'hasPdf' => $hasPdf, 'bytes' => $total];
}

function magic_ok(string $head, string $kind): bool
{
    switch ($kind) {
        case 'webp': return substr($head, 0, 4) === 'RIFF' && substr($head, 8, 4) === 'WEBP';
        case 'jpeg': return substr($head, 0, 3) === "\xFF\xD8\xFF";
        case 'png': return substr($head, 0, 8) === "\x89PNG\r\n\x1a\n";
        case 'pdf': return strpos($head, '%PDF-') !== false;
    }
    return false;
}

// Create a catalogue, or replace one (same slug) when $replace is true
function save_catalogue(string $zipPath, string $slug, bool $replace, array $user): array
{
    if (!valid_slug($slug)) fail(422, 'A catalogue address is lowercase letters, digits and dashes.');
    $existing = find_catalogue($slug);
    if ($existing && !$replace) json_out(['error' => 'A catalogue called “' . $slug . '” already exists.', 'exists' => true, 'slug' => $slug], 409);
    $u = unpack_catalogue($zipPath);
    $d = $u['data'];
    $now = time();
    $pdo = db();
    $pdo->beginTransaction();
    if ($existing) {
        $id = (int) $existing['id'];
        $pdo->prepare('UPDATE catalogues SET title = ?, pages = ?, images = ?, has_pdf = ?, bytes = ?, rev = rev + 1, updated = ?, updated_by = ? WHERE id = ?')
            ->execute([$d['title'], $d['pageCount'], $d['images'], (int) $u['hasPdf'], $u['bytes'], $now, $user['id'], $id]);
    } else {
        $pdo->prepare('INSERT INTO catalogues (slug, title, pages, images, has_pdf, bytes, published, created, updated, updated_by) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
            ->execute([$slug, $d['title'], $d['pageCount'], $d['images'], (int) $u['hasPdf'], $u['bytes'], $now, $now, $user['id']]);
        $id = (int) $pdo->lastInsertId();
    }
    // swap folders: the old one is removed only once the new one is in place
    $dir = catalogue_dir($id);
    if (!is_dir(dirname($dir))) mkdir(dirname($dir), 0770, true);
    $old = $dir . '.old-' . bin2hex(random_bytes(4));
    if (is_dir($dir)) rename($dir, $old);
    if (!rename($u['dir'], $dir)) {
        if (is_dir($old)) rename($old, $dir);
        $pdo->rollBack();
        fail(500, 'Couldn’t store the catalogue. Check that the data folder is writable.');
    }
    $pdo->commit();
    if (is_dir($old)) rrmdir($old);
    return catalogue_public(find_catalogue($slug), true);
}

function delete_catalogue(array $c): void
{
    db()->prepare('DELETE FROM catalogues WHERE id = ?')->execute([$c['id']]);
    rrmdir(catalogue_dir((int) $c['id']));
}

// The catalogue as a zip the builder can open again
function send_catalogue_zip(array $c): void
{
    $dir = catalogue_dir((int) $c['id']);
    $tmp = tempnam(sys_get_temp_dir(), 'flz');
    $zip = new ZipArchive();
    $zip->open($tmp, ZipArchive::OVERWRITE);
    $root = $c['slug'] . '/';
    foreach (['catalogue.json', 'catalogue.pdf', 'flippy-project.json', 'search.json'] as $f) {
        if (is_file("$dir/$f")) { $zip->addFile("$dir/$f", $root . $f); $zip->setCompressionName($root . $f, ZipArchive::CM_STORE); }
    }
    foreach (['pages', 'thumbs'] as $sub) {
        foreach (glob("$dir/$sub/*") ?: [] as $f) {
            $zip->addFile($f, $root . $sub . '/' . basename($f));
            $zip->setCompressionName($root . $sub . '/' . basename($f), ZipArchive::CM_STORE);
        }
    }
    $zip->close();
    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $c['slug'] . '.zip"');
    header('Content-Length: ' . filesize($tmp));
    header('Cache-Control: no-store');
    readfile($tmp);
    unlink($tmp);
    exit;
}

/* ---------- public files ---------- */

function catalogue_data_for_visitors(array $c): array
{
    $d = json_decode((string) file_get_contents(catalogue_dir((int) $c['id']) . '/catalogue.json'), true);
    $d['title'] = $c['title'];                                    // renamed in the admin
    if (!$c['has_pdf']) unset($d['pdf']);
    if ($d['images'] === 'webp') unset($d['images']);
    $look = catalogue_look($c);
    if ($look) $d['look'] = $look;
    if (is_file(catalogue_dir((int) $c['id']) . '/search.json')) $d['search'] = 'search.json'; else unset($d['search']);
    if (cfg('stats')) $d['track'] = site_url() . '/api/hit?c=' . rawurlencode($c['slug']);
    return $d;
}

function serve_catalogue(string $slug, string $file): void
{
    $c = find_catalogue($slug);
    if (!$c || (!$c['published'] && !current_user())) fail(404, 'This catalogue doesn’t exist or isn’t published.');
    $cors = cors_headers();
    if ($file === '' ) {
        send_viewer_page($c);
    }
    if ($file === 'catalogue.json' || $file === 'catalogue.js') {
        $json = json_encode(catalogue_data_for_visitors($c), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        foreach ($cors as $k => $v) header("$k: $v");
        header('Cache-Control: no-cache');
        if ($file === 'catalogue.json') { header('Content-Type: application/json; charset=utf-8'); echo $json; }
        else { header('Content-Type: text/javascript; charset=utf-8'); echo 'window.FLIPPY_DATA=window.FLIPPY_DATA||{};window.FLIPPY_DATA[' . json_encode($slug) . ']=' . $json . ";\n"; }
        exit;
    }
    $dir = catalogue_dir((int) $c['id']);
    if ($file === 'search.json') send_file(catalogue_dir((int) $c['id']) . '/search.json', 'application/json; charset=utf-8', 300, $cors);
    if ($file === 'catalogue.pdf' && $c['has_pdf']) {
        send_file("$dir/catalogue.pdf", 'application/pdf', 300, $cors + ['Content-Disposition' => 'inline; filename="' . $slug . '.pdf"']);
    }
    if (preg_match('#^(pages|thumbs)/(\d{3,4})\.(webp|jpg|png)$#', $file, $m) && $m[3] === $c['images']) {
        // short cache with revalidation: a replaced catalogue keeps its file names
        send_file("$dir/{$m[1]}/{$m[2]}.{$m[3]}", null, 300, $cors);
    }
    fail(404, 'Not found');
}

// Which sites may load the catalogue's files: "*" for any, or a comma-separated list of
// origins (https://palltex.bg, https://www.palltex.bg). A listed origin is echoed back.
function cors_headers(): array
{
    $allowed = trim((string) cfg('cors'));
    if ($allowed === '' || $allowed === '*') return ['Access-Control-Allow-Origin' => '*'];
    $origin = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
    $list = array_filter(array_map(fn($o) => rtrim(trim($o), '/'), explode(',', $allowed)));
    return in_array($origin, $list, true) ? ['Access-Control-Allow-Origin' => $origin, 'Vary' => 'Origin'] : ['Vary' => 'Origin'];
}

function send_viewer_page(array $c): void
{
    $title = h($c['title']);
    $look = catalogue_look($c);
    $q = $_GET['bg'] ?? '';
    $bg = preg_match('/^#?[0-9a-fA-F]{6}$/', (string) $q) ? '#' . ltrim((string) $q, '#')
        : ($look['bg'] ?? ((($_GET['theme'] ?? $look['theme'] ?? '') === 'light') ? '#e3e6eb' : '#1f2228'));
    $bg = h($bg);
    $lang = h($look['lang'] ?? 'en');
    $src = h(base_path() . '/c/' . $c['slug'] . '/');
    $dist = h(base_path() . '/dist/');
    // the viewer's address changes whenever its file does, so browsers never keep an old copy
    $v = FLIPPY_VERSION . '-' . @filemtime(app_asset_dir('dist') . '/flippy.min.js');
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: no-cache');
    security_headers();
    echo <<<HTML
<!doctype html>
<html lang="$lang">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="$bg">
  <title>$title</title>
  <meta property="og:title" content="$title">
  <link rel="stylesheet" href="{$dist}flippy.min.css?v=$v">
  <style>html, body { height: 100%; margin: 0; background: $bg; }</style>
</head>
<body>
  <div class="flippy" data-src="$src" style="height: 100%"></div>
  <script src="{$dist}flippy.min.js?v=$v"></script>
</body>
</html>
HTML;
    exit;
}

/* ---------- statistics ---------- */

// Anonymous daily counts: views, pages seen, product clicks. No cookies, no addresses stored.
function record_hit(string $slug): void
{
    header('Access-Control-Allow-Origin: *');
    if (!cfg('stats')) { http_response_code(204); exit; }
    if (cfg('ignore_bots') && preg_match('/bot|crawl|spider|slurp|preview|headless|lighthouse/i', $_SERVER['HTTP_USER_AGENT'] ?? 'bot')) { http_response_code(204); exit; }
    $c = find_catalogue($slug);
    if (!$c || !$c['published']) { http_response_code(204); exit; }
    // your own team looking at catalogues (and the admin's preview) doesn't count
    if (!empty($_COOKIE['flippy_sid']) && current_user()) { http_response_code(204); exit; }
    $b = body_json();
    $e = $b['e'] ?? '';
    $day = gmdate('Y-m-d');
    $rows = [];
    if ($e === 'view') $rows[] = ['view', ''];
    elseif ($e === 'page') {
        foreach (array_slice((array) ($b['p'] ?? []), 0, 2) as $p) if ((int) $p >= 1 && (int) $p <= $c['pages']) $rows[] = ['page', (string) (int) $p];
    } elseif ($e === 'click' && is_string($b['u'] ?? null)) {
        // only addresses that really are in the catalogue, so the table can't be filled with junk
        $d = json_decode((string) file_get_contents(catalogue_dir((int) $c['id']) . '/catalogue.json'), true);
        $known = false;
        foreach ($d['pages'] as $pg) foreach ($pg['links'] as $l) if (($l['url'] ?? null) === $b['u']) { $known = true; break 2; }
        if ($known) { $rows[] = ['click', $b['u']]; $rows[] = ['clickpage', (string) (int) ($b['p'] ?? 0)]; }
    }
    if ($rows) {
        $s = db()->prepare('INSERT INTO stats (catalogue_id, day, kind, key, n) VALUES (?, ?, ?, ?, 1)
                            ON CONFLICT (catalogue_id, day, kind, key) DO UPDATE SET n = n + 1');
        foreach ($rows as [$kind, $key]) $s->execute([$c['id'], $day, $kind, $key]);
    }
    http_response_code(204);
    exit;
}

function catalogue_stats(array $c, int $days): array
{
    $days = max(1, min(366, $days));
    $from = gmdate('Y-m-d', time() - ($days - 1) * 86400);
    $id = (int) $c['id'];
    $series = [];
    for ($i = $days - 1; $i >= 0; $i--) $series[gmdate('Y-m-d', time() - $i * 86400)] = ['day' => gmdate('Y-m-d', time() - $i * 86400), 'views' => 0, 'clicks' => 0];
    $s = db()->prepare("SELECT day, kind, SUM(n) n FROM stats WHERE catalogue_id = ? AND day >= ? AND kind IN ('view','click') GROUP BY day, kind");
    $s->execute([$id, $from]);
    foreach ($s as $r) if (isset($series[$r['day']])) $series[$r['day']][$r['kind'] === 'view' ? 'views' : 'clicks'] = (int) $r['n'];
    $top = function (string $kind, int $limit) use ($id, $from) {
        $s = db()->prepare('SELECT key, SUM(n) n FROM stats WHERE catalogue_id = ? AND day >= ? AND kind = ? GROUP BY key ORDER BY n DESC, key LIMIT ' . $limit);
        $s->execute([$id, $from, $kind]);
        return $s->fetchAll();
    };
    $pages = array_map(fn($r) => ['page' => (int) $r['key'], 'views' => (int) $r['n']], $top('page', 500));
    $clickPages = [];
    foreach ($top('clickpage', 500) as $r) $clickPages[(int) $r['key']] = (int) $r['n'];
    foreach ($pages as &$p) $p['clicks'] = $clickPages[$p['page']] ?? 0;
    unset($p);
    usort($pages, fn($a, $b) => $a['page'] <=> $b['page']);
    return [
        'days' => array_values($series),
        'totals' => ['views' => array_sum(array_column($series, 'views')), 'clicks' => array_sum(array_column($series, 'clicks'))],
        'pages' => $pages,
        'links' => array_map(fn($r) => ['url' => $r['key'], 'clicks' => (int) $r['n']], $top('click', 100)),
    ];
}
