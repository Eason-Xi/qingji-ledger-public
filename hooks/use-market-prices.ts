'use client';
import { appFetch as fetch } from '../lib/browser-api';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MarketPrices } from '../lib/market-prices';

export function useMarketPrices(enabled = true) {
    const [market, setMarket] = useState<MarketPrices | null>(null);
    const [priceError, setPriceError] = useState('');
    const [priceLoading, setPriceLoading] = useState(enabled);
    const [priceNow, setPriceNow] = useState(0);
    const priceRequest = useRef<AbortController | null>(null);
    const refreshPrices = useCallback(async () => {
        if (!enabled || priceRequest.current) return;
        const controller = new AbortController();
        priceRequest.current = controller;
        setPriceLoading(true);
        try {
            const response = await fetch('/api/prices', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(35000)]) });
            const data = await response.json() as MarketPrices & { error?: string };
            if (!response.ok) throw Error(data.error || '行情加载失败');
            if (!data.quotes || typeof data.fetchedAt !== 'string') throw Error('行情数据格式无效');
            if (controller.signal.aborted) return;
            setMarket(data);
            setPriceError(data.stale ? '行情暂未更新，当前显示最近一次参考价。' : '');
        } catch (e) {
            if (controller.signal.aborted) return;
            setMarket(null);
            setPriceError(e instanceof Error ? e.message : '行情暂时不可用');
        } finally {
            if (priceRequest.current === controller) priceRequest.current = null;
            if (!controller.signal.aborted) { setPriceLoading(false); setPriceNow(Date.now()); }
        }
    }, [enabled]);
    useEffect(() => {
        if (!enabled) return;
        const initial = setTimeout(() => void refreshPrices(), 0);
        const timer = setInterval(() => { if (document.visibilityState === 'visible') void refreshPrices(); }, 60000);
        const onVisible = () => { if (document.visibilityState === 'visible') void refreshPrices(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); priceRequest.current?.abort(); priceRequest.current = null; };
    }, [enabled, refreshPrices]);
    return { market, priceError, priceLoading, priceNow, refreshPrices };
}
