# Claude HUD — Cowork → Code 交接文档

**日期:** 2026-05-18  
**项目路径:** `claude-hud-v2/`（就是这个文件夹本身）

---

## 项目概述

Claude HUD 是一个 Mac 浮动桌面小组件，以血条形式实时显示 claude.ai 的用量数据。两部分组成：Chrome 扩展（后台爬 claude.ai/settings/usage）+ Electron 桌面 widget（WebSocket 接收 + 渲染）。完整技术架构见 `claude-hud-handoff.md`（在 uploads/ 里，也可以直接问 Sui）。

**目标：** 把这个只有 Sui 自己在用的工具推出去给其他人用。能变现最好，不能也没关系。

---

## 已确认的产品决策

| 决策点 | 结论 |
|---|---|
| Chrome 扩展分发 | 上 Chrome Web Store（$5 开发者费 + ~1周审核） |
| Mac 支持范围 | 只做 Apple Silicon（arm64） |
| 变现模式 | Gumroad pay-what-you-want + GitHub Release 免费 + landing page 放打赏链接 |
| 开机自启 | 加上（已实装到代码中） |
| Code signing | 暂不做（$99/年 Apple Developer Program），先以 unsigned 方式发布 |

---

## 已完成的工作

### 代码改动（已写入文件，未 build）

1. **`widget/main.js`** — 重写
   - 加了 `app.setLoginItemSettings()` 开机自启，首次启动默认开启
   - 偏好持久化到 `prefs.json`（存在 `app.getPath('userData')` 下）
   - 右键菜单（native context menu）：Launch at Login 切换、Open claude.ai Usage Page、Reload Widget、版本号、Quit
   - WebSocket 连接状态通知 renderer（`connection-change` IPC 事件）

2. **`widget/preload.js`** — 新增暴露：`showContextMenu()`、`getAutoStart()`、`setAutoStart()`、`onConnectionChange()`

3. **`widget/index.html`** — 重写
   - 更好的空状态："Extension not connected" vs "Waiting for data…" 两种不同提示
   - 绿色 pulse 点在未连接时变灰
   - 右键任意位置 → 弹出原生菜单
   - 每 10 秒刷新 "Xs ago" footer
   - 各控件加了 tooltip

4. **`widget/package.json`** — 版本跳到 1.2.0，加了 `--arm64` flag，显式设置 `"identity": null`（跳过 code signing）

5. **`extension/manifest.json`** — 版本跳到 1.2.0，去掉了多余的 `tabs` 权限（只留 `storage` + `host_permissions`），加了 128px icon 和 homepage_url

6. **`extension/` 图标** — 从 `widget/icon.icns`（1024×1024 源文件）重新生成了 16/32/48/128px PNG，替换了之前的占位符图标

### 文案素材（已写入 `release-assets/` 文件夹）

| 文件 | 说明 | 状态 |
|---|---|---|
| `release-assets/chrome-web-store/listing.md` | CWS 上架需要的所有文案：标题、短描述、长描述、权限 justification、数据披露勾选项、截图指导 | ✅ 可用 |
| `release-assets/privacy/privacy-policy.html` | 隐私政策页面（CWS 强制要求有 privacy policy URL） | ✅ 可用 |
| `release-assets/setup-readme/README.md` | 面向非技术用户的安装指南（3 步 2 分钟） | ✅ 可用 |
| `release-assets/setup-readme/TROUBLESHOOTING.md` | 常见问题排查 | ✅ 可用 |
| `release-assets/gumroad/gumroad-listing.md` | Gumroad 产品页所有文案 + 购买后邮件 + 退款政策 | ✅ 可用 |
| `release-assets/landing-page/index.html` | 单文件 landing page，可直接部署到任何静态托管 | ✅ 可用 |
| `release-assets/landing-page/privacy.html` | 隐私政策页面（landing page 子页面） | ✅ 可用 |

---

## 待完成的工作（按执行顺序）

### 第一阶段：Build + 本地验证

```bash
# 1. 进入 widget 目录
cd claude-hud-v2/widget

# 2. 安装依赖（如果 node_modules 不完整）
npm install

# 3. 构建 arm64 dmg
npm run build

# 4. 产物在 widget/dist/ 下，应该能看到 Claude HUD-1.2.0-arm64.dmg
ls dist/
```

构建完成后：
- 打开 dmg 安装到 Applications
- 启动 app 验证：右键菜单能弹出、开机自启默认开启、等待态文案正确
- 打开 Chrome 确认扩展还能正常连接、数据能流通

### 第二阶段：Chrome Web Store 上架

1. 去 https://chrome.google.com/webstore/devconsole/ 注册开发者账号（需付 $5，需手机验证）
2. 把 `extension/` 文件夹打成 zip：`cd claude-hud-v2 && zip -r extension.zip extension/`
3. 在 Developer Dashboard 点 "New Item" → 上传 `extension.zip`
4. 填写所有字段——文案全在 `release-assets/chrome-web-store/listing.md` 里，逐项复制粘贴
5. 上传截图（需要 Sui 在自己 Mac 上截图，建议内容见 listing.md "Screenshots required" 部分）
6. 隐私政策 URL 填你最终部署的 privacy 页面地址
7. 提交审核（约 1 周）

### 第三阶段：分发渠道搭建（可与 CWS 审核并行）

**GitHub:**
```bash
# 创建 repo
gh repo create claude-hud --public --description "Floating usage meter for Claude.ai"
cd claude-hud-v2
git init && git add -A && git commit -m "v1.2.0 initial release"
git remote add origin <your-repo-url>
git push -u origin main

# 创建 release + 上传 dmg
gh release create v1.2.0 widget/dist/*.dmg --title "Claude HUD v1.2.0" --notes "Initial public release. Mac only (Apple Silicon)."
```

**Gumroad:**
1. 登录 gumroad.com（没账号就注册）
2. New Product → Digital Product
3. 上传一个 zip 包（包含 dmg + extension/ + README.md + TROUBLESHOOTING.md）
4. 文案全在 `release-assets/gumroad/gumroad-listing.md` 里
5. 价格设 Pay What You Want，suggested $5，minimum $0
6. Publish

**Landing page:**
- `release-assets/landing-page/` 里有完整的 `index.html` + `privacy.html`
- 部署方式推荐（任选一个）：
  - **GitHub Pages:** push 到 repo 的 `docs/` 分支 → Settings → Pages → 从 docs/ 部署
  - **Netlify:** 拖拽 `landing-page/` 文件夹到 netlify.com/drop
  - **Vercel:** `npx vercel --prod` in the landing-page folder
- 如果要用自定义域名（如 claudehud.app），买域名后在托管平台设置 CNAME

### 第四阶段：上线前最后检查

- [ ] landing page 上的 Gumroad 链接指向真实产品页
- [ ] landing page 上的 GitHub 链接指向真实 repo
- [ ] README 里的 Chrome Web Store 链接指向真实 listing（审核通过后更新）
- [ ] privacy policy URL 能打开
- [ ] 所有地方的版本号一致（1.2.0）
- [ ] 所有地方的联系方式一致（hello@claudehud.app 或你想用的邮箱）
- [ ] Gumroad 下载的 zip 解压后能正常走完安装流程

---

## 需要 Sui 自己做的事（Claude 不能代做）

1. **付 $5** 注册 Chrome Web Store 开发者账号
2. **手机验证码** — CWS 和 Gumroad 注册时会验证身份
3. **截图** — HUD 运行在你桌面上的截图，用于 CWS listing 和 Gumroad 封面
4. **买域名**（可选）— claudehud.app 或类似域名，约 $12-20/年
5. **最终 review** — 在我点 "Publish" / "Submit for Review" 之前看一眼内容

---

## 文件结构速查

```
claude-hud-v2/
├── extension/                          # Chrome 扩展（已改好，可打 zip 上传 CWS）
│   ├── manifest.json                   # v1.2.0, 去掉了 tabs 权限
│   ├── background.js                   # WebSocket bridge（未改动）
│   ├── content.js                      # DOM scraper（未改动）
│   ├── popup.html / popup.js           # 扩展弹窗（未改动）
│   └── icon{16,32,48,128}.png          # 从 1024px 源重新生成
│
├── widget/                             # Electron app（已改好，需重新 build）
│   ├── main.js                         # 加了自启 + 右键菜单 + 连接状态
│   ├── preload.js                      # 新增 IPC 暴露
│   ├── index.html                      # 改了空状态 + 右键菜单 + pulse 指示器
│   ├── package.json                    # v1.2.0, arm64 target
│   └── icon.icns                       # 未改动
│
├── release-assets/                     # 所有上架/分发素材
│   ├── chrome-web-store/listing.md     # CWS 上架文案 + 权限 justification
│   ├── privacy/privacy-policy.html     # 隐私政策
│   ├── setup-readme/README.md          # 用户安装指南
│   ├── setup-readme/TROUBLESHOOTING.md # 排错指南
│   ├── gumroad/gumroad-listing.md      # Gumroad 产品页文案
│   └── landing-page/                   # 单页 landing page + privacy 子页
│       ├── index.html
│       └── privacy.html
│
└── HANDOFF-TO-CODE.md                  # ← 你正在读的这个文件
```

---

## 给 Claude Code 的启动 prompt（直接贴）

```
我有一个叫 Claude HUD 的 Mac 桌面工具项目，在我当前目录下的 claude-hud-v2/ 文件夹。请先读一下 claude-hud-v2/HANDOFF-TO-CODE.md，里面有完整的项目背景、已完成的工作、和待完成的任务清单。我们从第一阶段"Build + 本地验证"开始执行。
```
