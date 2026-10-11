#!/bin/sh
# BitcoinProxyTrader - run the collection + analytics pipeline (Linux server). Used by cron, see deploy/DEPLOY.md.
cd "$(dirname "$0")" || exit 1
mkdir -p logs
python3 -I run_all.py "$@" >> logs/scheduled.log 2>&1
