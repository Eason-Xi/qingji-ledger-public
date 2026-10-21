import type { MarketQuote } from './market-prices.ts';
// Identity verified against BigONE's March 2025 listing, which links b.watch.
export const BOX_TICKER_URL = 'https://api.big.one/api/v3/asset_pairs/BOX-USDT/ticker';
export const BOX_TRADES_URL = 'https://api.big.one/api/v3/asset_pairs/BOX-USDT/trades';
export const BOX_SOURCE = 'BigONE BOX/USDT';
export function parseBoxQuote(ticker: unknown, trades: unknown, usdt: MarketQuote | undefined, now = Date.now()): MarketQuote {
    const t = ticker as { code?: number; data?: { asset_pair_name?: string; close?: string } };
    const r = trades as { code?: number; data?: { price?: string; created_at?: string }[] };
    const valid = (v: unknown) => typeof v === 'string' && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0 && Number(v) < 1e12;
    if (t?.code !== 0 || t.data?.asset_pair_name !== 'BOX-USDT' || !valid(t.data.close) || r?.code !== 0 || !Array.isArray(r.data) || !r.data.length) throw Error('BOX 行情格式无效');
    const trade = r.data[0], at = Date.parse(trade.created_at || '');
    if (!valid(trade.price) || !Number.isFinite(at) || at > now + 60000 || now - at > 86400000) throw Error('BOX 最近成交已超过 24 小时或时间无效');
    if (!usdt || !valid(usdt.priceCNY) || !valid(usdt.priceUSD) || !Number.isFinite(Date.parse(usdt.at)) || now - Date.parse(usdt.at) > 900000 || Date.parse(usdt.at) > now + 60000) throw Error('USDT 折算汇率不可用');
    // Use a timestamped trade, not an undated ticker close. Never assume USDT = USD.
    const cny = Number(trade.price) * Number(usdt.priceCNY), usd = Number(trade.price) * Number(usdt.priceUSD);
    if (![cny, usd].every(n => Number.isFinite(n) && n > 0 && n < 1e12 && Number(n.toFixed(8)) > 0)) throw Error('BOX 折算价格无效');
    return { priceCNY: cny.toFixed(8), priceUSD: usd.toFixed(8), source: BOX_SOURCE, at: new Date(Math.min(now, Date.parse(usdt.at))).toISOString(), tradeAt: new Date(at).toISOString(), priceUSDT: trade.price, change24h: null };
}
export async function fetchBoxQuote(fetcher: typeof fetch, usdt: MarketQuote | undefined, now: () => number) {
    const results = await Promise.all([BOX_TICKER_URL, BOX_TRADES_URL].map(async url => {
        const response = await fetcher(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
        if (!response.ok) throw Error('BOX 行情接口暂不可用');
        return response.json();
    }));
    return parseBoxQuote(results[0], results[1], usdt, now());
}
