"""Run the whole collection + analytics pipeline.

    python run_all.py                 # everything, incremental
    python run_all.py --full          # re-download full price history
    python run_all.py --only prices,analytics
    python run_all.py --skip sec,insiders
"""
import argparse
import datetime as dt
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db                                  # noqa: E402
from config import LOG_DIR                 # noqa: E402

STEPS = ["prices", "profile", "dvol", "options", "sec", "insiders", "earnings", "treasury", "watchfill", "analytics", "signals", "strategies"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--skip", default="")
    a = ap.parse_args()
    only = [s for s in a.only.split(",") if s]
    skip = set(s for s in a.skip.split(",") if s)

    conn = db.init_schema()
    status_path = os.path.join(LOG_DIR, "last_run.json")
    os.makedirs(LOG_DIR, exist_ok=True)

    def write_status(state, step=""):
        with open(status_path, "w", encoding="utf-8") as fh:
            json.dump({"state": state, "step": step, "pid": os.getpid(),
                       "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}, fh)

    for step in STEPS:
        if (only and step not in only) or step in skip:
            continue
        write_status("running", step)
        with db.Job(conn, step) as job:
            msg = run_step(step, conn, a.full)
            job.done(msg)
    db.set_meta(conn, "last_refreshed", dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S"))
    write_status("idle")
    db.log("pipeline finished")


def run_step(step, conn, full):
    if step == "prices":
        import fetch_prices
        return fetch_prices.run(conn, full)
    if step == "profile":
        import fetch_profile
        return fetch_profile.run(conn)
    if step == "dvol":
        import fetch_dvol
        return fetch_dvol.run(conn, full)
    if step == "options":
        import fetch_options
        return fetch_options.run(conn)
    if step == "sec":
        import fetch_sec
        return fetch_sec.run(conn)
    if step == "insiders":
        import fetch_insiders
        return fetch_insiders.run(conn)
    if step == "earnings":
        import fetch_earnings
        return fetch_earnings.run(conn)
    if step == "treasury":
        import fetch_treasury
        return fetch_treasury.run(conn)
    if step == "watchfill":
        import massive
        return massive.run(conn)
    if step == "analytics":
        import analytics
        return analytics.run(conn)
    if step == "signals":
        import signals
        return signals.run(conn)
    if step == "strategies":
        import strategies
        return strategies.run(conn)
    raise ValueError(step)


if __name__ == "__main__":
    main()
