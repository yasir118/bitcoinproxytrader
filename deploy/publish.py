"""Daily publish:  collect fresh data  ->  rebuild the public website  ->  upload it to Netlify.

    python deploy\publish.py              # everything
    python deploy\publish.py --no-collect # just rebuild + upload (data already fresh)
    python deploy\publish.py --no-upload  # rebuild only (then drag the `site` folder to Netlify yourself)

Upload needs two values in collector/config.local.json (create them in Netlify, they never leave this PC):
    "netlify_token":   personal access token  (Netlify -> User settings -> Applications -> Personal access tokens)
    "netlify_site_id": your site's ID         (Netlify -> Site configuration -> Site ID)
    "site_url":        "https://yourdomain.com"   (used for the sitemap and canonical links)
Written against Netlify's documented zip-deploy API; not exercised here without a token - check the first run's output.
"""
import argparse
import io
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SITE = os.path.join(ROOT, "site")


def run(*args):
    print("\n>>", " ".join(args))
    r = subprocess.run([sys.executable, "-I", *args], cwd=ROOT)
    if r.returncode != 0:
        sys.exit(f"step failed: {args[0]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-collect", action="store_true")
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--include-ideas", action="store_true")
    a = ap.parse_args()
    cfg = {}
    cp = os.path.join(ROOT, "collector", "config.local.json")
    if os.path.exists(cp):
        cfg = json.load(open(cp, encoding="utf-8"))
    if not a.no_collect:
        run(os.path.join("collector", "run_all.py"))
    run(os.path.join("deploy", "export_static.py"), *(["--include-ideas"] if a.include_ideas else []))
    if a.no_upload:
        print("\nBuilt. Drag the folder  %s  onto https://app.netlify.com/drop  (or upload the contents)." % SITE)
        return
    token, site_id = cfg.get("netlify_token"), cfg.get("netlify_site_id")
    if not (token and site_id):
        print("\nBuilt, but no netlify_token / netlify_site_id in collector/config.local.json, so nothing was uploaded.")
        print("Either drag the folder  %s  onto your Netlify site's 'Deploys' page, or add the two values (see top of this file)." % SITE)
        return
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for base, _, files in os.walk(SITE):
            for f in files:
                full = os.path.join(base, f)
                z.write(full, os.path.relpath(full, SITE).replace("\\", "/"))
    req = urllib.request.Request(f"https://api.netlify.com/api/v1/sites/{site_id}/deploys", data=buf.getvalue(), method="POST",
                                 headers={"Content-Type": "application/zip", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            d = json.loads(r.read())
        print(f"\nUploaded. Deploy state: {d.get('state')}  ->  {d.get('ssl_url') or d.get('url')}")
    except urllib.error.HTTPError as e:
        sys.exit(f"Netlify rejected the upload: HTTP {e.code} {e.read()[:300]!r}")


if __name__ == "__main__":
    main()
