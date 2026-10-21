'use client';
import { useState } from 'react';
import { Coins, Download, Pencil, Plus, X } from 'lucide-react';
import { newId } from '../../lib/ids';
import { money, validate } from '../../lib/ledger';
import { decimal, digitalPositions, emptyDigital, setDigitalBalance, units, type Position } from '../../lib/digital';
import { prefs } from '../../lib/features';
import { toCSV } from '../../lib/importer';
import type { DigitalAsset, DigitalBook, DigitalEvent, DigitalWallet } from '../../lib/extensions';
import { fileDownload, type PanelProps } from './FinancePanels';
import { useMarketPrices } from '../../hooks/use-market-prices';
import { SUPPORTED_COINS, usableQuote, withMarketPrices } from '../../lib/market-prices';
import { marketWatchlist } from '../../lib/market-watchlist';
import { MarketWatchlistPanel } from './MarketWatchlistPanel';

type BalanceDraft = {
    asset: string;
    wallet: string;
    symbol: string;
    name: string;
    quantity: string;
    price: string;
    note: string;
    editing: boolean;
};
const eventNames: Record<DigitalEvent['type'], string> = { opening: '期初持仓', buy: '买入', sell: '卖出', transfer: '钱包间划转', swap: '币币兑换', income: '收益 / 奖励', fee: '网络手续费' };
const timestamp = (at: string) => new Date(at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

export function DigitalPanel({ ledger: l, save, busy }: PanelProps) {
    const d = l.digital || emptyDigital();
    const [draft, setDraft] = useState<BalanceDraft | null>(null);
    const [wallet, setWallet] = useState<DigitalWallet | null>(null);
    const [error, setError] = useState('');
    const { market, priceError, priceLoading, priceNow, refreshPrices } = useMarketPrices(marketWatchlist(d));
    const pricedBook = withMarketPrices(d, market, priceNow);
    let summary;
    try {
        summary = digitalPositions(pricedBook, prefs(l).costMethod);
    } catch (e) {
        return <section className="panel"><p className="error" role="alert">{(e as Error).message}</p></section>;
    }
    const positions = summary.positions;
    const active = positions.filter(pos => units(pos.quantity) > 0n);
    const currencies = new Set(active.map(pos => pos.asset)).size;
    const noPrices = summary.missing > 0 && !active.some(pos => pos.value !== null);

    async function update(next: DigitalBook, action: string) {
        setError('');
        try {
            validate({ ...l, digital: next });
            const saved = await save({ ...l, digital: next }, action);
            if (!saved) setError('保存尚未完成，请检查页面提示后重试');
            return saved;
        } catch (e) {
            setError((e as Error).message);
            return false;
        }
    }
    function balanceDraft(assetId: string, walletId: string, editing = false): BalanceDraft {
        const a = d.assets.find(a => a.id === assetId);
        const balance = d.manualBalances?.find(b => b.asset === assetId && b.wallet === walletId);
        const pos = positions.find(pos => pos.asset === assetId && pos.wallet === walletId);
        return { asset: assetId, wallet: walletId, symbol: a?.symbol || '', name: a?.name || '', quantity: pos?.quantity || '0', price: d.quotes[assetId]?.priceCNY || '', note: balance?.note || '', editing };
    }
    function editBalance(pos?: Position) {
        setError('');
        setDraft(pos ? balanceDraft(pos.asset, pos.wallet, true) : { asset: '', wallet: d.wallets[0]?.id || '', symbol: '', name: '', quantity: '', price: '', note: '', editing: false });
    }
    function chooseAsset(value: string) {
        if (!draft || busy) return;
        setError('');
        if (value.startsWith('preset:')) {
            const coin = SUPPORTED_COINS.find(c => c.symbol === value.slice(7))!;
            const existing = d.assets.find(a => a.symbol.toUpperCase() === coin.symbol);
            setDraft(existing ? balanceDraft(existing.id, draft.wallet, draft.editing) : { ...balanceDraft('', draft.wallet, draft.editing), symbol: coin.symbol, name: coin.name });
        } else setDraft(balanceDraft(value, draft.wallet, draft.editing));
    }
    function chooseWallet(value: string) {
        if (!draft || busy) return;
        setError('');
        const selected = balanceDraft(draft.asset, value, draft.editing);
        setDraft(draft.asset ? selected : { ...selected, symbol: draft.symbol, name: draft.name, quantity: draft.quantity, price: draft.price, note: draft.note });
    }
    async function submitBalance(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!draft || busy) return;
        setError('');
        try {
            const symbol = draft.symbol.trim().toUpperCase(), name = draft.name.trim();
            if (!symbol || symbol.length > 30 || name.length > 200)
                throw Error('请填写币种符号（最多 30 个字），名称最多 200 个字');
            const old = d.assets.find(a => a.id === draft.asset);
            if ((!old || old.symbol.toUpperCase() !== symbol) && d.assets.some(a => a.id !== draft.asset && a.symbol.toUpperCase() === symbol))
                throw Error('这个币种已存在，请从“选择币种”中选取');
            const a: DigitalAsset = old ? { ...old, symbol, name } : { id: newId(), symbol, name, network: '', priceId: '' };
            const w = d.wallets.find(w => w.id === draft.wallet) || (!d.wallets.length ? { id: 'manual-wallet', name: '我的资产', kind: 'wallet' as const, network: '' } : null);
            if (!w) throw Error('请选择资产账户');
            const quantity = decimal(units(draft.quantity));
            const quotes = { ...d.quotes };
            if (draft.price.trim()) {
                const priceCNY = decimal(units(draft.price.trim(), 8), 8);
                quotes[a.id] = { priceCNY, source: '手动录入', at: new Date().toISOString() };
            } else delete quotes[a.id];
            let next: DigitalBook = { ...d, wallets: d.wallets.length ? d.wallets : [w], assets: old ? d.assets.map(x => x.id === a.id ? a : x) : [...d.assets, a], quotes };
            next = setDigitalBalance(next, w.id, a.id, quantity, draft.note);
            if (await update(next, `已保存 ${symbol} 资产余额`)) setDraft(null);
        } catch (e) {
            setError((e as Error).message);
        }
    }
    async function submitWallet(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        if (!wallet || busy) return;
        const row = { ...wallet, name: wallet.name.trim() };
        if (await update({ ...d, wallets: d.wallets.some(w => w.id === row.id) ? d.wallets.map(w => w.id === row.id ? row : w) : [...d.wallets, row] }, '已保存资产账户')) setWallet(null);
    }
    function exportBalances() {
        const rows = [['币种符号', '币种名称', '账户', '当前余额', '人民币参考单价', '人民币参考估值', '余额更新时间', '备注'], ...positions.map(pos => {
            const a = d.assets.find(a => a.id === pos.asset), b = d.manualBalances?.find(b => b.asset === pos.asset && b.wallet === pos.wallet);
            return [a?.symbol, a?.name, d.wallets.find(w => w.id === pos.wallet)?.name, pos.quantity, pricedBook.quotes[pos.asset]?.priceCNY || '', pos.value === null ? '' : (pos.value / 100).toFixed(2), b?.updated || '', b?.note || ''];
        })];
        fileDownload('轻记_资产余额.csv', toCSV(rows), 'text/csv;charset=utf-8');
    }
    function exportHistory() {
        const rows = [['日期', '时间', '类型', '钱包', '币种', '数量', '转入钱包', '换入币种', '换入数量', '人民币金额', '法币账户', '手续费币种', '手续费数量', 'TxHash', '备注'], ...d.events.filter(e => e.status === 'posted').map(e => [e.date, e.time || '', e.type, d.wallets.find(w => w.id === e.wallet)?.name, d.assets.find(a => a.id === e.asset)?.symbol, e.quantity, d.wallets.find(w => w.id === e.toWallet)?.name || '', d.assets.find(a => a.id === e.toAsset)?.symbol || '', e.toQuantity || '', (e.fiatCNY / 100).toFixed(2), l.accounts.find(a => a.id === e.fiatAccount)?.name || '', d.assets.find(a => a.id === e.feeAsset)?.symbol || '', e.feeQuantity || '', e.txHash, e.note])];
        fileDownload('轻记_数字资产历史.csv', toCSV(rows), 'text/csv;charset=utf-8');
    }
    return <div className="digital-layout manual-digital">
        <MarketWatchlistPanel book={d} update={update} busy={busy} market={market} priceError={priceError} priceLoading={priceLoading} priceNow={priceNow} refreshPrices={refreshPrices}/>
        <section className="panel full-span digital-overview">
            <div className="section-heading"><div><h2>我的资产余额</h2><p className="muted">自己定义币种，自己掌握余额。</p></div><span className="badge">手动余额 · 行情估值</span></div>
            <div className="asset-summary"><div>已估值资产合计<b>{noPrices ? '待填写单价' : '¥' + money(summary.value)}</b></div><div>有余额的币种<b>{currencies}<small>种</small></b></div><div>资产账户<b>{d.wallets.length}<small>个</small></b></div></div>
            <p className="muted">余额按你填写的数量保存。添加到“我的行情”的币种优先使用行情估值；未关注或行情不可用时使用手动参考单价。{summary.missing > 0 && ` ${summary.missing} 项资产缺少有效单价，未计入估值合计。`}</p>
            <div className="button-row import-actions"><button className="primary" disabled={busy} onClick={() => editBalance()}><Plus size={16}/>添加资产</button><button className="secondary" disabled={!positions.length} onClick={exportBalances}><Download size={15}/>导出余额</button></div>
            {!draft && !wallet && error && <p className="error" role="alert">{error}</p>}
        </section>
        <section className="panel full-span digital-holdings">
            <div className="section-heading"><h2>资产明细</h2><span className="muted">{positions.length} 项余额</span></div>
            {positions.length > 0 ? <div className="digital-balance-grid">{positions.map(pos => {
                const a = d.assets.find(a => a.id === pos.asset)!;
                const b = d.manualBalances?.find(b => b.asset === pos.asset && b.wallet === pos.wallet);
                const q = pricedBook.quotes[pos.asset];
                const candidate = market?.quotes[a.symbol.trim().toUpperCase()];
                const live = q === candidate ? candidate : undefined;
                return <article className="digital-balance-card" key={pos.wallet + '|' + pos.asset}>
                    <div className="digital-balance-heading"><div className="digital-coin-icon" aria-hidden="true">{a.symbol.slice(0, 3)}</div><div><h3>{a.symbol}</h3><p>{a.name || '自定义币种'} · {d.wallets.find(w => w.id === pos.wallet)?.name}</p></div><button className="icon-button" aria-label={`修改 ${a.symbol} 在${d.wallets.find(w => w.id === pos.wallet)?.name}的余额`} disabled={busy} onClick={() => editBalance(pos)}><Pencil size={16}/></button></div>
                    <div className="digital-balance-amount"><span>当前余额</span><strong>{pos.quantity}</strong><small>{a.symbol}</small></div>
                    <div className="digital-balance-value"><span>人民币参考估值</span><b>{pos.value === null ? '未设置单价' : '¥' + money(pos.value)}</b></div>
                    {q && <p className="digital-price-note">{q.source} · {live && usableQuote(live, priceNow) ? `美元 $${live.priceUSD} · ` : ''}人民币 ¥{q.priceCNY} / {a.symbol} · {q.source === 'Coinbase' ? '获取于 ' : ''}{timestamp(q.at)}{['CoinGecko', 'Coinbase', 'CoinPaprika'].includes(q.source) && market?.stale ? ' · 最近参考价' : ''}</p>}
                    {b?.note && <p className="digital-balance-note">{b.note}</p>}
                    <div className="digital-balance-footer"><small>{b ? '更新于 ' + timestamp(b.updated) : '历史记录计算的余额'}</small><button className="text-button" disabled={busy} onClick={() => editBalance(pos)}>修改余额</button></div>
                </article>;
            })}</div> : <div className="digital-empty"><span><Coins size={29}/></span><h3>添加你的第一项资产</h3><p>BTC、ETH、USDT，或任意自定义币种。<br/>填写当前余额，即可开始管理。</p><button className="primary" disabled={busy} onClick={() => editBalance()}><Plus size={16}/>添加资产</button></div>}
        </section>
        <details className="panel full-span digital-management"><summary>资产账户管理</summary><p className="muted">默认保存在“我的资产”中。也可以创建多个账户，分别记录每个账户中的余额。</p>
            {d.wallets.map(w => <div className="manage-row" key={w.id}><div><b>{w.name}</b></div><button className="text-button" disabled={busy} onClick={() => { setError(''); setWallet(w); }}>编辑名称</button></div>)}
            <button className="secondary import-actions" disabled={busy} onClick={() => { setError(''); setWallet({ id: newId(), name: '', kind: 'wallet', network: '' }); }}><Plus size={14}/>添加账户</button>
        </details>
        {d.events.length > 0 && <details className="panel full-span digital-management"><summary>历史交易记录</summary><p className="muted">原有交易记录保留在账本和完整备份中。修改余额后，该账户与币种的当前持仓按手动余额显示。</p><button className="secondary" onClick={exportHistory}><Download size={14}/>导出历史流水</button><div className="table-scroll import-actions"><table><thead><tr><th>日期</th><th>类型</th><th>币种</th><th>数量</th></tr></thead><tbody>{d.events.filter(e => e.status === 'posted').slice(-100).reverse().map(e => <tr key={e.id}><td>{e.date}</td><td>{eventNames[e.type]}</td><td>{d.assets.find(a => a.id === e.asset)?.symbol}</td><td>{e.quantity}</td></tr>)}</tbody></table></div></details>}
        {draft && <div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label={draft.editing ? '修改资产余额' : '添加资产'} onKeyDown={e => { if (e.key === 'Escape' && !busy) setDraft(null); }}>
            <div className="section-heading"><h2>{draft.editing ? '修改资产余额' : '添加资产'}</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setDraft(null)}><X size={20}/></button></div>
            <form onSubmit={submitBalance}><div className="form-grid">
                <label>选择币种<select value={draft.asset || (SUPPORTED_COINS.some(c => c.symbol === draft.symbol) ? 'preset:' + draft.symbol : '')} disabled={busy} onChange={e => chooseAsset(e.target.value)}><option value="">自定义新币种</option>{SUPPORTED_COINS.filter(c => !d.assets.some(a => a.symbol.toUpperCase() === c.symbol)).map(c => <option key={c.symbol} value={'preset:' + c.symbol}>{c.symbol} · {c.name}</option>)}{d.assets.map(a => <option key={a.id} value={a.id}>{a.symbol}{a.name ? ' · ' + a.name : ''}</option>)}</select></label>
                <label>资产账户<select value={draft.wallet} disabled={busy} onChange={e => chooseWallet(e.target.value)}>{!d.wallets.length && <option value="">我的资产（默认）</option>}{d.wallets.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
                <label>币种符号<input autoFocus required maxLength={30} placeholder="如 BTC、ETH、USDT" value={draft.symbol} onChange={e => setDraft({ ...draft, symbol: e.target.value.toUpperCase() })}/></label>
                <label>币种名称（可选）<input maxLength={200} placeholder="如 比特币、以太坊" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
                <label>当前余额<input required maxLength={64} inputMode="decimal" placeholder="支持 0，最多 18 位小数" value={draft.quantity} onChange={e => setDraft({ ...draft, quantity: e.target.value })}/></label>
                <label>人民币参考单价（可选）<input maxLength={64} inputMode="decimal" placeholder="每 1 单位资产的人民币价格" value={draft.price} onChange={e => setDraft({ ...draft, price: e.target.value })}/></label>
            </div>{draft.editing && <p className="muted">切换币种或账户会加载对应余额；保存仅更新当前选择的组合。</p>}<p className="muted">关注列表中同符号币种自动使用人民币行情；手动单价作为备用。未关注且单价留空时只记录数量。同一币种共用单价，余额可填 0。</p><label>备注（可选）<textarea maxLength={2000} placeholder="记录这项资产的说明" value={draft.note} onChange={e => setDraft({ ...draft, note: e.target.value })}/></label>{error && <p className="error" role="alert">{error}</p>}<div className="dialog-bottom"><button type="button" className="secondary" disabled={busy} onClick={() => setDraft(null)}>取消</button><button className="primary" disabled={busy}>保存余额</button></div></form>
        </section></div>}
        {wallet && <div className="overlay"><section className="dialog" role="dialog" aria-modal="true" aria-label="资产账户" onKeyDown={e => { if (e.key === 'Escape' && !busy) setWallet(null); }}><div className="section-heading"><h2>资产账户</h2><button className="icon-button" aria-label="关闭" disabled={busy} onClick={() => setWallet(null)}><X size={20}/></button></div><form onSubmit={submitWallet}><label>账户名称<input autoFocus required maxLength={200} placeholder="如 我的资产、长期持有" value={wallet.name} onChange={e => setWallet({ ...wallet, name: e.target.value })}/></label>{error && <p className="error" role="alert">{error}</p>}<div className="dialog-bottom"><button type="button" className="secondary" disabled={busy} onClick={() => setWallet(null)}>取消</button><button className="primary" disabled={busy}>保存账户</button></div></form></section></div>}
    </div>;
}
