import type { DigitalBook, MarketCoin } from './extensions.ts';
import { MARKET_PRESETS, isRetiredMarketCoin, marketWatchlist, normalizeMarketCoin, validateMarketWatchlist } from './market-watchlist.ts';
import { digitalPositions, units, valuation } from './digital.ts';

export const MAIN_COINS = MARKET_PRESETS.slice(0, 3);
export const SUPPORTED_COINS = MARKET_PRESETS;
export type MarketQuote = { priceCNY: string; priceUSD: string; source: string; at: string; change24h: number | null; priceId?: string; tradeAt?: string; priceUSDT?: string };
export type MarketPrices = { quotes: Record<string, MarketQuote>; stale: boolean; fetchedAt: string; errors?: Record<string, string> };
export const MAX_PRICE_AGE = 15 * 60 * 1000;
const TTL = 60 * 1000;
export const priceURL = (coins: readonly MarketCoin[]) => 'https://api.coingecko.com/api/v3/simple/price?ids=' + coins.map(c => encodeURIComponent(c.priceId)).join(',') + '&vs_currencies=cny,usd&include_last_updated_at=true&include_24hr_change=true&precision=8';
export const PRICE_URL = priceURL(MAIN_COINS);
export const COINBASE_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';

export function usableQuote(quote: { at: string; tradeAt?: string } | undefined, now = Date.now()) {
    if (!quote) return false;
    if (quote.tradeAt && (!Number.isFinite(Date.parse(quote.tradeAt)) || now - Date.parse(quote.tradeAt) > 86400000 || Date.parse(quote.tradeAt) > now + 60000)) return false;
    const at = Date.parse(quote.at);
    return Number.isFinite(at) && at <= now + 60000 && now - at <= MAX_PRICE_AGE;
}

export function parseMarketPrices(data: unknown, now = Date.now(), source = 'CoinGecko', coins: readonly MarketCoin[] = MAIN_COINS): MarketPrices {
    if (!data || typeof data !== 'object') throw Error('行情数据格式无效');
    const quotes: Record<string, MarketQuote> = {};
    for (const coin of coins) {
        const row = (data as Record<string, Record<string, unknown>>)[coin.priceId];
        if (!row || typeof row.cny !== 'number' || !Number.isFinite(row.cny) || row.cny <= 0 || row.cny > 1e12 ||
            typeof row.usd !== 'number' || !Number.isFinite(row.usd) || row.usd <= 0 || row.usd > 1e12 ||
            typeof row.last_updated_at !== 'number' || !Number.isFinite(row.last_updated_at)) continue;
        const milliseconds = row.last_updated_at * 1000;
        if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) continue;
        const quote = { priceCNY: row.cny.toFixed(8).replace(/\.?0+$/, ''), priceUSD: row.usd.toFixed(8).replace(/\.?0+$/, ''), source, priceId: coin.priceId, at: new Date(milliseconds).toISOString(),
            change24h: typeof row.cny_24h_change === 'number' && Number.isFinite(row.cny_24h_change) ? row.cny_24h_change : null };
        if (Number(quote.priceCNY) > 0 && Number(quote.priceUSD) > 0 && usableQuote(quote, now)) quotes[coin.symbol] = quote;
    }
    if (!Object.keys(quotes).length) throw Error('行情数据缺失或已过期');
    return { quotes, stale: Object.values(quotes).some(q => now - Date.parse(q.at) > 5 * TTL), fetchedAt: new Date(now).toISOString() };
}

/** Only the user's chosen coin IDs are sent to fixed public market endpoints. */
export function createMarketPriceService(fetcher: typeof fetch = (input, init) => fetch(input, init), now = Date.now, coalesce = true) {
    type Cache = { cached: MarketPrices | null; retryAt: number; pending: Promise<MarketPrices> | null };
    const selections = new Map<string, Cache>();
    const fetchOptions = () => ({ headers: { Accept: 'application/json', 'User-Agent': 'Qingji-Ledger/1.0' }, signal: AbortSignal.timeout(6000) });
    async function fetchMarket(selected: readonly MarketCoin[]): Promise<MarketPrices> {
        const coins = selected;
        const quotes: Record<string, MarketQuote> = {};
        const collect = (data: unknown, source: string, requested: readonly MarketCoin[]) => {
            try { Object.assign(quotes, parseMarketPrices(data, now(), source, requested).quotes); } catch { /* Try other sources for missing coins. */ }
        };
        try {
            const response = await fetcher(priceURL(coins), fetchOptions());
            if (response.ok) collect(await response.json(), 'CoinGecko', coins);
        } catch { /* Public endpoints may be blocked or rate-limited. */ }
        // Ticker fallbacks are used only for verified presets, never for a custom coin with a similar name.
        let missing = coins.filter(c => !quotes[c.symbol] && MARKET_PRESETS.some(p => p.symbol === c.symbol && p.priceId === c.priceId));
        if (missing.length) {
            try {
                const response = await fetcher(COINBASE_URL, fetchOptions());
                if (!response.ok) throw Error('Coinbase unavailable');
                const body = await response.json() as { data?: { currency?: string; rates?: Record<string, string> } };
                const rates = body.data?.rates || {}, cny = Number(rates.CNY);
                if (body.data?.currency !== 'USD' || !Number.isFinite(cny) || cny <= 0) throw Error('Coinbase 汇率无效');
                const data = Object.fromEntries(missing.map(coin => {
                    const perDollar = Number(rates[coin.symbol]), valid = Number.isFinite(perDollar) && perDollar > 0;
                    return [coin.priceId, { cny: valid ? cny / perDollar : null, usd: valid ? 1 / perDollar : null, last_updated_at: now() / 1000 }];
                }));
                collect(data, 'Coinbase', missing);
            } catch { /* Fall back independently for each missing preset. */ }
        }
        missing = missing.filter(c => !quotes[c.symbol]);
        await Promise.allSettled(missing.map(async coin => {
            const preset = MARKET_PRESETS.find(p => p.symbol === coin.symbol)!;
            const response = await fetcher(`https://api.coinpaprika.com/v1/tickers/${preset.fallbackId}?quotes=CNY,USD`, fetchOptions());
            if (!response.ok) return;
            const body = await response.json() as { symbol?: string; last_updated?: string; quotes?: { CNY?: { price?: number; percent_change_24h?: number }; USD?: { price?: number } } };
            if (body.symbol !== coin.symbol) return;
            collect({ [coin.priceId]: { cny: body.quotes?.CNY?.price, usd: body.quotes?.USD?.price, cny_24h_change: body.quotes?.CNY?.percent_change_24h, last_updated_at: Date.parse(body.last_updated || '') / 1000 } }, 'CoinPaprika', [coin]);
        }));
        const wanted = new Set(selected.map(c => c.symbol));
        const visible = Object.fromEntries(Object.entries(quotes).filter(([symbol]) => wanted.has(symbol)));
        const errors = Object.fromEntries(selected.filter(c => !visible[c.symbol]).map(c => [c.symbol, '行情暂不可用，请检查币种 ID、稍后刷新或填写手动参考单价。']));
        return { quotes: visible, errors, stale: Object.values(visible).some(q => now() - Date.parse(q.at) > 5 * TTL), fetchedAt: new Date(now()).toISOString() };
    }
    return async function getPrices(selection: readonly MarketCoin[] = []): Promise<MarketPrices> {
        validateMarketWatchlist(selection);
        const selected = selection.filter(coin => !isRetiredMarketCoin(coin)).map(normalizeMarketCoin);
        if (!selected.length) return { quotes: {}, stale: false, fetchedAt: new Date(now()).toISOString() };
        const key = JSON.stringify(selected.map(c => [c.symbol, c.priceId]).sort((a, b) => a[0].localeCompare(b[0])));
        let entry = selections.get(key);
        if (!entry) {
            entry = { cached: null, retryAt: 0, pending: null }; selections.set(key, entry);
            if (selections.size > 100) for (const [oldKey, old] of selections) { if (oldKey !== key && !old.pending) { selections.delete(oldKey); break; } }
        }
        const cache = entry;
        const fallback = () => {
            const quotes = Object.fromEntries(Object.entries(cache.cached?.quotes || {}).filter(([, q]) => usableQuote(q, now())));
            if (!Object.keys(quotes).length) throw Error('行情暂时不可用，请检查币种 API ID、稍后刷新或填写手动参考单价');
            return { ...cache.cached!, quotes, stale: true };
        };
        if (cache.cached && now() - Date.parse(cache.cached.fetchedAt) < TTL) return cache.cached;
        if (coalesce && cache.pending) return cache.pending;
        if (now() < cache.retryAt) return fallback();
        const request = Promise.resolve().then(async () => {
            try {
                const next = await fetchMarket(selected);
                if (!Object.keys(next.quotes).length) throw Error('No usable prices');
                // A failed coin must not erase another chosen coin's still-valid cached reference.
                for (const coin of selected) if (!next.quotes[coin.symbol] && usableQuote(cache.cached?.quotes[coin.symbol], now())) {
                    next.quotes[coin.symbol] = cache.cached!.quotes[coin.symbol]; next.stale = true;
                }
                cache.cached = next; cache.retryAt = 0; return next;
            } catch {
                cache.retryAt = now() + 30000; return fallback();
            } finally { if (cache.pending === request) cache.pending = null; }
        });
        cache.pending = request;
        return request;
    };
}

export function withMarketPrices(book: DigitalBook, prices: MarketPrices | null, now = Date.now()): DigitalBook {
    const quotes = { ...book.quotes };
    // Stored manual prices survive removing a market. Legacy auto prices need a fresh selected quote.
    for (const [asset, quote] of Object.entries(quotes)) if (['CoinGecko', 'Coinbase', 'CoinPaprika', 'BigONE BOX/USDT'].includes(quote.source)) delete quotes[asset];
    const selected = marketWatchlist(book);
    const positions = digitalPositions({ ...book, quotes }, '').positions;
    let total = positions.reduce((sum, pos) => sum + BigInt(pos.value || 0), 0n);
    for (const asset of book.assets) {
        const coin = selected.find(c => c.symbol === asset.symbol.trim().toUpperCase());
        const quote = coin && prices?.quotes[coin.symbol];
        if (coin && quote && (quote.priceId || '') === coin.priceId && usableQuote(quote, now)) {
            try {
                const held = positions.filter(pos => pos.asset === asset.id);
                const previous = held.reduce((sum, pos) => sum + BigInt(pos.value || 0), 0n);
                const next = held.reduce((sum, pos) => sum + BigInt(valuation(units(pos.quantity), quote.priceCNY)), 0n);
                if (total - previous + next > BigInt(Number.MAX_SAFE_INTEGER)) continue;
                total = total - previous + next; quotes[asset.id] = quote;
            } catch { /* An unsafe automatic valuation must leave the manual price and editor usable. */ }
        }
    }
    return { ...book, quotes };
}
