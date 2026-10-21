'use client';
import type { Ledger, Tx } from '../../lib/ledger';
import { accountRegion, hasHKDBalance } from '../../lib/account-currency';
import { isHKAccount } from '../../lib/hk-securities';
import { isHKTransfer, isCurrencyTransfer, transferNeedsRate } from '../../lib/hk-transfers';

export function TransferFields({ ledger, tx, amount, toAmount, valuationRate, onChange, onAmount, onToAmount, onValuationRate }: {
    ledger: Ledger; tx: Tx; amount: string; toAmount: string; valuationRate: string;
    onChange: (t: Tx) => void; onAmount: (s: string) => void; onToAmount: (s: string) => void; onValuationRate: (s: string) => void;
}) {
    const linked = isHKTransfer(ledger, tx), explicit = isCurrencyTransfer(ledger, tx);
    const sourceHK = isHKAccount(ledger, tx.account), targetHK = isHKAccount(ledger, tx.to);
    const sourceCurrency = tx.currency || (sourceHK ? 'HKD' : 'CNY'), targetCurrency = tx.toCurrency || (targetHK ? 'HKD' : 'CNY');
    const selectable = (id: string) => isHKAccount(ledger, id) || ledger.accounts.some(a => a.id === id && hasHKDBalance(a));
    const currencyOptions = linked || selectable(tx.account) && selectable(tx.to);
    function update(next: Tx, currency: 'CNY' | 'HKD', toCurrency: 'CNY' | 'HKD') {
        const modern = isHKTransfer(ledger, next) || currency === 'HKD' || toCurrency === 'HKD';
        onChange({ ...next, channel: '', currency: modern ? currency : undefined, toCurrency: modern ? toCurrency : undefined, toAmount: undefined, fee: undefined });
        onAmount(''); onToAmount(''); onValuationRate('');
    }
    function accountChange(side: 'account' | 'to', id: string) {
        const next = { ...tx, [side]: id };
        const otherSide = side === 'account' ? 'to' : 'account';
        const other = ledger.accounts.find(a => a.id === next[otherSide]);
        if (isHKAccount(ledger, id) && other && (other.kind !== 'asset' || other.subtype === 'securities')) next[otherSide] = '';
        const canSelect = selectable(next.account) && selectable(next.to);
        const currency = (id: string) => isHKAccount(ledger, id) || ledger.accounts.some(a => a.id === id && hasHKDBalance(a) && accountRegion(a) === 'hongkong') ? 'HKD' as const : 'CNY' as const;
        update(next, canSelect ? currency(next.account) : 'CNY', canSelect ? currency(next.to) : 'CNY');
    }
    function currencies(side: 'currency' | 'toCurrency', id: string, value: string) {
        const account = ledger.accounts.find(a => a.id === id), broker = isHKAccount(ledger, id);
        return <label>{side === 'currency' ? '扣款币种' : '到账币种'}<select value={value} disabled={broker || !account || !hasHKDBalance(account)} onChange={e => update(tx, side === 'currency' ? e.target.value as 'CNY' | 'HKD' : sourceCurrency, side === 'toCurrency' ? e.target.value as 'CNY' | 'HKD' : targetCurrency)}>
            {!broker && <option value="CNY">人民币 CNY</option>}{(broker || account && hasHKDBalance(account)) && <option value="HKD">港币 HKD</option>}
        </select></label>;
    }
    return <>
        <div className="form-grid">{(['account', 'to'] as const).map(side => <label key={side}>{side === 'account' ? '转出账户' : '转入账户'}<select value={tx[side]} onChange={e => accountChange(side, e.target.value)}><option value="">请选择</option>{ledger.accounts.filter(a => (a.active !== false || a.id === tx.account || a.id === tx.to) && (!isHKAccount(ledger, side === 'account' ? tx.to : tx.account) || a.kind === 'asset' && a.subtype !== 'securities')).map(a => <option value={a.id} key={a.id}>{a.name}{isHKAccount(ledger, a.id) ? '（证券·港币）' : ''}</option>)}</select></label>)}
        {currencyOptions && <>{currencies('currency', tx.account, sourceCurrency)}{currencies('toCurrency', tx.to, targetCurrency)}</>}
        <label>{explicit ? `实际扣款（${sourceCurrency === 'HKD' ? '港币' : '人民币'}，含费用）` : '转账金额（人民币）'}<input autoFocus type="number" min="0.01" step="0.01" value={amount} onChange={e => onAmount(e.target.value)} placeholder="0.00"/></label>
        {explicit && <label>实际到账（{targetCurrency === 'HKD' ? '港币' : '人民币'}，扣费后）<input type="number" min="0.01" step="0.01" value={toAmount} onChange={e => onToAmount(e.target.value)} placeholder="0.00"/></label>}
        {transferNeedsRate(ledger, tx) && <label>估值汇率（1 港币 = 人民币）<input type="number" min="0.00000001" max="100" step="0.00000001" value={valuationRate} onChange={e => onValuationRate(e.target.value)} placeholder="用于折算净资产，不改变转账原币金额"/></label>}</div>
        {currencyOptions && <p className="status-note">所有银行资金账户均可选择人民币或港币，转出与转入可分别选币种。{linked ? '证券账户使用港币，股票买卖只使用证券账户内的现金。' : '两种余额分别记录，按实际币种扣款和到账。'}</p>}
        {transferNeedsRate(ledger, tx) && <p className="muted">这两个账户尚未设置港币折算汇率。首次填写后保存在账户设置中，仅用于净资产估值。</p>}
    </>;
}
