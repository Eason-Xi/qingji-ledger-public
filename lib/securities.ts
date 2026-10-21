import { balances, today, validate, type Ledger, type Tx } from './ledger.ts';
import { newId } from './ids.ts';
import { isHKAccount } from './hk-securities.ts';

// Store valuation changes as balance adjustments so deposits and market movement
// remain separate from daily income and expenses, and historical entries survive.
export function updateSecuritiesValue(l: Ledger, accountId: string, value: string, date = today()): Ledger {
    if (isHKAccount(l, accountId)) throw Error('港股账户请通过持仓现价和港币现金更新估值');
    const account = l.accounts.find(a => a.id === accountId);
    if (account?.kind !== 'asset' || account.subtype !== 'securities' || account.active === false)
        throw Error('请选择已启用的证券账户');
    const input = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(input))
        throw Error('账户总资产需为非负金额，最多两位小数');
    const [whole, decimal = ''] = input.split('.');
    const target = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
    if (!Number.isSafeInteger(target) || target > 1000000000000)
        throw Error('账户总资产超出范围');
    const difference = target - balances(l)[accountId];
    if (difference === 0)
        return l;
    if (!Number.isSafeInteger(difference) || Math.abs(difference) > 100000000000)
        throw Error('单次市值调整超出范围');
    const entry: Tx = {
        id: newId(), type: 'adjustment', amount: Math.abs(difference),
        adjustmentSide: difference > 0 ? 'increase' : 'decrease', date,
        account: accountId, to: '', channel: '', category: l.categories[0].id,
        merchant: '证券账户市值更新', note: `账户总资产更新为人民币 ${input} 元（现金 + 持仓市值）`,
        status: 'posted', source: 'manual', createdAt: new Date().toISOString(),
    };
    const next = { ...l, transactions: [...l.transactions, entry] };
    validate(next);
    return next;
}
