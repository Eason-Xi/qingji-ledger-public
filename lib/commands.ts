import { cents, today, type Ledger, type Tx } from './ledger.ts';
import { addDays } from './features.ts';
export function parseCommand(input: string, l: Ledger): {
    action: 'update' | 'delete';
    candidates: Tx[];
    patch: Partial<Tx>;
} | null {
    if (!/改|不是|删除|删掉|备注/.test(input) || !/刚才|上一笔|昨天|今天|那笔/.test(input))
        return null;
    const action = /删除|删掉/.test(input) ? 'delete' : 'update';
    let candidates = l.transactions.filter(t => t.status !== 'deleted');
    if (/昨天/.test(input))
        candidates = candidates.filter(t => t.date === addDays(today(), -1));
    else if (/今天/.test(input))
        candidates = candidates.filter(t => t.date === today());
    const patch: Partial<Tx> = {};
    const nums = input.match(/\d+(?:\.\d{1,2})?/g) || [];
    if (action === 'update' && nums.length)
        patch.amount = cents(nums[nums.length - 1]!);
    if (nums.length > 1 && /不是|从/.test(input))
        candidates = candidates.filter(t => t.amount === cents(nums[0]!));
    const explicit = l.accounts.find(a => input.includes(a.name)) || (/花呗/.test(input) ? l.accounts.find(a => a.id === 'huabei') : /微信零钱|微信钱包/.test(input) ? l.accounts.find(a => a.id === 'wechat') : /支付宝余额/.test(input) ? l.accounts.find(a => a.id === 'alipay') : undefined);
    if (explicit)
        patch.account = explicit.id;
    const note = input.match(/(?:备注(?:改为|加上|为)?|追加备注)[：:\s]*(.+)$/);
    if (note)
        patch.note = note[1];
    const merchant = candidates.find(t => t.merchant.length > 1 && input.includes(t.merchant));
    if (merchant)
        candidates = candidates.filter(t => t.merchant === merchant.merchant);
    candidates = [...candidates].reverse();
    if (/刚才|上一笔/.test(input)) {
        const recent = candidates[0];
        if (recent && recent.createdAt && Date.now() - Date.parse(recent.createdAt) < 30 * 60000)
            candidates = [recent];
        else
            candidates = candidates.slice(0, 10);
    }
    return { action, candidates: candidates.slice(0, 20), patch };
}
