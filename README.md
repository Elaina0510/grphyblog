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
| 导入新照片 | `npm run import -- --series <系列标识>` | 把相机导出的原图丢进 `raw/` 后执行，脚本自动压图 + 缩略图 + 读 EXIF 并写入内容夹。**原图不会被移动或删除。** 详见下面第 3 节。 |
| 跑单元测试 | `npm run test:run` | Vitest，用例在 `tests/unit/`。 |
| 跑测试覆盖率 | `npm run coverage` | 需要 `@vitest/coverage-v8`，已装。 |
| 跑端到端冒烟 | `npm run test:e2e` | Playwright + `astro preview`，用例在 `tests/e2e/`。首次需先执行 `npm run test:e2e:install` 下载 Chromium。 |

发布流程：`npm run import` 导入照片 → 本地 `npm run dev` 确认 → 去掉草稿标记 → `git add` / `git commit` / `git push` → Cloudflare Pages 自动构建上线。完整步骤看下面第 3 节。

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

## 3. 发布流程（照片 + 文字）

> 一句话：**照片用本地脚本进仓库，文字在 `/admin` 后台改**。两边都不用手拖图片、不用手写路径。
> 下面每条命令都在项目文件夹的终端里执行（PowerShell 或 Git Bash 都行，命令写法一样）。

### 第 1 步：把原图丢进 `raw/`

相机（或 Lightroom 导出）把这一批要发的照片拷进项目根目录的 `raw/` 文件夹。

- 支持 `.jpg` / `.jpeg` / `.png`。
- 手机/相机导出的 **HEIC 暂不支持**：请在相机里把格式设成 JPG，或用 Lightroom / 照片 App 导出一份 JPG 再丢进来。
- `raw/` 里放多大都行（原图有几百 MB 也没关系）——**这个文件夹永远不会进 Git**，原图只留在你自己电脑上。

### 第 2 步：跑一条导入命令

发**系列**（一个成组的作品，比如「日常帧」）：

```bash
npm run import -- --series daily-frames
```

给新随笔**补插图**（随笔正文你自己写，插图走同一条通道）：

```bash
npm run import -- --post 2026-09-24-evening-stroll
```

- 标识（`daily-frames` / `2026-09-24-evening-stroll`）只能用字母、数字、中文和 `- . _`；随笔标识建议按 `日期-标题` 写，脚本会自动把前面的日期当成条目日期。
- 命令里 `--` 是给 npm 用的分隔符，**不要漏**；漏了参数传不进来脚本会改问你要（交互式问「导到系列还是随笔、标识是什么」）。
- 系列或随笔还不存在？脚本会**当场建好目录并生成一份带 `draft: true`（草稿）标记的骨架文件**，你之后只需在里面补标题手记。想顺手给个好标题可以加 `--title "日常帧 · Daily Frames"`。
- **放心重复跑**：脚本只处理 `raw/` 里"还没导入过"的新图，已经导入的会原样跳过并打印「新增 0 张、跳过 N 张」。重复运行不会重复压图、不会把照片搞乱。
- **原图不会被移动、重命名或删除**：`raw/` 里的东西跑完之后还在原地，备份还是你自己的事（移动硬盘/网盘定期拷一份）。

跑完会在终端打一份**导入清单**，长这样（每张图的尺寸和文件大小都在预算内）：

```
结果：新增 5 张、跳过 0 张。
  + P1230857 → photos/P1230857.webp（1922×2560，342.9KB） + photos/P1230857.thumb.webp（601×800，41.6KB）
```

照片实际被放到了这里（**进 Git 的只有这些压缩产物**，Markdown + 图，原图不进）：

```
src/content/series/daily-frames/photos/P1230857.webp          展示图（长边 2560）
src/content/series/daily-frames/photos/P1230857.thumb.webp    缩略图（长边 800）
src/content/series/daily-frames/photos.meta.json              EXIF sidecar（灯箱用）
src/content/series/daily-frames/index.md                      系列条目（新建时是草稿骨架）
```

> `photos.meta.json` 是脚本生成和维护的（记着每张图的拍摄参数和像素宽高，页面和灯箱从这儿取数）。
> **不要手工编辑它**，也不要从后台改——要改 EXIF 口径就改脚本再重跑。

### 第 3 步：本地预览确认

```bash
npm run dev
```

浏览器打开 <http://localhost:4321> 看效果，看完按 `Ctrl` + `C` 停掉。

> 注意：草稿状态（`draft: true`）的条目**不会出现在页面上**，这是故意的。
> 想先把刚导入的照片看一眼，就把那个文件里的 `draft: true` 临时改成 `false` 再刷新，看完改回来即可。

### 第 4 步：去掉草稿标记（发布）

打开这个系列/随笔的 Markdown 文件，把 frontmatter 里的 `draft: true` 改成 `draft: false`（或直接删掉这一行），顺手把标题、标签、手记写完。
这一步之后也可以在 `/admin` 后台做（后台只经手文字，不经手照片）。

### 第 5 步：推上去自动上线

```bash
git add src/content
git commit -m "photo: 导入日常帧系列 5 张"
git push
```

Cloudflare Pages 检测到 push 就自动构建上线，几分钟后刷新线上地址即可看到。

> 想更清晰 / 更省流量 / 换图片格式：只改 `astro.config.mjs` 里的 `DISPLAY_QUALITY` / `THUMB_QUALITY` /
> 长边常量，然后**重新跑一次 `npm run import`**（注意：已导入的图会被幂等跳过，要整批重压就先删掉
> 对应条目 `photos/` 里的产物再跑）。改完记得 `npm run test:run` 确认体积预算仍然达标。

## 4. 目录约定（design §3）

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
