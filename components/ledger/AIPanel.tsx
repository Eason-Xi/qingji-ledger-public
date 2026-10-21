'use client';
export function AIPanel() {
    return <section className="panel"><h2>规则记账与隐私</h2><p className="muted">公开版无需服务商密钥。手动记账和文字规则解析都在浏览器中完成，记账文字、余额、账户和流水不会发送给本站服务器。</p><p className="muted">浏览器语音输入取决于系统及浏览器支持，可能通过浏览器厂商的在线服务识别。数字资产行情和参考汇率只查询固定的公开市场接口，不发送你的持仓或余额。</p><div className="status-note">公开版不提供云端 AI 配置，不接收或保存 API 密钥。账本不自动跨设备同步，可通过导出和恢复备份迁移。</div></section>;
}
