'use client';
import { useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import type { DigitalBook, MarketCoin } from '../../lib/extensions';
import { addMarketCoin, MARKET_PRESETS, marketWatchlist, removeMarketCoin } from '../../lib/market-watchlist';
import { usableQuote, type MarketPrices } from '../../lib/market-prices';

const timestamp = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
export function MarketWatchlistPanel({ book, update, busy, market, priceError, priceLoading, priceNow, refreshPrices }: {
    book: DigitalBook;
    update: (book: DigitalBook, action: string) => Promise<boolean>;
    busy: boolean;
    market: MarketPrices | null;
    priceError: string;
    priceLoading: boolean;
    priceNow: number;
    refreshPrices: () => Promise<void>;
}) {
    const selected = marketWatchlist(book);
    const [draft, setDraft] = useState<MarketCoin | null>(null);
    const [choice, setChoice] = useState('');
    const [error, setError] = useState('');
    function choose(value: string) {
        setChoice(value); setError('');
        const preset = MARKET_PRESETS.find(c => c.symbol === value);
        setDraft(preset ? { symbol: preset.symbol, name: preset.name, priceId: preset.priceId } : { symbol: '', name: '', priceId: '' });
    }
    function open() { choose(MARKET_PRESETS.find(c => !selected.some(s => s.symbol === c.symbol))?.symbol || 'custom'); }
    async function submit(event: React.FormEvent) {
        event.preventDefault(); if (busy || !draft) return; setError('');
        try { if (await update(addMarketCoin(book, draft), `已添加 ${draft.symbol.trim().toUpperCase()} 行情`)) setDraft(null); else setError('添加尚未保存，请检查页面提示后重试'); }
        catch (e) { setError(e instanceof Error ? e.message : '添加行情失败'); }
    }
    async function remove(coin: MarketCoin) {
        setError('');
        if (!await update(removeMarketCoin(book, coin.symbol), `已移除 ${coin.symbol} 行情`)) setError('移除尚未保存，请检查页面提示后重试');
    }
    return <section className="panel full-span digital-market" aria-label="我的美元及人民币行情">
        <div className="section-heading"><div><h2>我的行情</h2><p className="muted">自行添加关注币种 · 美元 USD / 人民币 CNY{selected.length > 0 ? ' · 每 60 秒刷新' : ''}</p></div><div className="button-row market-actions"><button className="secondary" disabled={!selected.length || priceLoading} onClick={() => void refreshPrices()}><RefreshCw size={15}/>{priceLoading ? '刷新中…' : '刷新行情'}</button><button className="primary" disabled={busy || selected.length >= 50} onClick={open}><Plus size={16}/>添加行情</button></div></div>
        {selected.length ? <div className="digital-market-grid">{selected.map(coin => {
            const quote = market?.quotes[coin.symbol], available = usableQuote(quote, priceNow);
            return <article className="digital-market-card" key={coin.symbol}>
                <div className="market-card-title"><b>{coin.symbol}</b><span>{coin.name}</span><button className="icon-button" disabled={busy} aria-label={`移除 ${coin.symbol} 行情`} onClick={() => void remove(coin)}><X size={16}/></button></div>
                <small>{coin.symbol === 'BOX' ? 'BigONE · BOX/USDT' : <>CoinGecko ID：<a href={'https://www.coingecko.com/en/coins/' + coin.priceId} target="_blank" rel="noreferrer">{coin.priceId}</a></>}</small>
                <div className="digital-market-prices">{(['USD', 'CNY'] as const).map(currency => {
                    const price = Number(currency === 'USD' ? quote?.priceUSD : quote?.priceCNY);
                    return <div key={currency}><span>{currency === 'USD' ? '美元 USD' : '人民币 CNY'}</span><strong>{available ? (currency === 'USD' ? '$' : '¥') + price.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: price < 1 ? 8 : coin.symbol === 'USDT' ? 4 : 2 }) : priceLoading ? '加载中…' : '暂不可用'}</strong></div>;
                })}</div>
                <small>{available && quote!.change24h !== null ? `24h (CNY) ${quote!.change24h >= 0 ? '+' : ''}${quote!.change24h.toFixed(2)}%` : available && quote!.source === 'Coinbase' ? '人民币按美元交叉汇率换算' : '24h 涨跌暂无数据'}</small>
                <small>{available ? `${quote!.source} · ${['Coinbase', 'BigONE BOX/USDT'].includes(quote!.source) ? '获取时间 ' : '报价时间 '}${timestamp(quote!.at)}` : market?.errors?.[coin.symbol] || '等待有效报价'}</small>
                {coin.symbol === 'BOX' && <small>{available ? `最近成交 ${quote!.priceUSDT} USDT · ${timestamp(quote!.tradeAt || '')} · 按 USDT 折算` : market?.boxError}<br/>李笑来 BOX · 二级市场成交参考价，非基金净值；不适用于 BOX4。</small>}
            </article>;
        })}</div> : <div className="market-empty"><h3>添加你关注的第一个币种</h3><p>支持 BTC、ETH、USDT、BOX，也可以添加其他 CoinGecko 币种。<br/>未添加时不请求行情，资产仍可使用手动参考单价。</p><button className="secondary" disabled={busy} onClick={open}><Plus size={16}/>选择币种</button></div>}
        {priceError && <p className="muted" role="status">{priceError}</p>}
        {error && !draft && <p className="error" role="alert">{error}</p>}
        <p className="digital-market-attribution">关注列表仅保存在当前账本，并随完整备份导出。移除行情只停止关注与自动估值，资产数量及手动参考价保留。{selected.length > 0 && <> 行情来自 <a href="https://www.coingecko.com/en/api" target="_blank" rel="noreferrer">CoinGecko</a> / <a href="https://www.coinbase.com/" target="_blank" rel="noreferrer">Coinbase</a> / <a href="https://coinpaprika.com/" target="_blank" rel="noreferrer">CoinPaprika</a> / BigONE，为市场参考价。</>}</p>
        {draft && <div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label="添加行情" onKeyDown={event => { if (event.key === 'Escape' && !busy) setDraft(null); }}>
            <div className="section-heading"><h2>添加行情</h2><button className="icon-button" aria-label="关闭行情窗口" disabled={busy} onClick={() => setDraft(null)}><X size={20}/></button></div>
            <form onSubmit={submit}><label>选择行情币种<select autoFocus value={choice} disabled={busy} onChange={event => choose(event.target.value)}>{MARKET_PRESETS.filter(c => !selected.some(s => s.symbol === c.symbol)).map(c => <option key={c.symbol} value={c.symbol}>{c.symbol} · {c.name}</option>)}<option value="custom">其他币种（CoinGecko）</option></select></label>
                {choice === 'custom' ? <><div className="form-grid"><label>行情币种符号<input required maxLength={30} placeholder="如 SOL" value={draft.symbol} disabled={busy} onChange={event => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })}/></label><label>行情币种名称<input required maxLength={200} placeholder="如 Solana" value={draft.name} disabled={busy} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label></div><label>CoinGecko 币种 ID<input required maxLength={100} placeholder="如 solana" value={draft.priceId} disabled={busy} onChange={event => setDraft({ ...draft, priceId: event.target.value.toLowerCase() })}/></label><p className="muted">在 CoinGecko 币种详情网址 /en/coins/ 后找到 ID，例如 solana。请核对币种身份；报价用于同符号资产的估值，不输入网址或 API 密钥。</p></> : <p className="muted">{draft.symbol} · {draft.name}，自动显示美元和人民币价格。{draft.symbol === 'BOX' ? '使用 BigONE 的 BOX/USDT 最近成交，并查询 USDT 汇率折算；不会自动关注 USDT。' : '无需设置 API 密钥。'}</p>}
                {error && <p className="error" role="alert">{error}</p>}<div className="dialog-bottom"><button type="button" className="secondary" disabled={busy} onClick={() => setDraft(null)}>取消</button><button className="primary" disabled={busy}>添加到我的行情</button></div>
            </form>
        </section></div>}
    </section>;
}
