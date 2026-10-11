# Putting BitcoinProxyTrader on a cloud server (private, via Tailscale)

Result: a small always-on server collects the data every day and serves the dashboard at **http://mstr-server/** — reachable only from
your own devices (phone, PC) through Tailscale. No domain, no password page, nothing exposed to the internet except SSH.
Your home PC can be switched off.

Total time ≈ 30 minutes. Cost ≈ $4–6 / month (check the provider's current price).

---

## Step 1 — Create the server (you, in the provider's website)

Pick **one**:

| Provider | Plan to choose | Notes |
|---|---|---|
| **Hetzner Cloud** | cheapest plan with **≥ 2 GB RAM** (e.g. CX22), about €4–5/mo | Best value. May ask for an ID check when you sign up. Location: **Ashburn (US East)**. |
| **DigitalOcean** | Basic droplet, Regular SSD, **$6 (1 GB)** or **$12 (2 GB)** | Easiest sign-up. Region: **New York**. The setup script adds swap on 1 GB machines. |

Settings (same for both):
* **Image / OS:** Ubuntu **24.04 LTS**
* **Authentication:** choose **SSH key** (recommended — see below). A password also works.
* **Name:** `mstr-server` · everything else default. No backups needed (the database can be rebuilt from the files).

**Make an SSH key (once, on your PC, in PowerShell):**

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519 -N '""'
type $env:USERPROFILE\.ssh\id_ed25519.pub
```

Copy the line that starts with `ssh-ed25519 …` and paste it into the provider's “SSH key” box when creating the server.
When the server is ready you will see its **public IP address** (e.g. `203.0.113.7`). Keep it handy.

---

## Step 2 — Build the upload package (on your PC)

XAMPP's MySQL must be running. Double-click **`deploy\make-package.bat`** (or run `python deploy\make-package.py`).
It creates, in `deploy\out\`:
* `mstr-app.zip` — the application (no passwords, logs or caches inside)
* `mstr_terminal.sql.gz` — your current database, so all history moves with you

*(Already done once on Oct 11, 2026. Re-run it any time to take a fresh copy.)*

---

## Step 3 — Upload (PowerShell, from the project folder)

Replace `SERVER_IP` with the address from step 1:

```powershell
cd C:\xampp\htdocs\cc\MSTR
scp deploy\out\mstr-app.zip deploy\out\mstr_terminal.sql.gz deploy\server-setup.sh root@SERVER_IP:/root/
```

The first time it asks “Are you sure you want to continue connecting?” — type `yes`.

---

## Step 4 — Run the setup (about 5–10 minutes)

```powershell
ssh root@SERVER_IP
```

then on the server:

```bash
bash /root/server-setup.sh
```

What you will see:
1. **Pre-flight** — HTTP codes for Yahoo / SEC / Deribit. Yahoo should say `200`. (If not, see “If Yahoo blocks the server”.)
2. Packages install (Apache, PHP, MariaDB, Python).
3. **Tailscale prints a link** like `https://login.tailscale.com/a/xxxxxxxx`. Open it in your PC or phone browser, sign in with the
   **same account** you use for Tailscale on your devices, and approve. The script then continues by itself.
4. The firewall closes everything except SSH, the database and app are installed, and the daily schedule is created.
5. It finishes with the address to open.

---

## Step 5 — Open it on your phone

Tailscale **on** (phone and PC), then:

```
http://mstr-server/
```

(or the `100.x.x.x` address the script printed). The refresh button works from your phone too — requests from your own Tailscale devices are trusted.
The server refreshes **automatically every day at 21:45 UTC** (just after the US close) and again at 07:15 UTC.

Check that the first catch-up refresh finished: open **Research → How it works**; the job list should show every step `ok`.

---

## Day-to-day

| I want to… | Do this |
|---|---|
| refresh now | tap the refresh icon in the dashboard |
| see logs | `ssh root@mstr-server` then `tail -n 50 /var/www/mstr/collector/logs/scheduled.log` |
| update the app after I change code | rebuild with `make-package.bat`, `scp deploy\out\mstr-app.zip root@mstr-server:/root/`, then on the server `unzip -oq /root/mstr-app.zip -d /var/www/mstr && chown -R www-data:www-data /var/www/mstr` (the config file is not overwritten) |
| back up the database | `ssh root@mstr-server "mysqldump mstr_terminal | gzip" > backup.sql.gz` |
| stop paying | delete the server in the provider's website (the PC copy keeps working) |

### Once the server works
You can stop using the PC copy for daily collection (stop XAMPP, or just ignore it). Your PC copy and the server copy do **not** sync automatically:
notes and saved RSI lines you add on one stay on that one.

---

## If Yahoo blocks the server

Some providers' address ranges are throttled by Yahoo. Symptoms: pre-flight shows `429`/`403`, or the daily refresh logs show Yahoo errors.
Fallback that still gives you phone access: keep collecting on your PC and push the finished database to the server.

```powershell
deploy\push-to-server.bat mstr-server
```

(It refreshes on the PC, exports the database, uploads it and imports it on the server. Needs the PC on and the same Tailscale account.)
You can schedule that file in Windows Task Scheduler.

---

## Security notes

* Only **SSH (port 22)** is reachable from the public internet; the dashboard, API and database are not. MariaDB listens on `localhost` only.
* If you gave a key in step 1, **SSH password login is switched off** by the script. fail2ban and automatic security updates are enabled.
* Anyone logged into **your** Tailscale account can open the dashboard and add notes — so protect that account (2-factor).
* The dashboard has no login of its own. If you ever want it on a public web address, add HTTPS and a login first; ask and I'll set it up.
* Nothing here is financial advice; the server only hosts the same read-only research dashboard.
