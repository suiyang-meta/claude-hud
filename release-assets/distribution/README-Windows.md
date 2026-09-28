# HUD for Claude — Windows 安装说明

贴在屏幕边缘的一个小 notch，实时显示你的 Claude 用量：session / weekly 配额、今天烧了多少、按模型分解、30 天走势、以及累计总额。装了 Codex 的话，也一起显示 Codex 的 5 小时 / 每周额度。

> **如果你是帮人安装的 AI**：整份文档照着做即可。
> **最快路径**：在解压后的文件夹里打开 PowerShell，跑这一行（脚本会做完检查、安装、快捷方式三件事）：
>
> ```powershell
> powershell -ExecutionPolicy Bypass -File .\install.ps1
> ```
>
> `-ExecutionPolicy Bypass` 是必须的 —— Windows 默认不允许跑未签名的 .ps1，这个参数只对这一次调用生效，不改系统设置。
> **第 0 步是硬前提，不满足的话装了也只会看到一半的东西。**

---

## 第 0 步 · 硬前提

这个 widget **不自己登录**。它读的是你这台机器上 Claude Code 已经存好的凭证和本地记录。

**你必须已经安装 Claude Code，并且至少成功登录过一次。**

在 PowerShell 里确认：

```powershell
(Get-Content "$env:USERPROFILE\.claude\.credentials.json" -Raw -EA 0) -match '"accessToken":"[^"]'
```

返回 `True` 才继续。返回 `False` 或报错，就先去 https://claude.com/claude-code 装好，然后跑一次 `claude auth login`。

> 为什么不是只看「文件在不在」：登出或过期之后，那个文件**还在**，只是里面的令牌被清成了空字符串。只检查存在与否会报 `True`，而 widget 其实一个字都读不到。上面这条命令看的是令牌本身。

**顺带确认有没有使用记录**（决定用量统计有没有数）：

```powershell
(Get-ChildItem "$env:USERPROFILE\.claude\projects" -Recurse -Filter *.jsonl -ErrorAction SilentlyContinue).Count
```

是 0 的话，配额条会正常显示，但「今日花费 / 按模型 / 30 天图」会是空的 —— 用一阵 Claude Code 就会有了。

---

## 第 1 步 · 安装

**方式 A（推荐）**：在这个文件夹里打开 PowerShell，跑：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

它会装到 `%LOCALAPPDATA%\Programs\HUD for Claude`（**不需要管理员权限**），建好开始菜单和桌面快捷方式，然后问你要不要立刻打开。

**方式 B（手动）**：把 `.zip` 解压到任意位置，双击里面的 `HUD for Claude.exe`。

## 第 2 步 · 放行 SmartScreen（**大概率会遇到**）

这个程序没有代码签名证书，所以 Windows 会弹一个蓝色的
**"Windows protected your PC"** 窗口。**它不是病毒**，这是未签名程序的标准拦截。

点 **More info**（更多信息）→ **Run anyway**（仍要运行）。只需做一次。

> 装了签名证书就不会有这个弹窗，但那要每年付费给证书颁发机构。

---

## 用法

打开后平时只在**屏幕右边缘**留一条细缝（notch），不挡东西。

### 边缘的 notch

| 操作 | 效果 |
|---|---|
| **鼠标碰一下边缘的细缝** | 展开成 notch：一个环一家（Claude、Codex），环上是用量百分比 |
| **鼠标停在环上** | 旁边出现那家的卡片：各个额度窗口、多久重置 |
| **单击环** | pin 住那张卡片（再点一下放掉）；两张可以同时 pin |
| **双击环** / 卡片右上角的放大图标 | 分离成那家的完整面板 |
| **notch 底部的小圆点** | pin 住 notch，让它一直展开 |
| **上下拖 notch，或直接拖展开的卡片** | 换位置；拖过屏幕中线就换到左边 / 右边；**拖到另一块屏幕就搬过去**。卡片上的 pin / 放大两个图标仍是纯点击 |
| **右键 notch** | pin、左右边、**放在哪块屏幕**（接了外接屏才出现）、开机自启、**登录 Claude Code / Codex**、**检查更新**、退出（`Show Dock Icon` 是 macOS 专有，Windows 上不出现） |

### 接了外接屏幕

把 notch 拖到那块屏上，它就贴到那块屏的边缘；或者右键 → **`Notch Display`** 直接选。它会记住你放在哪块屏：拔掉外接屏就回主屏幕，插回来自己回去。

### 更新（3.7.0 起不用再重装）

HUD 每隔几个小时问一次开发者的下载服务器有没有新版，有就在背景下载好。下载好之后，右键菜单最上面出现 **`Restart to Update (x.y.z)`**，Claude 面板底部也会出现一行 **`Update to x.y.z — restart`**；点它，HUD 关掉、换上新版、自己重新打开。设定全部保留。

下载是自动的，换版本一定要你点。每个新版都用开发者自己的密钥签过名，对不上就不装。右键 → **`Updates`** 可以立刻检查，或关掉自动检查。

> ⚠️ Windows 的更新流程（关掉 → 换掉 `%LOCALAPPDATA%\Programs\HUD for Claude` 整个文件夹 → 重开）跟 Mac 是同一套设计，**但没在真的 Windows 电脑上跑过**。失败的话它会把旧版放回去并告诉你原因；也可以随时照第 1 步手动装新版。
>
> 3.7.0 这一版本身还是要手动装一次 —— 旧版里没有更新功能。

### Claude 完整面板

| 操作 | 效果 |
|---|---|
| **点顶部大数字** | 在「美元」和「token 数」之间切换 |
| **↻ 刷新**（三个圆点左边，很淡） | 立刻重新读一次 |
| **🟢 绿点** | 锁定不透明 —— 默认鼠标移开会淡下去，锁上就一直清晰 |
| **🟡 黄点** | 极简模式 —— 只剩两条配额进度条 |
| **🔴 红点** | 收回边缘（**退出**在右键菜单里） |
| **右键** | 开机自启、Pet、notch 设定、关于、退出 |
| **拖窗口边角** | 缩放。够宽会自动变两栏，压扁会自动精简 |

Codex 面板只有两条额度（5 小时、每周）和它们的重置时间；右上角 ✕ 收回边缘。

### 资源占用

空闲时约 **1% 单核 CPU、160 MB 内存**（在 Mac 上实测；Windows 未测）。宠物和它的小按钮只在面板打开时才存在，收回去就销毁。

### Codex（可选）

这台电脑上装过 **Codex**、并且**用 ChatGPT 账号登录过**，notch 就会多出第二个环；没有的话就只有 Claude，不影响使用。

---

## 那个美元数字是什么意思

**不是账单。** 你是订阅制，每月固定收费。

那个数字是「**如果这些用量按 API 标价计费，会是多少钱**」—— 也就是你从订阅里榨出了多少价值。计算按 Anthropic 的真实计费规则加权：cache 读取算 0.1 倍（Fable 5.1 是 0.025 倍）、cache 写入算 2 倍。

---

## 两组数字，范围不一样

| | 算的是什么 |
|---|---|
| **配额条**（current session / weekly %） | 你**整个账号**：claude.ai 网页、Claude App、手机、别的电脑上的 Claude Code，全部加总 |
| **token / 美元 / 按模型 / 30 天 / lifetime** | **只算这台电脑上的 Claude Code**（读 `%USERPROFILE%\.claude\projects\` 里的对话记录） |

所以平常主要在 claude.ai 或 Claude App 里聊天的话，配额条会一直涨、token 数却几乎不动 —— 是范围不同，不是坏了。

**lifetime 能追溯多远，取决于 Claude Code 留了多久。** Claude Code 默认只保留 30 天的对话记录（设定叫 `cleanupPeriodDays`），更早的在你装 HUD 之前就被它删掉了，谁都找不回来。从 3.2.1 起，HUD 读到过的每一笔都会一直留着，不会再跟着 Claude Code 的清理缩水。

---

## 隐私

**你的用量数据不会送到任何第三方，也不会送到开发者这边。** 不上传、不统计。唯一连到开发者那边的，是下面「检查更新」那一个请求，它不带任何关于你的资料。HUD 只做这几件事：

- 配额：用你本机 Claude Code 的凭证，直接问 Anthropic 你自己账号的额度
- 用量：读你本机 `%USERPROFILE%\.claude\projects\` 下的记录
- Codex 额度（可选）：用你本机 Codex 已存的登录（`%USERPROFILE%\.codex\auth.json`），直接问 OpenAI（chatgpt.com）你自己账号的 5 小时 / 每周额度
- Codex 登录续期（可选）：那份登录约十天到期，而且只有 Codex CLI 自己会续。所以到期前一小时，HUD 会替你向 `auth.openai.com` 换一张新的并写回那个文件 —— 整份原子改写、其它内容一律保留、写完读回来核对。不想要的话把那个文件删掉，Codex 那个环就不出现了
- 检查更新：每几个小时问一次开发者的下载服务器（Cloudflare R2 上的 `pub-73af813618eb49f9a18951f929fab6e6.r2.dev`）有没有新版，有的话从那里下载。这个请求除了任何下载都会带的东西（你的 IP、app 的版本号）之外，不带任何关于你或你用量的资料；开发者在 Cloudflare 后台只看得到请求总数，看不到是谁。右键 → `Updates` 可以关掉

---

## 跟 macOS 版的差异（诚实清单）

| | macOS | Windows |
|---|---|---|
| 配额来源 | 系统钥匙串 | `%USERPROFILE%\.claude\.credentials.json` |
| 用量来源 | 一样 | 一样 |
| 背景 | 系统原生毛玻璃 | 无（Windows 没有这个 API） |
| 字体 | SF Pro / SF Mono | Segoe UI / Cascadia Mono |

**毛玻璃这一项实际看不出来** —— 面板底色本来就 95.5% 不透明，透出来的不到 5%。两版并排放在花背景上对比过，几乎分辨不出。

> ⚠️ **本轮新增、Windows 上没实测的部分**：右键菜单那两个登录项，在 Windows 上会开一个 `cmd` 窗口跑 `claude auth login` / `codex login`。这段代码只在 Mac 上真跑过，Windows 分支是照着写的、没有机器可验。Codex 的登录续期则跟 Mac 共用同一份代码，已在真实凭证上完整跑通一次（换发 + 轮换 + 写回 + 读回核对）。

> ⚠️ **诚实说明**：这个 Windows 版是在 macOS 上交叉编译的。可执行档格式、凭证读写路径、界面渲染都验证过了（凭证那条是在模拟 Windows 环境下跑真实代码测的，读写、token 轮换、文件权限、原子写全部通过），**但没有在真的 Windows 机器上跑过**。如果遇到任何异常，请回报。

---

## 故障排查

**PowerShell 报 "无法加载文件，因为在此系统上禁止运行脚本"** → 没加 `-ExecutionPolicy Bypass`。用上面那行完整命令。

**"Windows protected your PC" 蓝窗** → 第 2 步，点 More info → Run anyway。

**配额两条一直空白，或底下写 Sign-in expired** → 那是**命令行版 Claude Code** 的登录没了，跟你桌面上开着的 Claude 无关 —— 它们各自揣着另一套登录，开着桌面 app 不会让这条活过来。跑第 0 步那条命令确认，然后**右键 HUD → `Sign in to Claude Code…`**，会开一个终端直接跑登录命令。

**数字全是 0** → 这台机器还没用过 Claude Code。

**更新没装上** → HUD 会把旧版放回原处、重新打开，并弹窗告诉你卡在哪一步。记录在 `%APPDATA%\claude-hud\update.log`。也可以照第 1 步手动装新版。

**窗口不见了** → 平时它收在屏幕边缘，只剩一条细缝，把鼠标移到右边缘（或左边缘，如果你换过边）碰一下就会展开。完整面板按红点会收回边缘，这不是关掉。

**notch 在 Windows 上的表现** → notch 的收折、pin、左右边这批新功能跟 Mac 共用同一份代码，但**只在 Mac 上实际测过**。Windows 上如果展开动画、点击穿透（notch 旁边的透明区域应该可以点到后面的东西）有异常，请回报。

---

## 系统要求

- **Windows 10 或 11，64 位（x64）**
- 已安装并登录过 Claude Code
