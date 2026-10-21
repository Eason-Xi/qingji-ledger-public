import { BOX_SOURCE, fetchBoxQuote } from './box-price.ts';
import type { DigitalBook } from './extensions.ts';

export const MAIN_COINS = [
    { symbol: 'BTC', name: '比特币', priceId: 'bitcoin', fallbackId: 'btc-bitcoin' },
    { symbol: 'ETH', name: '以太坊', priceId: 'ethereum', fallbackId: 'eth-ethereum' },
    { symbol: 'USDT', name: '泰达币', priceId: 'tether', fallbackId: 'usdt-tether' },
] as const;
export const SUPPORTED_COINS = [...MAIN_COINS, { symbol: 'BOX', name: 'BOX（李笑来）', priceId: '', fallbackId: '' }] as const;
export type MarketQuote = { priceCNY: string; priceUSD: string; source: string; at: string; change24h: number | null; tradeAt?: string; priceUSDT?: string };
export type MarketPrices = { quotes: Record<string, MarketQuote>; stale: boolean; fetchedAt: string; boxError?: string };
export const MAX_PRICE_AGE = 15 * 60 * 1000;
const TTL = 60 * 1000;
export const PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,tether&vs_currencies=cny,usd&include_last_updated_at=true&include_24hr_change=true&precision=8';
export const COINBASE_URL = 'https://api.coinbase.com/v2/exchange-rates?currency=USD';

export function usableQuote(quote: { at: string; tradeAt?: string } | undefined, now = Date.now()) {
    if (!quote) return false;
    if (quote.tradeAt && (!Number.isFinite(Date.parse(quote.tradeAt)) || now - Date.parse(quote.tradeAt) > 86400000 || Date.parse(quote.tradeAt) > now + 60000)) return false;
    const at = Date.parse(quote.at);
    return Number.isFinite(at) && at <= now + 60000 && now - at <= MAX_PRICE_AGE;
}

export function parseMarketPrices(data: unknown, now = Date.now(), source = 'CoinGecko'): MarketPrices {
    if (!data || typeof data !== 'object') throw Error('行情数据格式无效');
    const quotes: Record<string, MarketQuote> = {};
    for (const coin of MAIN_COINS) {
        const row = (data as Record<string, Record<string, unknown>>)[coin.priceId];
        if (!row || typeof row.cny !== 'number' || !Number.isFinite(row.cny) || row.cny <= 0 || row.cny > 1e12 ||
            typeof row.usd !== 'number' || !Number.isFinite(row.usd) || row.usd <= 0 || row.usd > 1e12 ||
            typeof row.last_updated_at !== 'number' || !Number.isFinite(row.last_updated_at)) continue;
        const milliseconds = row.last_updated_at * 1000;
        if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) continue;
        const quote = { priceCNY: row.cny.toFixed(8).replace(/\.?0+$/, ''), priceUSD: row.usd.toFixed(8).replace(/\.?0+$/, ''), source, at: new Date(milliseconds).toISOString(),
            change24h: typeof row.cny_24h_change === 'number' && Number.isFinite(row.cny_24h_change) ? row.cny_24h_change : null };
        if (Number(quote.priceCNY) > 0 && Number(quote.priceUSD) > 0 && usableQuote(quote, now)) quotes[coin.symbol] = quote;
    }
    if (!Object.keys(quotes).length) throw Error('行情数据缺失或已过期');
    return { quotes, stale: Object.values(quotes).some(q => now - Date.parse(q.at) > 5 * TTL), fetchedAt: new Date(now).toISOString() };
}

/** Public market data only. Balance and wallet information never leave the app. */
export function createMarketPriceService(fetcher: typeof fetch = (input, init) => fetch(input, init), now = Date.now, coalesce = true) {
    let cached: MarketPrices | null = null;
    let retryAt = 0;
    let pending: Promise<MarketPrices> | null = null;
    const fetchOptions = () => ({ headers: { Accept: 'application/json', 'User-Agent': 'Qingji-Ledger/1.0' }, signal: AbortSignal.timeout(6000) });
    async function fetchMarket(): Promise<MarketPrices> {
        try {
            const response = await fetcher(PRICE_URL, fetchOptions());
            if (!response.ok) throw Error(`CoinGecko ${response.status}`);
            return parseMarketPrices(await response.json(), now());
        } catch (error) {
            console.warn('Primary market source unavailable:', error instanceof Error ? error.message : 'Unknown error');
        }
        try {
            const response = await fetcher(COINBASE_URL, fetchOptions());
            if (!response.ok) throw Error(`Coinbase ${response.status}`);
            const body = await response.json() as { data?: { currency?: string; rates?: Record<string, string> } };
            if (body.data?.currency !== 'USD') throw Error('Coinbase 基准币种无效');
            const rates = body.data.rates || {}, cny = Number(rates.CNY);
            if (!Number.isFinite(cny) || cny <= 0) throw Error('Coinbase 人民币汇率无效');
            const data = Object.fromEntries(MAIN_COINS.map(coin => {
                const perDollar = Number(rates[coin.symbol]);
                const valid = Number.isFinite(perDollar) && perDollar > 0;
                return [coin.priceId, { cny: valid ? cny / perDollar : null, usd: valid ? 1 / perDollar : null, last_updated_at: now() / 1000 }];
            }));
            // Coinbase exposes current exchange rates, without a per-trade timestamp or 24h change.
            return parseMarketPrices(data, now(), 'Coinbase');
        } catch (error) {
            console.warn('Coinbase market source unavailable:', error instanceof Error ? error.message : 'Unknown error');
        }
        const results = await Promise.allSettled(MAIN_COINS.map(async coin => {
            const response = await fetcher(`https://api.coinpaprika.com/v1/tickers/${coin.fallbackId}?quotes=CNY,USD`, fetchOptions());
            if (!response.ok) throw Error(`CoinPaprika ${response.status}`);
            const body = await response.json() as { symbol?: string; last_updated?: string; quotes?: { CNY?: { price?: number; percent_change_24h?: number }; USD?: { price?: number } } };
            if (body.symbol !== coin.symbol) throw Error('CoinPaprika 币种不匹配');
            return [coin.priceId, { cny: body.quotes?.CNY?.price, usd: body.quotes?.USD?.price, cny_24h_change: body.quotes?.CNY?.percent_change_24h, last_updated_at: Date.parse(body.last_updated || '') / 1000 }] as const;
        }));
        const data = Object.fromEntries(results.flatMap(r => r.status === 'fulfilled' ? [r.value] : []));
        return parseMarketPrices(data, now(), 'CoinPaprika');
    }
    const fallback = () => {
        const quotes = Object.fromEntries(Object.entries(cached?.quotes || {}).filter(([, q]) => usableQuote(q, now())));
        if (!Object.keys(quotes).length) throw Error('行情暂时不可用，请稍后刷新或填写手动参考单价');
        return { ...cached!, quotes, stale: true };
    };
    return async function getPrices(): Promise<MarketPrices> {
        if (cached && now() - Date.parse(cached.fetchedAt) < TTL) return cached;
        if (coalesce && pending) return pending;
        if (now() < retryAt) return fallback();
        pending = Promise.resolve().then(async () => {
            try {
                const next = await fetchMarket();
                try { next.quotes.BOX = await fetchBoxQuote(fetcher, next.quotes.USDT, now); }
                catch { next.boxError = 'BOX 行情暂不可用，或最近成交超过 24 小时；可填写手动参考单价。'; }
                cached = next;
                retryAt = 0;
                return cached;
            } catch (error) {
                console.warn('Market prices unavailable:', error instanceof Error ? error.message : 'Unknown error');
                retryAt = now() + 30000;
                return fallback();
            } finally { pending = null; }
        });
        return pending;
    };
}

export function withMarketPrices(book: DigitalBook, prices: MarketPrices | null, now = Date.now()): DigitalBook {
    const quotes = { ...book.quotes };
    for (const [asset, quote] of Object.entries(quotes)) {
        if (['CoinGecko', 'Coinbase', 'CoinPaprika', BOX_SOURCE].includes(quote.source) && !usableQuote(quote, now)) delete quotes[asset];
    }
    for (const asset of book.assets) {
        // Only exact supported tickers map to provider IDs; arbitrary priceId values are never fetched.
        const quote = prices?.quotes[asset.symbol.trim().toUpperCase()];
        if (quote && SUPPORTED_COINS.some(c => c.symbol === asset.symbol.trim().toUpperCase()) && usableQuote(quote, now)) quotes[asset.id] = quote;
    }
    return { ...book, quotes };
}
