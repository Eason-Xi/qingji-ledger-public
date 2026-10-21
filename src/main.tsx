import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from '../app/page';
import '../app/globals.css';
import '../app/apple-theme.css';
import './public.css';

class StorageBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <main className="public-failure"><h1>暂时无法打开账本</h1><p>请刷新页面重试。原有浏览器数据库不会因页面错误而清除。</p><button onClick={() => location.reload()}>刷新页面</button><p>若仍有问题，请从正常浏览模式打开，并确认网站存储权限。</p></main> : this.props.children; }
}
createRoot(document.getElementById('root')!).render(<StorageBoundary><Page/></StorageBoundary>);
