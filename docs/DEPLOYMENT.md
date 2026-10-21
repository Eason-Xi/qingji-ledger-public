# 部署自己的轻记

这是静态应用，不需要后端数据库或登录系统。

## GitHub Pages

1. Fork 本仓库，或把源码上传到自己的 GitHub 仓库。
2. 打开仓库 **Settings → Pages → Build and deployment → Source**，选择 **GitHub Actions**。
3. 打开 **Actions → Test and publish GitHub Pages → Run workflow**，选择 main 并运行。
4. 等待 build 和 deploy 成功，从部署结果打开网站。

工作流会执行 `npm ci`、全部测试和生产构建，并根据 Pages 的子目录自动设置资源路径。不需要添加任何 Secrets。

## 其他静态托管

```bash
npm ci
npm test
npm run build
```

上传整个 `dist/` 目录到静态网站服务。默认使用相对资源路径，也适合部署在子目录。自己指定路径时可设置 `BASE_PATH` 后构建，例如：

```bash
BASE_PATH=/ledger/ npm run build
```

Node.js 建议使用24。域名变更属于新的浏览器存储来源，迁移前请从旧地址导出账本 JSON，再在新地址恢复。

## 更新

修改代码并推送 main 后会自动测试和部署。更新应用代码不会主动清空浏览器账本。若仍看到旧页面，可联网刷新；不要通过清除全部网站数据的方式刷新账本。

官方参考：[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。
