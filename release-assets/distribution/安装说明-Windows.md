# HUD for Claude — Windows 安装说明

桌面上的一个小窗，实时显示你的 Claude 用量：session / weekly 配额、今天烧了多少、按模型分解、30 天走势、以及累计总额。

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
Test-Path "$env:USERPROFILE\.claude\.credentials.json"
```

返回 `True` 才继续。返回 `False` 就先去 https://claude.com/claude-code 装好并登录一次。

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

| 操作 | 效果 |
|---|---|
| **点顶部大数字** | 在「美元」和「token 数」之间切换 |
| **↻ 刷新**（三个圆点左边，很淡） | 立刻重新读一次 |
| **🟢 绿点** | 锁定不透明 —— 默认鼠标移开会淡下去，锁上就一直清晰 |
| **🟡 黄点** | 极简模式 —— 只剩两条配额进度条 |
| **🔴 红点** | 退出 |
| **右键** | 开机自启、Pet、关于 |
| **拖窗口边角** | 缩放。够宽会自动变两栏，压扁会自动精简 |

---

## 那个美元数字是什么意思

**不是账单。** 你是订阅制，每月固定收费。

那个数字是「**如果这些用量按 API 标价计费，会是多少钱**」—— 也就是你从订阅里榨出了多少价值。计算按 Anthropic 的真实计费规则加权：cache 读取算 0.1 倍、cache 写入算 2 倍。

---

## 隐私

**没有任何数据离开你的电脑。** 没有服务器、不上传、不统计。

- 配额：用你本机 Claude Code 的凭证，直接问 Anthropic 你自己账号的额度
- 用量：读你本机 `%USERPROFILE%\.claude\projects\` 下的记录

---

## 跟 macOS 版的差异（诚实清单）

| | macOS | Windows |
|---|---|---|
| 配额来源 | 系统钥匙串 | `%USERPROFILE%\.claude\.credentials.json` |
| 用量来源 | 一样 | 一样 |
| 背景 | 系统原生毛玻璃 | 无（Windows 没有这个 API） |
| 字体 | SF Pro / SF Mono | Segoe UI / Cascadia Mono |

**毛玻璃这一项实际看不出来** —— 面板底色本来就 95.5% 不透明，透出来的不到 5%。两版并排放在花背景上对比过，几乎分辨不出。

> ⚠️ **诚实说明**：这个 Windows 版是在 macOS 上交叉编译的。可执行档格式、凭证读写路径、界面渲染都验证过了（凭证那条是在模拟 Windows 环境下跑真实代码测的，读写、token 轮换、文件权限、原子写全部通过），**但没有在真的 Windows 机器上跑过**。如果遇到任何异常，请回报。

---

## 故障排查

**PowerShell 报 "无法加载文件，因为在此系统上禁止运行脚本"** → 没加 `-ExecutionPolicy Bypass`。用上面那行完整命令。

**"Windows protected your PC" 蓝窗** → 第 2 步，点 More info → Run anyway。

**配额两条一直空白** → 凭证文件不在。跑第 0 步那条 `Test-Path` 确认。也可能只是 Claude Code 的 token 过期了 —— 开一次 Claude Code 就会自动续上。

**数字全是 0** → 这台机器还没用过 Claude Code。

**窗口不见了** → 可能被拖出屏幕，或按到让它淡掉了。退出重开会回到右上角。

---

## 系统要求

- **Windows 10 或 11，64 位（x64）**
- 已安装并登录过 Claude Code
