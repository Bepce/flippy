# flippy server: catalogue library, sign-in, publishing from the builder, click statistics.
#   docker run -d -p 8080:80 -v flippy-data:/data ghcr.io/bepce/flippy-server
# then open http://localhost:8080/ and create the first account.
FROM php:8.3-apache

RUN apt-get update \
 && apt-get install -y --no-install-recommends libzip-dev \
 && docker-php-ext-install zip \
 && apt-get purge -y --auto-remove \
 && rm -rf /var/lib/apt/lists/* \
 && a2enmod rewrite headers \
 && sed -ri 's/AllowOverride None/AllowOverride All/' /etc/apache2/apache2.conf \
 && echo 'ServerTokens Prod' > /etc/apache2/conf-enabled/zz-flippy.conf \
 && echo 'ServerSignature Off' >> /etc/apache2/conf-enabled/zz-flippy.conf \
 && { echo 'upload_max_filesize = 300M'; echo 'post_max_size = 310M'; echo 'max_execution_time = 300'; \
      echo 'memory_limit = 256M'; echo 'expose_php = Off'; } > /usr/local/etc/php/conf.d/flippy.ini

WORKDIR /var/www/html
COPY server/ ./
COPY builder/ ./builder/
COPY dist/ ./dist/

# the database and catalogues live outside the web root, in a volume
ENV FLIPPY_DATA_DIR=/data
RUN mkdir -p /data && chown www-data:www-data /data
VOLUME /data

EXPOSE 80
HEALTHCHECK --interval=1m --timeout=5s CMD php -r 'exit(@file_get_contents("http://localhost/api/me") === false ? 1 : 0);'
