import type { DigitalBook, MarketCoin } from './extensions.ts';

export const MARKET_PRESETS = [
    { symbol: 'BTC', name: '比特币', priceId: 'bitcoin', fallbackId: 'btc-bitcoin' },
    { symbol: 'ETH', name: '以太坊', priceId: 'ethereum', fallbackId: 'eth-ethereum' },
    { symbol: 'USDT', name: '泰达币', priceId: 'tether', fallbackId: 'usdt-tether' },
    { symbol: 'BOX', name: 'BOX（李笑来）', priceId: '', fallbackId: '' },
] as const;

export function validateMarketWatchlist(value: unknown): asserts value is MarketCoin[] {
    if (!Array.isArray(value) || value.length > 50) throw Error('行情列表最多添加 50 个币种');
    const symbols = new Set<string>(), ids = new Set<string>();
    for (const coin of value) {
        if (!coin || typeof coin.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(coin.symbol) ||
            typeof coin.name !== 'string' || !coin.name.trim() || coin.name !== coin.name.trim() || coin.name.length > 200 ||
            typeof coin.priceId !== 'string' || (coin.symbol !== 'BOX' && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(coin.priceId)))
            throw Error('请填写有效的币种符号、名称和 CoinGecko 币种 ID');
        const preset = MARKET_PRESETS.find(p => p.symbol === coin.symbol);
        if (preset && preset.priceId !== coin.priceId) throw Error(`${coin.symbol} 请使用已确认的行情来源`);
        if (symbols.has(coin.symbol) || coin.priceId && ids.has(coin.priceId)) throw Error('这个币种已在行情列表中');
        symbols.add(coin.symbol); if (coin.priceId) ids.add(coin.priceId);
    }
}

export const marketWatchlist = (book: DigitalBook): MarketCoin[] => book.marketWatchlist || [];
export function addMarketCoin(book: DigitalBook, coin: MarketCoin): DigitalBook {
    const next = [...marketWatchlist(book), { symbol: coin.symbol.trim().toUpperCase(), name: coin.name.trim(), priceId: coin.priceId.trim().toLowerCase() }];
    validateMarketWatchlist(next);
    return { ...book, marketWatchlist: next };
}
export function removeMarketCoin(book: DigitalBook, symbol: string): DigitalBook {
    return { ...book, marketWatchlist: marketWatchlist(book).filter(coin => coin.symbol !== symbol.trim().toUpperCase()) };
}
