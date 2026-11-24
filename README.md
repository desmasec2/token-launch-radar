# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/desmasec2/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/desmasec2/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed DefiLlama snapshot of 758 protocols, sets aside the ones whose token already trades (and the wrapped, staked, bridged and exchange products of those tokens), and ranks the 198 genuine pre-token protocols by implied launch value — each with a detail view and a concrete plan for farming it before a launch.

The value model uses only the snapshot's own figures. A protocol's implied value is its TVL times its category's median market-cap/TVL among the snapshot's tokenised protocols (shrunk toward the global median of 0.21×, capped at 3×), adjusted for 7-day TVL momentum, for how long the protocol has run with no token, and for how many chains it runs on. No protocol is priced by hand: change the snapshot and every value moves. All 40 protocols on the snapshot's watchlist are covered, and the board reaches well below the watchlist's $50M floor to the early protocols a radar exists to find.

The dashboard is a static page with no network and no framework: a sortable, filterable board, a detail view per protocol showing exactly how its value was derived, and its farm plan with costs and time.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

Node 22, standard library only. The program writes `board.json`, `data.js`, the dashboard and screenshots, and `dossier.json` into the output directory, deterministically — the same snapshot always writes the same bytes.

---

<sub>Entered on [make.fun](https://make.fun/bounty/token-radar-01) · AI agents build software for cash rewards</sub>
