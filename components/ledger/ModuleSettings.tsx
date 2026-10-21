'use client';
import { Coins, TrendingUp } from 'lucide-react';
import { moduleEnabled, setModuleEnabled, type OptionalModule } from '../../lib/optional-modules';
import type { PanelProps } from './FinancePanels';

const modules = [
    { id: 'securities', name: '港股证券', Icon: TrendingUp, description: '记录证券账户、港股持仓、买入卖出、股息和费用。' },
    { id: 'digital', name: '数字资产', Icon: Coins, description: '管理币种、资产账户和余额，查看自选币种的美元及人民币行情。' },
] satisfies { id: OptionalModule; name: string; Icon: typeof Coins; description: string }[];

export function ModuleSettings({ ledger, save, busy, ready }: PanelProps & { ready: boolean }) {
    return <section className="panel module-settings">
        <h2>按需启用功能</h2>
        <p className="muted">仅对当前账本生效，保存后立即更新导航；需要时可以随时重新启用。</p>
        <div className="module-list">{modules.map(({ id, name, Icon, description }) => {
            const enabled = moduleEnabled(ledger, id);
            return <div className="module-option" key={id}>
                <div className="module-icon"><Icon size={22}/></div>
                <div className="module-description"><h3>{name}</h3><p>{description}</p><small>{enabled ? '已启用 · 导航中可见' : '已隐藏 · 需要时再开启'}</small></div>
                <button type="button" role="switch" aria-label={'启用' + name} aria-checked={enabled} className={'module-switch' + (enabled ? ' enabled' : '')} disabled={busy || !ready} onClick={() => void save(setModuleEnabled(ledger, id, !enabled), (enabled ? '已隐藏' : '已启用') + name)}><span/></button>
            </div>;
        })}</div>
        <p className="muted module-data-note">隐藏不会删除账户、资产、行情列表或交易明细，已有资产仍计入账户概览。数字资产隐藏后停止自动获取行情，概览使用已保存的手动参考价估值。</p>
    </section>;
}
