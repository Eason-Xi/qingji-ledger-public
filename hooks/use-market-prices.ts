'use client';
import { appFetch as fetch } from '../lib/browser-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketPrices } from '../lib/market-prices';
import type { MarketCoin } from '../lib/extensions';

export function useMarketPrices(selection: readonly MarketCoin[]) {
    const key = JSON.stringify(selection);
    const enabled = selection.length > 0;
    const [state, setState] = useState<{ key: string; market: MarketPrices | null; error: string; loading: boolean; now: number }>({ key: '', market: null, error: '', loading: false, now: Date.now() });
    const priceRequest = useRef<AbortController | null>(null);
    const refreshPrices = useCallback(async () => {
        if (!enabled || priceRequest.current) return;
        const controller = new AbortController();
        priceRequest.current = controller;
        setState(previous => ({ key, market: previous.key === key ? previous.market : null, error: '', loading: true, now: Date.now() }));
        try {
            const response = await fetch('/api/prices?coins=' + encodeURIComponent(key), { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) });
            const data = await response.json() as MarketPrices & { error?: string };
            if (!response.ok) throw Error(data.error || '行情加载失败');
            if (!data.quotes || typeof data.fetchedAt !== 'string') throw Error('行情数据格式无效');
            if (controller.signal.aborted) return;
            setState({ key, market: data, error: data.stale ? '部分行情暂未更新，当前显示最近一次参考价。' : '', loading: false, now: Date.now() });
        } catch (e) {
            if (controller.signal.aborted) return;
            setState({ key, market: null, error: e instanceof Error ? e.message : '行情暂时不可用', loading: false, now: Date.now() });
        } finally { if (priceRequest.current === controller) priceRequest.current = null; }
    }, [enabled, key]);
    useEffect(() => {
        if (!enabled) return;
        const initial = setTimeout(() => void refreshPrices(), 0);
        const timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshPrices(); }, 60000);
        const onVisible = () => { if (document.visibilityState === 'visible') void refreshPrices(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); priceRequest.current?.abort(); priceRequest.current = null; };
    }, [enabled, refreshPrices]);
    const current = state.key === key;
    return { market: current && enabled ? state.market : null, priceError: current && enabled ? state.error : '', priceLoading: enabled && (!current || state.loading), priceNow: current ? state.now : Date.now(), refreshPrices };
}
