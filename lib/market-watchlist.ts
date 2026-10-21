import type { DigitalBook, MarketCoin } from './extensions.ts';

export const MARKET_PRESETS = [
    { symbol: 'BTC', name: '比特币', priceId: 'bitcoin', fallbackId: 'btc-bitcoin' },
    { symbol: 'ETH', name: '以太坊', priceId: 'ethereum', fallbackId: 'eth-ethereum' },
    { symbol: 'USDT', name: '泰达币', priceId: 'tether', fallbackId: 'usdt-tether' },
    { symbol: 'BNB', name: 'BNB', priceId: 'binancecoin', fallbackId: 'bnb-binance-coin' },
] as const;

// BNB's website slug is not its API ID. Only this confirmed legacy alias is corrected.
export const normalizeMarketCoin = (coin: MarketCoin): MarketCoin => coin.symbol === 'BNB' && coin.priceId === 'bnb' ? { ...coin, priceId: 'binancecoin' } : coin;
const cleanMarketCoin = (coin: MarketCoin) => normalizeMarketCoin({ symbol: coin.symbol.trim().toUpperCase(), name: coin.name.trim(), priceId: coin.priceId.trim().toLowerCase() });

// Recognize the retired built-in entry only to keep existing backups readable.
export const isRetiredMarketCoin = (coin: MarketCoin) => coin.symbol === 'BOX' && coin.priceId === '';

export function validateMarketWatchlist(value: unknown): asserts value is MarketCoin[] {
    if (!Array.isArray(value) || value.length > 50) throw Error('行情列表最多添加 50 个币种');
    const symbols = new Set<string>(), ids = new Set<string>();
    for (const coin of value) {
        if (!coin || typeof coin.symbol !== 'string' || !/^[A-Z0-9][A-Z0-9._-]{0,29}$/.test(coin.symbol) ||
            typeof coin.name !== 'string' || !coin.name.trim() || coin.name !== coin.name.trim() || coin.name.length > 200 ||
            typeof coin.priceId !== 'string' || (!isRetiredMarketCoin(coin) && !/^[a-z0-9][a-z0-9-]{0,99}$/.test(coin.priceId)))
            throw Error('请填写有效的币种符号、名称和 CoinGecko 币种 ID');
        // BNB was previously custom: keep older IDs readable so they can be corrected in the editor.
        const preset = MARKET_PRESETS.find(p => p.symbol === coin.symbol && p.symbol !== 'BNB');
        if (preset && preset.priceId !== coin.priceId) throw Error(`${coin.symbol} 请使用已确认的行情来源`);
        if (symbols.has(coin.symbol) || coin.priceId && ids.has(coin.priceId)) throw Error('这个币种已在行情列表中');
        symbols.add(coin.symbol); if (coin.priceId) ids.add(coin.priceId);
    }
}

export const marketWatchlist = (book: DigitalBook): MarketCoin[] => (book.marketWatchlist || []).filter(coin => !isRetiredMarketCoin(coin)).map(normalizeMarketCoin);
export function addMarketCoin(book: DigitalBook, coin: MarketCoin): DigitalBook {
    const next = [...marketWatchlist(book), cleanMarketCoin(coin)];
    if (isRetiredMarketCoin(next[next.length - 1])) throw Error('此旧版内置行情已停用，请选择其他币种');
    validateMarketWatchlist(next);
    return { ...book, marketWatchlist: next };
}
export function updateMarketCoin(book: DigitalBook, symbol: string, coin: MarketCoin): DigitalBook {
    const current = marketWatchlist(book), normalized = cleanMarketCoin(coin);
    if (isRetiredMarketCoin(normalized)) throw Error('此旧版内置行情已停用，请选择其他币种');
    if (!current.some(row => row.symbol === symbol)) throw Error('此行情已不存在，请重新打开列表');
    if (normalized.symbol !== symbol) throw Error('修改行情时不能更换币种符号，请另行添加');
    const next = current.map(row => row.symbol === symbol ? normalized : row);
    validateMarketWatchlist(next);
    return { ...book, marketWatchlist: next };
}
export function removeMarketCoin(book: DigitalBook, symbol: string): DigitalBook {
    return { ...book, marketWatchlist: marketWatchlist(book).filter(coin => coin.symbol !== symbol.trim().toUpperCase()) };
}
