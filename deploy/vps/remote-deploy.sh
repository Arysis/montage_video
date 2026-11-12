#!/usr/bin/env bash
# Déploiement sur le VPS, lancé par .github/workflows/deploy.yml via SSH.
# Lit deploy.env (posé à côté par le workflow, supprimé aussitôt) :
#   IMAGE, DOMAIN, WEB_PORT, ACME_EMAIL, REGISTRY_USER, REGISTRY_TOKEN, APP_ENV_B64
# Idempotent : peut être relancé autant de fois que nécessaire.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/deploy.env"
rm -f "$HERE/deploy.env"

APP_DIR=/opt/montage-video
WEB_PORT="${WEB_PORT:-3100}"
SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo -n"; fi

log() { echo "::group::$*"; }
end() { echo "::endgroup::"; }
fail() { echo "::error::$*"; exit 1; }
summary() { echo "SUMMARY: $*"; }

# ---------------------------------------------------------------- Docker
log "Docker"
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker absent : installation."
  curl -fsSL https://get.docker.com | $SUDO sh
fi
if ! $SUDO docker compose version >/dev/null 2>&1; then
  $SUDO apt-get update -y && $SUDO apt-get install -y docker-compose-plugin
fi
$SUDO docker version --format 'Docker {{.Server.Version}}'
end

# ---------------------------------------------------------------- Fichiers
log "Fichiers de l'app dans $APP_DIR"
$SUDO mkdir -p "$APP_DIR"
$SUDO cp "$HERE/compose.yml" "$APP_DIR/compose.yml"

# Secrets générés une seule fois sur le serveur, puis conservés.
if ! $SUDO test -f "$APP_DIR/.env"; then
  echo "Création des secrets du serveur (.env)."
  printf 'POSTGRES_PASSWORD=%s\nAPP_SECRET=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" \
    | $SUDO tee "$APP_DIR/.env" >/dev/null
  $SUDO chmod 600 "$APP_DIR/.env"
fi
# Valeurs mises à jour à chaque déploiement (gardées en tête de .env pour l'interpolation de compose).
$SUDO sed -i '/^\(IMAGE\|DOMAIN\|WEB_PORT\)=/d' "$APP_DIR/.env"
printf 'IMAGE=%s\nDOMAIN=%s\nWEB_PORT=%s\n' "$IMAGE" "$DOMAIN" "$WEB_PORT" | $SUDO tee -a "$APP_DIR/.env" >/dev/null

# Réglages par défaut : l'app tourne avec les services simulés tant que les vraies clés
# ne sont pas fournies dans le secret GitHub APP_ENV (qui remplace ces valeurs).
# La transcription (sous-titres) est réelle dès le départ : whisper.cpp tourne dans l'image, sans clé.
$SUDO tee "$APP_DIR/app.base.env" >/dev/null <<EOF
NODE_ENV=production
APP_URL=https://$DOMAIN
STORAGE_DRIVER=local
AI_PROVIDER=mock
STT_PROVIDER=whisper
PUBLISH_PROVIDER=mock
EMAIL_PROVIDER=log
ALLOW_MOCK_IN_PRODUCTION=1
RENDER_CONCURRENCY=1
EOF
if [ -n "${APP_ENV_B64:-}" ]; then
  echo "$APP_ENV_B64" | base64 -d | $SUDO tee "$APP_DIR/app.env" >/dev/null
else
  $SUDO test -f "$APP_DIR/app.env" || $SUDO touch "$APP_DIR/app.env"
fi
$SUDO chmod 600 "$APP_DIR/app.env"
end

# ---------------------------------------------------------------- Reverse proxy
# Ce qui écoute déjà sur 80/443 (par exemple pour microdash) est réutilisé, jamais remplacé.
log "Reverse proxy"
listeners="$($SUDO ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null || true)"
if [ -n "$listeners" ]; then echo "$listeners"; else echo "Rien n'écoute sur 80/443."; fi
docker_proxy="$($SUDO docker ps --format '{{.Names}} ({{.Image}}) {{.Ports}}' | grep -E ':(80|443)->' || true)"
[ -n "$docker_proxy" ] && echo "Conteneur sur 80/443 : $docker_proxy"

active() { systemctl is-active --quiet "$1" 2>/dev/null; }
PROXY=none
if active nginx; then PROXY=nginx
elif active caddy; then PROXY=caddy
elif active apache2; then PROXY=apache
elif [ -n "$docker_proxy" ]; then PROXY=docker
elif [ -n "$listeners" ]; then PROXY=unknown
fi
echo "Reverse proxy détecté : $PROXY"
end


# Configuré après le lancement de l'app : un souci de proxy ou de certificat ne l'empêche pas de tourner.
configure_proxy() {
server_ip="$(curl -fsS -4 --max-time 5 https://api.ipify.org || hostname -I | awk '{print $1}')"
dns_ip="$(getent ahostsv4 "$DOMAIN" | awk 'NR==1{print $1}' || true)"
DNS_OK=0
if [ "$dns_ip" = "$server_ip" ]; then DNS_OK=1; else
  echo "::warning::$DOMAIN pointe vers '${dns_ip:-rien}' au lieu de $server_ip : ajoute l'enregistrement DNS A. Le certificat HTTPS sera créé au prochain déploiement."
fi

ensure_certbot() {
  local plugin="$1"
  $SUDO certbot plugins 2>/dev/null | grep -q "^\* $plugin" && return
  $SUDO apt-get update -y && $SUDO apt-get install -y certbot "python3-certbot-$plugin"
}
certbot_args() {
  if [ -n "${ACME_EMAIL:-}" ]; then echo "-m $ACME_EMAIL"; else echo "--register-unsafely-without-email"; fi
}

case "$PROXY" in
  nginx)
    log "Configuration nginx pour $DOMAIN"
    if [ -d /etc/nginx/sites-available ]; then
      conf="/etc/nginx/sites-available/$DOMAIN"; link="/etc/nginx/sites-enabled/$DOMAIN"
    else
      conf="/etc/nginx/conf.d/$DOMAIN.conf"; link=""
    fi
    # Écrit une seule fois : certbot y ajoute ensuite le bloc HTTPS.
    if ! $SUDO test -f "$conf"; then
      $SUDO tee "$conf" >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 600m;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;
    proxy_request_buffering off;

    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
      if [ -n "$link" ]; then $SUDO ln -sf "$conf" "$link"; fi
    fi
    if ! $SUDO nginx -t; then
      # Ne jamais laisser une config cassée : les autres sites (microdash) ne pourraient plus être rechargés.
      $SUDO rm -f "$conf" ${link:+"$link"}
      fail "Config nginx refusée pour $DOMAIN : retirée, rien n'a changé pour les autres sites."
    fi
    $SUDO systemctl reload nginx
    if [ "$DNS_OK" = 1 ] && ! $SUDO test -d "/etc/letsencrypt/live/$DOMAIN"; then
      ensure_certbot nginx
      # shellcheck disable=SC2046
      $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect $(certbot_args)
    fi
    end
    ;;
  caddy)
    log "Configuration Caddy pour $DOMAIN"
    if ! $SUDO grep -q "^$DOMAIN" /etc/caddy/Caddyfile; then
      printf '\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$DOMAIN" "$WEB_PORT" | $SUDO tee -a /etc/caddy/Caddyfile >/dev/null
    fi
    $SUDO caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
    $SUDO systemctl reload caddy
    end
    ;;
  apache)
    log "Configuration Apache pour $DOMAIN"
    conf="/etc/apache2/sites-available/$DOMAIN.conf"
    if ! $SUDO test -f "$conf"; then
      $SUDO a2enmod proxy proxy_http proxy_wstunnel headers rewrite >/dev/null
      $SUDO tee "$conf" >/dev/null <<EOF
<VirtualHost *:80>
    ServerName $DOMAIN
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:$WEB_PORT/
    ProxyPassReverse / http://127.0.0.1:$WEB_PORT/
    RequestHeader set X-Forwarded-Proto expr=%{REQUEST_SCHEME}
    LimitRequestBody 0
</VirtualHost>
EOF
      $SUDO a2ensite "$DOMAIN" >/dev/null
    fi
    $SUDO apachectl configtest
    $SUDO systemctl reload apache2
    if [ "$DNS_OK" = 1 ] && ! $SUDO test -d "/etc/letsencrypt/live/$DOMAIN"; then
      ensure_certbot apache
      # shellcheck disable=SC2046
      $SUDO certbot --apache -d "$DOMAIN" --non-interactive --agree-tos --redirect $(certbot_args)
    fi
    end
    ;;
  none)
    echo "Aucun reverse proxy : Caddy est lancé dans Docker (HTTPS automatique)."
    ;;
  docker|unknown)
    : # traité après le lancement de l'app, pour qu'elle tourne quand même
    ;;
esac
}

# ---------------------------------------------------------------- Lancement
log "Lancement de $IMAGE"
cd "$APP_DIR"
if $SUDO ss -ltnH "sport = :$WEB_PORT" | grep -q . && [ -z "$($SUDO docker compose ps -q web 2>/dev/null)" ]; then
  fail "Le port $WEB_PORT est déjà pris par une autre app du VPS : choisis-en un autre (WEB_PORT)."
fi
echo "$REGISTRY_TOKEN" | $SUDO docker login ghcr.io -u "$REGISTRY_USER" --password-stdin >/dev/null
profile=()
[ "$PROXY" = none ] && profile=(--profile caddy)
$SUDO docker compose "${profile[@]}" pull --quiet
$SUDO docker logout ghcr.io >/dev/null
$SUDO docker compose "${profile[@]}" up -d --remove-orphans
$SUDO docker image prune -f >/dev/null
end

log "Vérification de l'app"
ok=0
for _ in $(seq 1 45); do
  if curl -fsS --max-time 3 "http://127.0.0.1:$WEB_PORT/api/health" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
$SUDO docker compose ps
if [ "$ok" != 1 ]; then
  logs="$($SUDO docker compose logs --tail 80 web worker 2>&1 || true)"
  echo "$logs"
  missing="$(echo "$logs" | grep -o 'Variables manquantes en production : .*' | tail -1 || true)"
  if [ -n "$missing" ]; then
    fail "$missing. Ajoute ces clés dans le secret GitHub APP_ENV, ou retire la ligne *_PROVIDER du service correspondant pour le garder simulé."
  fi
  fail "L'app ne répond pas sur http://127.0.0.1:$WEB_PORT/api/health"
fi
echo "L'app répond."
end

configure_proxy

if [ "$PROXY" = docker ] || [ "$PROXY" = unknown ]; then
  fail "Les ports 80/443 sont tenus par un proxy que ce script ne sait pas configurer : ${docker_proxy:-$listeners}. L'app tourne sur 127.0.0.1:$WEB_PORT ; il faut ajouter $DOMAIN dans ce proxy."
fi
summary "Proxy : $PROXY. App en ligne sur https://$DOMAIN"
