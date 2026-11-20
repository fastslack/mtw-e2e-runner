# Driver compatibility suite

Integration tests that check a browser engine works with everything the runner
does: screenshots, visual diffs, inputs, tabs, network capture and screencast.
They run against a **live pool** and a local fixture site, so results don't
depend on the network or third-party pages.

```bash
npm run test:integration -- --pool http://127.0.0.1:9222
```

## What runs

| Layer | File | Checks |
|---|---|---|
| Puppeteer API probe | `api-probe.mjs` | Every Puppeteer call the runner relies on, as named capabilities. A hung call is reported as a failure after 20 s |
| Runner suite | `suite.json` | The real CLI, run twice. Pass 1 creates `assert_visual` goldens; pass 2 must match them with 0% diff |
| Layout guard (optional) | `run.mjs` | A Moli pool started **without** `--layout` must be rejected fast by `connectToPool()`, with a fix hint |

The `expected-failure` test must fail and save an error screenshot; that is part
of the contract, so the CLI exits 1 on a healthy run. `run.mjs` exits 0 only
when every expectation holds.

`WARN` lines in the probe are engine differences the runner already works around
(e.g. Moli doesn't select input text on triple-click). They don't fail the run.

## Options

```
--pool <url>             Pool to test (required)
--driver <name>          Force the driver (CLI --driver); default: auto-detect
--no-layout-pool <url>   Also assert this Moli pool (no --layout) fails fast
--skip-probe             Skip the Puppeteer API probe
--skip-suite             Skip the runner suite
--keep                   Keep the temp work dir (screenshots, reports, diffs)
```

Runs are isolated: temp working dir and temp `HOME`, so nothing is written to
`~/.e2e-runner/dashboard.db`.

## Engines

```bash
# Moli: --layout is required for clicks and screenshots
moli serve --layout --resource --port 9333 &
moli serve --port 9334 &            # only for the layout guard
npm run test:integration -- --pool http://127.0.0.1:9333 --no-layout-pool http://127.0.0.1:9334

# Chrome / Chromium (generic cdp driver)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new \
  --remote-debugging-port=9555 --user-data-dir=/tmp/e2e-compat-chrome about:blank &
npm run test:integration -- --pool http://127.0.0.1:9555

# browserless (Docker pool started with `npx -y @matware/e2e-runner@1.6.0 pool start`)
npm run test:integration -- --pool ws://localhost:3333
```

Any pool URL the runner accepts works: browserless, cdp, lightpanda, obscura,
moli or steel.
