# 柚 · Justyou —— 个人摄影博客

Astro 纯静态摄影站。内容与代码分离，照片由本地脚本导入，文字在 `/admin`（Decap CMS）维护，
托管在 Cloudflare Pages（push 即上线）。设计见 `doc/designv0.0.1.md`。

---

## 1. 本地环境要求（面向"会装软件、不写代码"的你）

只需要装一次 Node.js，之后改内容、看预览、发布都不用再碰命令行以外的东西。

### 第 1 步：下载 Node.js（LTS 长期支持版，主版本 24）

1. 打开浏览器访问 <https://nodejs.org/en/download>
2. 选择 **Windows** → **`.msi` 安装包（x64）**，文件名形如 `node-v24.xx.xx-x64.msi`。
   - 认准页面上标注 **LTS** 的那个版本；本项目要求主版本为 **24**（见 `package.json` 的 `engines.node`）。
   - 如果你在用 macOS：同样在上面的页面选 **macOS + `.pkg`**（Apple 芯片选 Arm64，Intel 芯片选 Installer）。

### 第 2 步：安装

1. 双击下载好的 `.msi`，一路点 **Next / 我接受协议 / Install**，全部用默认选项即可。
2. 安装过程会自动帮你配置好命令行环境（包括 `npm`），**不需要**你去改任何"环境变量"或"PATH"。
3. 装完后 **关掉再重新打开** 一次终端（PowerShell 或 Git Bash），否则新版本不会被识别。

### 第 3 步：确认装好了

在终端里输入下面一行，然后按回车：

```bash
node -v
npm -v
```

看到 `v24.x.x` 和一个 `11.x.x` 之类的数字，就说明成功了。
如果提示"不是内部或外部命令 / command not found"，请回到第 2 步重装，并记得**重开终端**。

### 第 4 步：装项目依赖（也只需一次）

在项目文件夹里打开终端（PowerShell 里可按住 Shift 右键空白处 →"在此处打开 PowerShell"；
或装了 Git 就右键 → "Git Bash Here"），执行：

```bash
npm install
```

看到进度条跑完、没有红色 `ERR!` 字样，就完成了。

---

## 2. 日常命令一览

在项目文件夹的终端里执行：

| 想做的事 | 命令 | 说明 |
| --- | --- | --- |
| 本地看网站 | `npm run dev` | 启动后终端会给出 `http://localhost:4321`，用浏览器打开即可；改文件后页面自动刷新。按 `Ctrl` + `C` 停止。 |
| 正式构建 | `npm run build` | 产物输出到 `dist/`（该目录不进 Git）。 |
| 预览构建结果 | `npm run preview` | 先在浏览器看"上线前"的最终静态产物。 |
| 导入新照片 | `npm run import` | 把相机导出的原图丢进 `raw/` 后执行。**脚本本体由 import-photos 模块实现**，此命令入口已预留。 |
| 跑单元测试 | `npm run test:run` | Vitest，用例在 `tests/unit/`。 |
| 跑测试覆盖率 | `npm run coverage` | 需要 `@vitest/coverage-v8`，已装。 |
| 跑端到端冒烟 | `npm run test:e2e` | Playwright + `astro preview`，用例在 `tests/e2e/`。首次需先执行 `npm run test:e2e:install` 下载 Chromium。 |

发布流程：本地 `npm run dev` 确认 → `git add` / `git commit` / `git push` → Cloudflare Pages 自动构建上线。

### 附：本机 npm 报 `ECONNREFUSED 127.0.0.1:7897` 时（排障，可选）

说明：这是**本机全局 npm 配置**里写了一个本地代理（`C:\Users\luo\.npmrc` 的 `proxy` / `https-proxy`），
而那个代理程序当时没在运行。跟本项目无关，也**不需要**改全局配置。只在这次命令里临时绕过即可：

```bash
# PowerShell
$env:npm_config_proxy = "false"; $env:npm_config_https_proxy = "false"; npm install

# Git Bash
npm_config_proxy=false npm_config_https_proxy=false npm install
```

（把代理程序开起来，或把上面两个变量清掉，就恢复正常。）

## 3. 目录约定（design §3）

```
src/content/series/   系列条目（每个系列一个资源夹）
src/content/posts/    随笔 Markdown
src/components/       纯 UI 组件
src/layouts/          页面骨架
src/styles/           设计变量（视觉阶段只改这里 + 组件）
src/pages/            路由页面
scripts/              工具脚本（import-photos.mjs 在此）
public/admin/         Decap CMS 前端与 config.yml
raw/  thumbs/         本地素材区，已被 .gitignore 排除，不进仓库
astro.config.mjs      构建与图片规格参数（唯一的图片参数出处）
```

**图片规格只有一处**：展示版长边 2560px、缩略图长边 800px、输出格式 WebP，全部定义在
`astro.config.mjs`（导出 `IMAGE_SPECS` 等具名常量供脚本与工具函数 import）。
以后"想更清晰/换格式"，只改这一个文件再重新构建即可。
