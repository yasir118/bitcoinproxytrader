# Go live — automatic, free, no computer needed

Every day a free GitHub job collects fresh data, rebuilds the website and publishes it. Your PC can stay off.
You pick where the website is shown: **Vercel** (free "Hobby" plan) or **GitHub Pages** (free). Both work; Vercel steps are in Part B.

## Part A — put the project on GitHub (once)
1. **Create a free GitHub account** at https://github.com (skip if you have one).
2. **Create an empty repository:** https://github.com/new → name `bitcoinproxytrader` → **Public** → leave everything else unticked → *Create repository*.
   Copy its address, e.g. `https://github.com/YOURNAME/bitcoinproxytrader.git`.
3. **Double-click** `deploy\push-to-github.bat` on your PC, paste the address, press Enter, sign in to GitHub in the browser window if asked.
4. On GitHub open the **Actions** tab → **Daily update** → **Run workflow**. The first run takes ~15–25 minutes (it downloads all history).
   When it is green, a branch called `site` exists in your repository: that branch **is** the finished website.

## Part B — show it with Vercel (free Hobby plan)
1. Go to https://vercel.com → **Sign up with GitHub** → choose the **Hobby** plan.
2. **Add New… → Project → Import** your `bitcoinproxytrader` repository. Framework Preset: **Other**. Leave everything else. Click **Deploy**.
   (This first deploy shows the wrong page. Ignore it.)
3. In the Vercel project: **Settings → Git → Production Branch** → type **`site`** → Save.
4. Back on GitHub: **Actions → Daily update → Run workflow** once more (about 5 minutes). Vercel deploys the `site` branch automatically.
5. Your address is shown in Vercel (like `https://bitcoinproxytrader.vercel.app`). From now on it **updates itself every day** at about 21:45 UTC, after the US close.

Vercel's Hobby plan is for **personal, non-commercial** use. If you add ads, sell something or run it as a business, Vercel requires the paid Pro plan.

## Part B (alternative) — GitHub Pages instead of Vercel
1. Repository → **Settings → Secrets and variables → Actions → Variables → New variable** → name `USE_PAGES`, value `true`.
2. **Settings → Pages → Build and deployment → Source → GitHub Actions**.
3. Run the workflow again. Your address: `https://YOURNAME.github.io/bitcoinproxytrader/`.

## Your own web address (optional, ~$10–15 per year)
Buy a domain, add it in Vercel (**Settings → Domains**) or GitHub (**Settings → Pages**). Then add a repository variable `SITE_URL` with `https://yourdomain.com` (same place as `USE_PAGES`) so the sitemap uses it, and run the workflow once.

## Make Google find it
https://search.google.com/search-console → add your address → submit `…/sitemap.xml` (the sitemap appears once `SITE_URL` is set). New sites take days to weeks to show up.

## If something is wrong
* A red ✗ in the Actions tab: click it, copy the red error lines and send them to me.
* A yellow warning “data is N days old”: Yahoo is blocking GitHub’s servers. The site still publishes with the last good data. Fixes: a paid data source (e.g. Massive.com), or collect on your PC and push the database (ask me).
* To stop: delete the Vercel project / the GitHub repository.

## Good to know
* The repository is public, so the **code** is public. It contains no passwords or personal details (checked).
* The public site is read-only. Notes, saved RSI lines and the refresh button exist only in your local copy.
* The **Strategy ideas** tab is published. To leave it out add `--no-ideas` to the “Build the website” command in `.github/workflows/daily.yml`.
* Prices and option quotes come from Yahoo Finance (terms allow personal use, not redistribution) and publishing specific buy / sell ideas can be a regulated activity in some countries. Check both before promoting the site.
