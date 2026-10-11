#!/usr/bin/env bash
# BitcoinProxyTrader - one-shot server setup for a fresh Ubuntu 24.04 (or 22.04) machine.  Run as root:
#
#     bash /root/server-setup.sh
#
# Expects these files in /root (uploaded from your PC, see deploy/DEPLOY.md):
#     mstr-app.zip            the application
#     mstr_terminal.sql.gz    (optional) your current database, so history carries over
#
# What it does: tests the data sources, installs Apache + PHP + MariaDB + Python, joins the server to your Tailscale
# network, closes every public port except SSH, creates the database, installs the app, and schedules the daily refresh.
# The dashboard ends up reachable ONLY from your own Tailscale devices: http://mstr-server/
set -euo pipefail

APP=/var/www/mstr
HOST=mstr-server
ZIP=/root/mstr-app.zip
DUMP=/root/mstr_terminal.sql.gz
say() { printf '\n\033[1;33m== %s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "Please run as root (sudo -i)"; exit 1; }
[ -f "$ZIP" ] || { echo "Missing $ZIP - upload it first (see deploy/DEPLOY.md, step 3)"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

# ------------------------------------------------------------------------------------------------ 1. can this server reach the data?
say "1/9  Pre-flight: can this server reach the free data sources?"
probe() { # name url [extra curl args]
  local name="$1" url="$2"; shift 2
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -m 25 "$@" "$url" 2>/dev/null || true); [ -n "$code" ] || code=000
  printf '   %-14s HTTP %s\n' "$name" "$code"; echo "$code"
}
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36"
y=$(probe "Yahoo chart" "https://query1.finance.yahoo.com/v8/finance/chart/MSTR?range=5d&interval=1d" -A "$UA" | tail -1)
probe "SEC EDGAR" "https://data.sec.gov/submissions/CIK0001050446.json" -A "BitcoinProxyTrader server-check contact@example.com" >/dev/null
probe "Deribit" "https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd" >/dev/null
if [ "$y" != "200" ]; then
  echo
  echo "   !! Yahoo answered $y from this server (data-centre addresses are sometimes blocked)."
  echo "   The app will still install. If the daily refresh fails later, use deploy/push-to-server.bat to"
  echo "   collect on your PC and push the database here instead (see deploy/DEPLOY.md, 'If Yahoo blocks the server')."
fi

# ------------------------------------------------------------------------------------------------ 2. packages
say "2/9  Installing Apache, PHP, MariaDB, Python"
apt-get update -y
apt-get install -y apache2 libapache2-mod-php php-mysql mariadb-server python3 python3-pymysql unzip curl gzip ufw fail2ban unattended-upgrades openssl cron

# small servers: add swap so the analytics step never runs out of memory
if [ "$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)" -lt 1900 ] && [ "$(swapon --show | wc -l)" -le 1 ]; then
  say "     (small server detected: adding 1 GB swap)"
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ------------------------------------------------------------------------------------------------ 3. tailscale
say "3/9  Tailscale (private network) - you will be asked to approve this server in your browser"
if ! command -v tailscale >/dev/null 2>&1; then curl -fsSL https://tailscale.com/install.sh | sh; fi
hostnamectl set-hostname "$HOST" || true
tailscale up --hostname="$HOST"
echo "   Tailscale address: $(tailscale ip -4 | head -1)"

# ------------------------------------------------------------------------------------------------ 4. firewall
say "4/9  Firewall: closing every public port except SSH; the dashboard is only reachable over Tailscale"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow in on tailscale0
ufw --force enable
if [ -s /root/.ssh/authorized_keys ]; then
  sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
  echo "   SSH password login disabled (key login only)."
else
  echo "   NOTE: no SSH key found for root, so password login stays enabled. Use a long password, or add a key later."
fi
systemctl enable --now fail2ban >/dev/null 2>&1 || true
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

# ------------------------------------------------------------------------------------------------ 5. database
say "5/9  Database"
systemctl enable --now mariadb
DBPASS=""
if [ -f "$APP/collector/config.local.json" ]; then DBPASS=$(python3 -c "import json;print(json.load(open('$APP/collector/config.local.json')).get('db',{}).get('password',''))" 2>/dev/null || true); fi
[ -n "$DBPASS" ] || DBPASS=$(openssl rand -hex 16)
mysql <<SQL
CREATE DATABASE IF NOT EXISTS mstr_terminal CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
CREATE USER IF NOT EXISTS 'mstr'@'localhost' IDENTIFIED BY '${DBPASS}';
CREATE USER IF NOT EXISTS 'mstr'@'127.0.0.1' IDENTIFIED BY '${DBPASS}';
ALTER USER 'mstr'@'localhost' IDENTIFIED BY '${DBPASS}';
ALTER USER 'mstr'@'127.0.0.1' IDENTIFIED BY '${DBPASS}';
GRANT ALL PRIVILEGES ON mstr_terminal.* TO 'mstr'@'localhost';
GRANT ALL PRIVILEGES ON mstr_terminal.* TO 'mstr'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL

# ------------------------------------------------------------------------------------------------ 6. app files
say "6/9  Installing the application into $APP"
mkdir -p "$APP"
unzip -oq "$ZIP" -d "$APP"
mkdir -p "$APP/collector/logs"
cat > "$APP/collector/config.local.json" <<JSON
{
  "db": {"host": "127.0.0.1", "port": 3306, "user": "mstr", "password": "${DBPASS}", "name": "mstr_terminal"},
  "python": "/usr/bin/python3"
}
JSON
chown -R www-data:www-data "$APP"
chmod 640 "$APP/collector/config.local.json"
chmod +x "$APP/collector/run_all.sh" "$APP/deploy/"*.sh 2>/dev/null || true

# ------------------------------------------------------------------------------------------------ 7. data
say "7/9  Loading data"
if [ -f "$DUMP" ]; then
  zcat "$DUMP" | mysql mstr_terminal
  echo "   Imported your existing database (history carried over)."
  sudo -u www-data python3 -I -c "import sys; sys.path.insert(0,'$APP/collector'); import db; db.init_schema(); print('   schema up to date')"
  DOCATCHUP=1
else
  echo "   No database dump found: downloading full history now (about 5-8 minutes)..."
  sudo -u www-data python3 -I "$APP/collector/run_all.py" --full || echo "   (some steps failed - check $APP/collector/logs; the app is still installed)"
  DOCATCHUP=0
fi

# ------------------------------------------------------------------------------------------------ 8. web server
say "8/9  Web server"
a2dissite 000-default >/dev/null 2>&1 || true
cat > /etc/apache2/sites-available/mstr.conf <<'CONF'
<VirtualHost *:80>
    ServerName mstr-server
    DocumentRoot /var/www/mstr
    <Directory /var/www/mstr>
        Options -Indexes +FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>
    # never serve configuration, logs or deployment files
    <DirectoryMatch "^/var/www/mstr/(collector|deploy)(/|$)">
        Require all denied
    </DirectoryMatch>
    ErrorLog ${APACHE_LOG_DIR}/mstr-error.log
    CustomLog ${APACHE_LOG_DIR}/mstr-access.log combined
</VirtualHost>
CONF
a2ensite mstr >/dev/null
systemctl enable apache2 >/dev/null 2>&1 || true
systemctl restart apache2

# ------------------------------------------------------------------------------------------------ 9. daily schedule
say "9/9  Daily refresh (cron)"
cat > /etc/cron.d/mstr <<CRON
# BitcoinProxyTrader: after the US close (21:45 UTC = 5:45 pm New York in summer, 4:45 pm in winter)
45 21 * * * www-data $APP/collector/run_all.sh
# early-morning catch-up for Bitcoin / DVOL and any missed run
15 7 * * * www-data $APP/collector/run_all.sh --only prices,profile,dvol,analytics,signals
CRON
chmod 644 /etc/cron.d/mstr
if [ "${DOCATCHUP:-0}" = 1 ]; then
  echo "   Starting a catch-up refresh in the background (takes ~3-6 minutes)..."
  sudo -u www-data nohup "$APP/collector/run_all.sh" >/dev/null 2>&1 &
fi

TSIP=$(tailscale ip -4 | head -1)
say "DONE"
cat <<EOF

   Open this on your phone or PC (Tailscale ON):

       http://${HOST}/            or   http://${TSIP}/

   Check it:    curl -s http://localhost/api/index.php?r=meta | head -c 300
   Logs:        tail -f ${APP}/collector/logs/scheduled.log
   Run a refresh now:   sudo -u www-data ${APP}/collector/run_all.sh
EOF
