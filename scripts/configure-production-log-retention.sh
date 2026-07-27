#!/usr/bin/env bash
set -euo pipefail

NGINX_LOG_DIR="${NGINX_LOG_DIR:-/www/wwwlogs}"
NGINX_PID_FILE="${NGINX_PID_FILE:-/www/server/nginx/logs/nginx.pid}"
LOGROTATE_CONFIG="${LOGROTATE_CONFIG:-/etc/logrotate.conf}"
LOGROTATE_DIR="${LOGROTATE_DIR:-/etc/logrotate.d}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/faolla-server-config}"
JOURNALD_CONFIG_DIR="${JOURNALD_CONFIG_DIR:-/etc/systemd/journald.conf.d}"
JOURNALD_CONFIG="${JOURNALD_CONFIG:-$JOURNALD_CONFIG_DIR/faolla-retention.conf}"
JOURNAL_SYSTEM_MAX_USE="${JOURNAL_SYSTEM_MAX_USE:-256M}"
JOURNAL_SYSTEM_KEEP_FREE="${JOURNAL_SYSTEM_KEEP_FREE:-8G}"
JOURNAL_RUNTIME_MAX_USE="${JOURNAL_RUNTIME_MAX_USE:-64M}"
JOURNAL_MAX_RETENTION="${JOURNAL_MAX_RETENTION:-14day}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[log-retention] not running as root; skipping system log configuration"
  exit 0
fi

configure_journal_retention() {
  local journal_config
  if ! command -v journalctl >/dev/null 2>&1 \
    || ! command -v systemctl >/dev/null 2>&1; then
    echo "[log-retention] systemd journal tools are unavailable; skipping journal retention"
    return 0
  fi

  mkdir -p "$JOURNALD_CONFIG_DIR"
  journal_config="$(mktemp)"
  cat > "$journal_config" <<EOF
[Journal]
SystemMaxUse=$JOURNAL_SYSTEM_MAX_USE
SystemKeepFree=$JOURNAL_SYSTEM_KEEP_FREE
RuntimeMaxUse=$JOURNAL_RUNTIME_MAX_USE
MaxRetentionSec=$JOURNAL_MAX_RETENTION
Compress=yes
EOF
  install -m 0644 "$journal_config" "$JOURNALD_CONFIG"
  rm -f "$journal_config"

  if ! systemctl kill --kill-who=main --signal=HUP systemd-journald.service; then
    echo "[log-retention] warning: journald did not reload the retention configuration"
  fi
  if ! journalctl \
    --vacuum-size="$JOURNAL_SYSTEM_MAX_USE" \
    --vacuum-time="$JOURNAL_MAX_RETENTION" >/dev/null; then
    echo "[log-retention] warning: journald vacuum did not complete"
  fi
  echo "[log-retention] bounded systemd journal retention is configured"
}

configure_journal_retention

if ! command -v logrotate >/dev/null 2>&1; then
  echo "[log-retention] logrotate is unavailable; skipping"
  exit 0
fi

if [ ! -f "$LOGROTATE_CONFIG" ]; then
  echo "[log-retention] main logrotate configuration is unavailable; skipping"
  exit 0
fi

install_config() {
  local source_path="$1"
  local target_path="$2"
  install -m 0644 "$source_path" "$target_path"
}

mkdir -p "$LOGROTATE_DIR" "$BACKUP_DIR"

if [ -f "$LOGROTATE_CONFIG" ] && [ ! -f "$BACKUP_DIR/logrotate.conf.original" ]; then
  cp -a "$LOGROTATE_CONFIG" "$BACKUP_DIR/logrotate.conf.original"
fi

if [ -f "$LOGROTATE_DIR/btmp" ] && [ ! -f "$BACKUP_DIR/btmp.original" ]; then
  cp -a "$LOGROTATE_DIR/btmp" "$BACKUP_DIR/btmp.original"
fi

nginx_config="$(mktemp)"
btmp_config="$(mktemp)"
main_config="$(mktemp)"
trap 'rm -f "$nginx_config" "$btmp_config" "$main_config"' EXIT

cat > "$nginx_config" <<EOF
$NGINX_LOG_DIR/*.log {
    daily
    maxsize 50M
    rotate 14
    missingok
    notifempty
    compress
    dateext
    su root root
    sharedscripts
    postrotate
        if [ -s "$NGINX_PID_FILE" ]; then
            kill -USR1 "\$(cat "$NGINX_PID_FILE")" 2>/dev/null || true
        fi
    endscript
}
EOF

cat > "$btmp_config" <<'EOF'
/var/log/btmp {
    weekly
    maxsize 25M
    rotate 4
    missingok
    notifempty
    compress
    dateext
    create 0600 root utmp
}
EOF

logrotate -d "$nginx_config" >/dev/null 2>&1
logrotate -d "$btmp_config" >/dev/null 2>&1

cp -a "$LOGROTATE_CONFIG" "$main_config"
if ! grep -Eq '^[[:space:]]*compress[[:space:]]*$' "$main_config"; then
  if grep -Eq '^[[:space:]]*#[[:space:]]*compress[[:space:]]*$' "$main_config"; then
    sed -i 's/^[[:space:]]*#[[:space:]]*compress[[:space:]]*$/compress/' "$main_config"
  else
    sed -i '/^[[:space:]]*include[[:space:]]/i compress' "$main_config"
  fi
fi
logrotate -d "$main_config" >/dev/null 2>&1

if [ -d "$NGINX_LOG_DIR" ] && [ -s "$NGINX_PID_FILE" ]; then
  install_config "$nginx_config" "$LOGROTATE_DIR/faolla-nginx"
else
  echo "[log-retention] nginx log directory or pid file is unavailable; skipping nginx rotation"
fi
install_config "$btmp_config" "$LOGROTATE_DIR/btmp"
install_config "$main_config" "$LOGROTATE_CONFIG"

logrotate -d "$LOGROTATE_CONFIG" >/dev/null 2>&1
echo "[log-retention] compression and bounded log rotation are configured"
