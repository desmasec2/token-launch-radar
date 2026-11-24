// Token launch radar: the value model, the farm-plan writer and the board checks.
//
// Everything here is derived from the sealed snapshot's own figures. The model never
// names a protocol: a category's implied multiple is the median market-cap/TVL of the
// snapshot's tokenised protocols in that category, shrunk toward the global median
// when the category's sample is thin, and each pre-token protocol's implied value is
// its TVL times that multiple, adjusted for its seven-day TVL momentum, for how long
// DefiLlama has tracked it without a token, and for how many chains it runs on.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_year: number | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  base_multiple: number;
  momentum_pct: number;
  maturity_pct: number;
  breadth_pct: number;
  watchlist: boolean;
  farm_steps: string[];
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  protocol_count: number;
  pretoken_count: number;
  screened_count: number;
  watchlist_count: number;
  board_size: number;
  total_implied_usd: number;
  global_multiple: number;
  category_multiples: { category: string; multiple: number; samples: number }[];
  rows: RadarRow[];
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Whole days between two UTC dates given as YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

// ---- the value model -------------------------------------------------------

interface Multiples {
  global: number;
  byCategory: Map<string, { multiple: number; samples: number }>;
}

/** Market-cap/TVL multiples of the snapshot's tokenised protocols, per category. */
function categoryMultiples(snapshot: Snapshot): Multiples {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    // Cap the evidence at 5x: a token trading above five times the value its
    // protocol secures is pricing something other than the book, and a single
    // such comparable must not blow up a whole category's multiple.
    const ratio = Math.min(p.mcap_usd / p.tvl_usd, 5);
    ratios.push(ratio);
    if (p.category !== null) {
      const list = perCategory.get(p.category) ?? [];
      list.push(ratio);
      perCategory.set(p.category, list);
    }
  }
  const global = ratios.length > 0 ? median(ratios) : 0.2;
  const byCategory = new Map<string, { multiple: number; samples: number }>();
  for (const [category, list] of perCategory) {
    // Shrink a thin category sample toward the global median: with 6 phantom
    // samples at the global median, a category needs real evidence to move away.
    // The result is held inside 0.01–3: no launch is worth 100x its book.
    const shrunk = (list.length * median(list) + 6 * global) / (list.length + 6);
    byCategory.set(category, { multiple: clamp(shrunk, 0.01, 3), samples: list.length });
  }
  return { global, byCategory };
}

interface Scored {
  protocol: Protocol;
  implied: number;
  baseMultiple: number;
  momentumPct: number;
  maturityPct: number;
  breadthPct: number;
  ageDays: number | null;
}

function scoreProtocol(p: Protocol, multiples: Multiples, asOf: string): Scored {
  const base = p.category !== null && multiples.byCategory.has(p.category)
    ? multiples.byCategory.get(p.category)!.multiple
    : multiples.global;
  const change = clamp(p.change_7d ?? 0, -40, 40);
  const momentumPct = change * 0.6;
  let ageDays: number | null = null;
  let maturityPct = 0;
  if (p.listed_at !== null) {
    ageDays = Math.max(0, daysBetween(p.listed_at, asOf));
    const years = ageDays / 365.25;
    maturityPct = 6 * Math.min(Math.log2(1 + years), 3);
  }
  const breadthPct = 2 * Math.min(Math.max(p.chains.length - 1, 0), 4);
  const implied = Math.max(
    1,
    Math.round(p.tvl_usd * base * (1 + momentumPct / 100) * (1 + maturityPct / 100) * (1 + breadthPct / 100)),
  );
  return { protocol: p, implied, baseMultiple: base, momentumPct, maturityPct, breadthPct, ageDays };
}

// ---- farm plans ------------------------------------------------------------

/** A rough per-transaction cost line for the chain a plan runs on. */
function chainCost(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('ethereum')) return 'budget $4–18 of ETH per transaction for mainnet gas';
  if (c.includes('solana')) return 'fees stay under a cent per transaction';
  if (c.includes('bsc') || c.includes('bnb')) return 'gas runs about $0.05–0.30 per transaction';
  if (c.includes('bitcoin')) return 'network fees run $1–5 per transaction';
  if (c.includes('tron')) return 'fees run under $1 per transaction';
  return 'gas runs a few cents to about $0.50 per transaction on this chain';
}

function hashCode(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

type Plan = (p: Protocol, chain: string, cost: string) => string[];

const planLending: Plan = (p, chain, cost) => [
  `Supply a core asset (ETH or a major stablecoin) as collateral on ${p.name} on ${chain}; ${cost}, and a meaningful position starts around $200–1,000.`,
  `Borrow 20–30% against the collateral and repay within the same week, keeping the health factor above 1.6 so the position survives volatility.`,
  `Repeat the supply-and-borrow cycle weekly for at least six weeks; points programmes reward steady weeks, not one large burst of activity.`,
  `Hold part of the position through month-end snapshots and vote in any governance or risk-parameter polls the protocol opens to suppliers.`,
  `Track the position about 20 minutes a week: top up collateral after sharp market drops and keep records of every supply, borrow and repayment.`,
];

const planDex: Plan = (p, chain, cost) => [
  `Swap through ${p.name} on ${chain} two or three times a week in real size ($50–250 a trade); ${cost}, and consistency across weeks counts more than volume spikes.`,
  `Provide liquidity to a core pair (a major stablecoin pair if offered) with $200–1,000 and keep the position in range for at least a month.`,
  `Claim any trading or liquidity rewards weekly and restake or hold them in the same wallet instead of selling into the market.`,
  `If the exchange runs gauge or fee votes, take part with the LP position; voters are the users a launch usually recognises first.`,
  `Keep one wallet as the ${p.name} wallet: route swaps, liquidity and votes through it so the whole history sits in a single address.`,
];

const planYield: Plan = (p, chain, cost) => [
  `Deposit a major stablecoin or ETH into a flagship ${p.name} vault on ${chain} with $200–1,000; ${cost} for the deposit and each rebalance.`,
  `Stay deposited for at least eight consecutive weeks; vault share balances at weekly snapshots are the usual basis for launch allocations.`,
  `Move a small part of the position between two vaults once a month so the wallet shows active management, not a single forgotten deposit.`,
  `Claim rewards as they accrue and restake them into the same vault to compound the recorded balance.`,
  `Withdraw and redeposit a small amount once per quarter so the wallet history shows the full product cycle, then leave the core position untouched.`,
];

const planStaking: Plan = (p, chain, cost) => [
  `Stake a modest amount of the underlying asset through ${p.name} on ${chain} — $100–500 is enough to be a real user; ${cost}.`,
  `Hold the liquid receipt token in the same wallet for at least two full months; holding duration is the metric staking launches reward most.`,
  `Put the receipt token to work in one partner money market or liquidity pool so the wallet shows composable use, not idle holding alone.`,
  `Restake or top up a small amount monthly to keep the position growing, and avoid unstaking everything before any announced snapshot windows.`,
  `Follow the protocol's governance or operator votes and take part where stakers are eligible; keep the wallet's staking history in one address.`,
];

const planBridge: Plan = (p, chain, cost) => [
  `Bridge $100–500 of a major asset to a destination chain through ${p.name}, then bridge a smaller amount back the following week; ${cost} per hop.`,
  `Use a different route or destination chain each month so the wallet history covers the bridge's real network, not one repeated path.`,
  `Keep a balance on the destination chain for at least a few weeks and make one local transaction there before bridging back.`,
  `Repeat monthly for a quarter; bridge launches historically weight distinct months and distinct routes over raw bridged volume.`,
  `Save every transaction hash: if the protocol opens a retroactive claim checker, a tidy record makes verifying eligibility painless.`,
];

const planPerps: Plan = (p, chain, cost) => [
  `Open small, hedged perpetual positions on ${p.name} on ${chain} two or three times a week ($25–100 margin); ${cost} per order.`,
  `Keep total exposure small and hedged — the goal is a long record of genuine trading weeks, not profit on any single position.`,
  `Trade at least two different markets the venue lists so the history reads as a real user of the whole product.`,
  `Deposit and withdraw once a month so the wallet shows the full cycle, and keep a base balance parked between sessions.`,
  `Take part in any trading competitions or fee-tier programmes with the same wallet; venues usually merge those records at launch.`,
];

const planRwa: Plan = (p, chain, cost) => [
  `Complete any onboarding or eligibility checks ${p.name} requires first; for real-world-asset products this step gates everything else.`,
  `Subscribe a small amount ($250–1,000) to a flagship ${p.name} product on ${chain} and hold it through one full distribution or interest cycle; ${cost}.`,
  `Reinvest at least one distribution instead of withdrawing it, so the record shows a holder rather than a passer-by.`,
  `Keep identity, tax and subscription documents in order; RWA launches cannot credit wallets whose paperwork lapsed mid-cycle.`,
  `Review the position monthly — about 15 minutes — and add a small top-up once a quarter to keep the account visibly active.`,
];

const planCurator: Plan = (p, chain, cost) => [
  `Deposit a major stablecoin or ETH into a flagship ${p.name} vault on ${chain} with $250–1,000; ${cost} for the deposit and each move between vaults.`,
  `Read the curator's strategy notes before depositing: which markets the vault allocates to, what the curator earns, and how often allocations change.`,
  `Stay in the vault for at least eight consecutive weeks; curator launches and points programmes are tallied on weekly balances, not deposit days.`,
  `Split a second, smaller deposit across another ${p.name} vault with a different risk profile, so the wallet shows deliberate allocation, not a single click.`,
  `Check the position about 15 minutes a week: follow reallocation announcements, claim any rewards into the same wallet, and keep records of deposits and withdrawals.`,
];

const planGeneric: Plan = (p, chain, cost) => [
  `Use ${p.name}'s core product on ${chain} with real funds every week for at least six weeks; ${cost}, and $100–500 makes the activity meaningful.`,
  `Spread activity across different weeks and months rather than one burst — launch snapshots consistently reward duration over intensity.`,
  `Try each main feature the product offers at least once, so the wallet history covers the product the way a genuine user would.`,
  `Join the protocol's governance, forum or community votes where holders and users are eligible, using the same wallet throughout.`,
  `Keep the position or account active until any announced snapshot, and keep your own record of dates, amounts and transaction hashes.`,
];

function planFor(p: Protocol): Plan {
  const category = (p.category ?? '').toLowerCase();
  if (category.includes('lend') || category.includes('cdp')) return planLending;
  if (category.includes('dex') || category.includes('deriv') || category.includes('perpetual')) return planPerpsOrDex(category);
  if (category.includes('yield') || category.includes('farm')) return planYield;
  if (category.includes('staking') || category.includes('restak')) return planStaking;
  if (category.includes('bridge')) return planBridge;
  if (category.includes('rwa')) return planRwa;
  if (category.includes('curator') || category.includes('allocator')) return planCurator;
  return planGeneric;
}

function planPerpsOrDex(category: string): Plan {
  return category.includes('dex') && !category.includes('deriv') && !category.includes('perpetual')
    ? planDex
    : planPerps;
}

/** Three to six concrete steps, each naming the protocol, its main chain and real costs. */
export function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const steps = planFor(p)(p, chain, chainCost(chain));
  // The primary action always leads; the supporting steps rotate by a fixed
  // turn per protocol so two neighbouring rows do not read in the same order.
  const turn = Math.abs(hashCode(p.slug)) % (steps.length - 1);
  const rest = steps.slice(1);
  const sized = [steps[0]!, ...rest.slice(turn), ...rest.slice(0, turn)];
  return sized.map((s) => s.trim()).filter((s) => s.length >= 20 && s.length <= 600);
}

// ---- the screen --------------------------------------------------------------

// The board ranks protocols whose token is still to come. A protocol that records
// no token of its own can still be a wrapped, staked or bridged product of a token
// that already trades (WBTC is the type case), an exchange's house product, or an
// older version of a protocol that has since launched. The screen below is the
// watchlist's own rule, applied to the whole snapshot: such protocols are set
// aside, never ranked, because there is no launch left to radar.
const SCREEN_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const SCREEN_EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

export function screenedOut(p: Protocol): boolean {
  if (p.category !== null && SCREEN_CATEGORIES.has(p.category)) return true;
  if (/\s(?:[Vv]\d+|\d+\.\d+)$/.test(p.name)) return true;
  if (/\b(?:wrapped|staked|staking)\b/i.test(p.name)) return true;
  if (SCREEN_EXCHANGES.some((name) => p.name.startsWith(name))) return true;
  return false;
}

// ---- the board -------------------------------------------------------------

export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: Radar } {
  const multiples = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const scored: (Scored & { steps: string[] })[] = [];
  let pretokenCount = 0;
  let screenedCount = 0;
  for (const p of snapshot.protocols) {
    if (p.gecko_id !== null || p.symbol !== null) continue;
    pretokenCount++;
    if (screenedOut(p)) {
      screenedCount++;
      continue;
    }
    if (p.tvl_usd < 5_000_000) continue;
    const s = scoreProtocol(p, multiples, snapshot.as_of);
    scored.push({ ...s, steps: farmSteps(p) });
  }
  scored.sort((a, b) =>
    b.implied - a.implied || b.protocol.tvl_usd - a.protocol.tvl_usd || a.protocol.slug.localeCompare(b.protocol.slug),
  );
  const board: BoardRow[] = [];
  const rows: RadarRow[] = [];
  let totalImplied = 0;
  scored.forEach((s, i) => {
    const rank = i + 1;
    totalImplied += s.implied;
    board.push({ slug: s.protocol.slug, name: s.protocol.name, rank, implied_value_usd: s.implied, farm_steps: s.steps });
    rows.push({
      slug: s.protocol.slug,
      name: s.protocol.name,
      rank,
      category: s.protocol.category,
      chains: s.protocol.chains,
      tvl_usd: s.protocol.tvl_usd,
      change_7d: s.protocol.change_7d,
      listed_year: s.protocol.listed_at === null ? null : Number(s.protocol.listed_at.slice(0, 4)),
      age_days: s.ageDays,
      implied_value_usd: s.implied,
      multiple: s.protocol.tvl_usd > 0 ? s.implied / s.protocol.tvl_usd : 0,
      base_multiple: s.baseMultiple,
      momentum_pct: s.momentumPct,
      maturity_pct: s.maturityPct,
      breadth_pct: s.breadthPct,
      watchlist: watchlist.has(s.protocol.slug),
      farm_steps: s.steps,
    });
  });
  const categoryTable = [...multiples.byCategory.entries()]
    .map(([category, v]) => ({ category, multiple: v.multiple, samples: v.samples }))
    .sort((a, b) => b.samples - a.samples);
  return {
    board,
    radar: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      protocol_count: snapshot.protocols.length,
      pretoken_count: pretokenCount,
      screened_count: screenedCount,
      watchlist_count: snapshot.watchlist.length,
      board_size: board.length,
      total_implied_usd: totalImplied,
      global_multiple: multiples.global,
      category_multiples: categoryTable,
      rows,
    },
  };
}

/** The first gate problem with this board, or null when the gate takes it. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100–4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (!known.has(row.slug)) return `row ${i + 1}: slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `row ${i + 1}: rank is ${row.rank}, expected ${i + 1}`;
    if (!(row.implied_value_usd > 0)) return `row ${row.slug}: implied value is not positive`;
    if (row.implied_value_usd > previous) return `row ${row.slug}: implied value rises as rank ascends`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug}: ${row.farm_steps.length} farm steps, outside 3–12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug}: a farm step is ${len} characters, outside 20–600`;
    }
  }
  if (allSame) return 'every implied value is the same: the board ranks nothing';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data as a script the page loads: window.RADAR = {…}. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
