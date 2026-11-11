#!/bin/sh
# Builds flippy-server-VERSION.zip: everything to upload to a PHP host.
#   sh tools/package-server.sh   ->   build/flippy-server-0.3.0.zip
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
OUT=build/flippy-server
rm -rf build && mkdir -p "$OUT"
cp -R server/. "$OUT/"
rm -rf "$OUT/data" "$OUT/config.php"
cp -R builder "$OUT/builder"
cp -R dist "$OUT/dist"
cp LICENSE "$OUT/LICENSE.txt"
cat > "$OUT/README.txt" <<EOF
flippy server $VERSION  -  https://github.com/Bepce/flippy

1. Upload this folder to your web host, e.g. as /catalogues/ or a subdomain.
   Needs PHP 8.1+ with the pdo_sqlite and zip extensions (most hosts have them).
2. Open it in your browser (https://your-site/catalogues/) and create the first account.
3. Optional: copy config.sample.php to config.php to change settings. Keeping the
   data folder outside the web root is safest (data_dir).

On Apache the included .htaccess does everything. On nginx, see the README on GitHub.
EOF
(cd build && zip -qr "flippy-server-$VERSION.zip" flippy-server)
echo "build/flippy-server-$VERSION.zip"
