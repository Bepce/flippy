#!/bin/sh
# Backs up each flippy's data (database + catalogues) into ./backups, keeping 14 days.
# Run it from this folder, e.g. nightly with cron:
#   15 3 * * *  cd /opt/flippy/deploy && sh backup.sh >> backups/backup.log 2>&1
set -e
cd "$(dirname "$0")"
mkdir -p backups
STAMP=$(date +%Y-%m-%d)
for SERVICE in $(docker compose config --services | grep -v '^caddy$'); do
  # a consistent copy of the database while the site keeps running
  docker compose exec -T "$SERVICE" php -r '$d = new SQLite3("/data/flippy.sqlite"); @unlink("/data/backup.sqlite"); $d->exec("VACUUM INTO \"/data/backup.sqlite\"");'
  docker compose exec -T "$SERVICE" tar -czf - -C /data --exclude=./flippy.sqlite --exclude=./flippy.sqlite-wal \
    --exclude=./flippy.sqlite-shm --exclude=./sessions --exclude=./tmp . > "backups/$SERVICE-$STAMP.tar.gz"
  docker compose exec -T "$SERVICE" rm -f /data/backup.sqlite
  echo "$(date) $SERVICE backed up: backups/$SERVICE-$STAMP.tar.gz"
done
find backups -name '*.tar.gz' -mtime +14 -delete
