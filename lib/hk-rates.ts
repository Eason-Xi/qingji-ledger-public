export type HKRates = { hkdToCNY: string; hkdToUSD: string; at: string; source: string };
export function parseHKRates(body: { data?: { currency?: string; rates?: Record<string, string> } }, now = Date.now()): HKRates {
    const hkd = Number(body.data?.rates?.HKD), cny = Number(body.data?.rates?.CNY);
    if (body.data?.currency !== 'USD' || !Number.isFinite(hkd) || !Number.isFinite(cny) || hkd <= 0 || cny <= 0 || hkd > 1000 || cny > 1000) throw Error('参考汇率无效');
    const hkdToCNY = (cny / hkd).toFixed(8), hkdToUSD = (1 / hkd).toFixed(8);
    if ([hkdToCNY, hkdToUSD].some(r => Number(r) <= 0 || Number(r) > 100)) throw Error('参考汇率超出范围');
    return { hkdToCNY, hkdToUSD, at: new Date(now).toISOString(), source: 'Coinbase 参考汇率' };
}
export function createHKRateService(fetcher: typeof fetch = (url, options) => fetch(url, options), now = Date.now) {
    let cached: HKRates | null = null, pending: Promise<HKRates> | null = null;
    return async () => {
        if (cached && now() - Date.parse(cached.at) < 300000) return cached;
        if (pending) return pending;
        pending = (async () => {
            const response = await fetcher('https://api.coinbase.com/v2/exchange-rates?currency=USD', { headers: { Accept: 'application/json', 'User-Agent': 'Qingji-Ledger/1.0' }, signal: AbortSignal.timeout(6000) });
            if (!response.ok) throw Error('参考汇率暂时不可用');
            cached = parseHKRates(await response.json(), now());
            return cached;
        })();
        try { return await pending; } finally { pending = null; }
    };
}
