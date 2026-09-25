# 柚 · Justyou —— 个人摄影博客

Astro 纯静态摄影站。内容与代码分离，照片由本地脚本导入，文字在 `/admin`（Sveltia CMS）维护，
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
| 正式构建 | `npm run build` | 产物输出到 `dist/`（该目录不进 Git）。构建前会自动跑一次图片来源检查（`prebuild`）。 |
| 查照片来源 | `npm run check-images` | 确认 `src/content` 里每张图片都出自 `npm run import`（有 EXIF sidecar 登记），`public/` 里也没有混进图片。发现"别处来的图"就报错退出，`npm run build` 也会因此中断。见下面第 6 节。 |
| 预览构建结果 | `npm run preview` | 先在浏览器看"上线前"的最终静态产物。 |
| 导入新照片 | `npm run import -- --series <系列标识>` | 把相机导出的原图丢进 `raw/` 后执行，脚本自动压图 + 缩略图 + 读 EXIF 并写入内容夹。**原图不会被移动或删除。** 详见下面第 3 节。 |
| 跑单元测试 | `npm run test:run` | Vitest，用例在 `tests/unit/`。 |
| 跑测试覆盖率 | `npm run coverage` | 需要 `@vitest/coverage-v8`，已装。 |
| 跑端到端冒烟 | `npm run test:e2e` | Playwright + `astro preview`，用例在 `tests/e2e/`。首次需先执行 `npm run test:e2e:install` 下载 Chromium。 |

发布流程：`npm run import` 导入照片 → 本地 `npm run dev` 确认 → 去掉草稿标记 → `git add` / `git commit` / `git push` → Cloudflare Pages 自动构建上线。完整步骤看下面第 3 节；
**第一次上线要做的账号操作（GitHub 建仓、Pages 连接）与回滚**看下面第 5 节，逐项点网页的细节看 `doc/account-setup.md`。

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
public/admin/         Sveltia CMS 前端与 config.yml
raw/  thumbs/         本地素材区，已被 .gitignore 排除，不进仓库
astro.config.mjs      构建与图片规格参数（唯一的图片参数出处）
```

**图片规格只有一处**：展示版长边 2560px、缩略图长边 800px、输出格式 WebP，全部定义在
`astro.config.mjs`（导出 `IMAGE_SPECS` 等具名常量供脚本与工具函数 import）。
以后"想更清晰/换格式"，只改这一个文件再重新构建即可。

## 5. 部署与回滚（上线只做一次，之后只管 push）

> 一句话：**代码放在 GitHub 的公开仓库里，Cloudflare Pages 盯着这个仓库——你一 push，它就自动构建上线。**
> 想退回旧版本，就在 GitHub 网页上点几下"回滚"，同样自动生效。**日常发布不用登录 Cloudflare。**
> 每一步"点哪个按钮、填什么框、看到什么才算对"的细粒度清单在 **`doc/account-setup.md`**；下面只是骨架。

### 5.1 一次性上线（照 `doc/account-setup.md` 做，约 20 分钟）

1. **GitHub 建一个空的公开仓库**（仓库名建议就叫 `grphyblog`）。
   - **必须是 Public**：网站本来就是给外人看的，后台 `/admin` 的门槛靠 GitHub 授权来管，不靠"把仓库藏起来"。
   - 建仓时 **README / .gitignore / License 三个开关一个都别碰**。本地已经有 `.gitignore` 了，远端再加一份会打架。
2. **把本地仓库推上去**（⚠️ 这一步会把内容放到公网，**执行前请你确认**；命令在项目目录的 Git Bash 里跑）：

   ```bash
   git status                       # 先看一眼：不该有 raw/ thumbs/ 的东西冒出来
   git remote add origin <仓库地址>  # 只跑一次，把本地和 GitHub 连起来
   git push -u origin main          # 上传；第一次会弹浏览器让你登录 GitHub 授权
   ```

   推完到 GitHub 页面上确认：`package-lock.json` 和 `.nvmrc` 这两个文件**必须在**，
   `raw/`、`thumbs/` 这两个目录**必须不在**。
3. **Cloudflare Pages 连上这个仓库**：登录 <https://dash.cloudflare.com/> → 左侧 **Workers & Pages** →
   **Create** → 选 **Pages** 标签 → 连 Git → 选 `grphyblog`，然后**照抄这几格**：

   | 界面字段 | 填什么 |
   | --- | --- |
   | Production branch | `main` |
   | Framework preset | `Astro`（下拉没有就选 `None`） |
   | Build command | `npm run build` |
   | Build output directory | `dist` ← 漏了这一格，上线就是整站 404 |
   | Environment variables | `NODE_VERSION` = `24`（与 `.nvmrc`、`engines.node` 三处同一口径） |

4. 等 1~3 分钟构建变绿 → 打开给的免费域名（形如 `https://grphyblog.pages.dev`）验收 6 类页面。
   免费档特点：静态内容与流量不加钱，只有一"每月构建次数"的上限，本项目日常用不满。

### 5.2 Node 版本为什么会写两份

云端构建要用哪个 Node，由仓库根目录的 **`.nvmrc`**（内容就是一行 `24`）决定，Cloudflare Pages 会主动读它；
本地则看 `package.json` 的 `engines.node: "24"`。两处数字必须一样，否则最常见的现象是
"本地 `npm run build` 好好的，云端构建直接报错"。不放心就在 Pages 的环境变量里再加一条 `NODE_VERSION=24` 兜底。
`npm run test:run` 里有一条断言专门盯着这件事（`.nvmrc` 存在、值是 24、且没被 `.gitignore` 吃掉）。

### 5.3 以后每次发布（你只用记这四条命令）

```bash
git status
git add src/content
git commit -m "photo: 导入日常帧系列 5 张"
git push
```

推完等 1~2 分钟，刷新线上地址（`Ctrl` + `F5` 强刷，绕开浏览器缓存）就是新内容。
只想验证"链路还活着"，改一个标点再 push 一次就行（`doc/account-setup.md` 第 11 节）。

### 5.4 回滚 = 在 GitHub 网页上点几下

发现刚上线的内容有问题，**不用命令行也能退回去**。先按"坏的范围"选一条：

**A. 只有一两个文件改坏了 → 网页直接编辑回去（最省事、必然可行）**

1. 仓库里点开那个文件 → 右上角 **铅笔图标**（Edit this file）。
2. 改回原样 → 右上 **Commit changes…** → 选 **"Commit directly to the `main` branch"** → **Commit changes**。
3. 这就等于一次 push → Pages 自动构建 → 1~2 分钟后线上就回去了。

**B. 整批退回到某次提交之前 → compare 链接法**

1. 仓库 → **Commits** → 找到"最近一次还好的"那个提交 → 点它右边的 **⧉**（复制提交编号）。
2. 浏览器地址栏拼上（`Ctrl` + `L` 全选后粘贴回车）：
   `https://github.com/<你的用户名>/grphyblog/compare/main...那个编号?expand=1`
3. **Create pull request** → 标题会自动写成 `Revert to the state at …`（看到这个就说明方向对了）→ **Merge pull request**。
4. 合并本身就是一次 push → Pages 自动构建 → 1~2 分钟后线上回到旧版。

> B 这条依赖 GitHub"比较到旧提交就自动生成 Revert 标题"的行为。**要是页面提示没有可比较/可合并的更改，别硬试**，
> 回到 A，或者用命令行的 `git revert --no-edit <出问题的提交编号>` 再 `git push`（必然成功，且只留新记录、不改历史）。
> ⚠️ 唯一别做的事：用 `git push --force` / `git reset --hard`"回滚"——那会改写历史，可能顺手毁掉没备份的东西。
> 五条回滚路径的完整分工（含 Cloudflare 端的一键应急回退）见 `doc/account-setup.md` 第 6 节。

### 5.5 404 与几个已知坑

- **404 不用你配**：构建会产出 `dist/404.html`，Cloudflare Pages 认这个约定，访问任何不存在的路径
  都会显示本站那个带「回首页」按钮的页面，**不需要** `_redirects` 之类的配置文件。
- **线上整站 404** → 九成是 `Build output directory` 没填 `dist`。
- **构建失败** → 先看是不是 Node 版本不符、或 `package-lock.json` 没跟上 `package.json`（改依赖后要 `npm install` 并把锁文件一起提交）。
- **某张图本地能看、线上打不开** → 路径大小写问题（Windows 不分大小写，云端 Linux 分）。
  更多对号入座看 `doc/account-setup.md` 第 7 节排错表。
- 域名：v1 就用 `*.pages.dev` 免费子域。要换/加自定义域名，日后在 Pages 项目设置里绑，
  并把 `astro.config.mjs` 里的 `site` 改成新域名再重新构建（见 5.1 第 3 步的域名口径）。

## 6. `/admin` 内容后台（只改文字，不传照片）

线上地址 **`https://grphyblog.pages.dev/admin/`**，引擎 Sveltia CMS，用**粘贴 GitHub 访问令牌**登录
（不引 Netlify 之类的第三方代理、不自建服务器；仓库 Public，真正的门槛是"令牌所属账号对仓库有写权限"）。
> 原计划的 Decap 直连 GitHub 登录在新版里只走 Netlify 代理 → 本站（Cloudflare Pages）必挂，已改 Sveltia。详见 `doc/admin-login-setup.md`。

**后台能做的四件事**（design §4「仅文字操作」）：

1. 新建系列条目 / 随笔，写标题、日期、标签；
2. 写手记与正文（Markdown 正文区，进 `.md` 的 body，不进 frontmatter）；
3. 调 **排序权重**（数字）与 **草稿开关**（开=撤下、关=发布，等价于上线/下线按钮）；
4. 从**已入库照片**里选封面：填相对本条目的路径，如 `photos/night-01.webp`。

**后台做不到的一件事：传照片。** 全站照片只有一个通道——本地 `npm run import`
（压缩 + 缩略图 + 读 EXIF 写 `photos.meta.json`）。

「禁上传」怎么落的（三层，后台只管文字）：

- 封面字段 `cover` 是 `widget: string`（只能打字的文本框），条目表单里**没有上传/拖拽控件**；
- `photos/` 与 `photos.meta.json` 在后台不作为可编辑条目出现（系列 collection 用嵌套 + `meta.path.index_file` 只认 `index.md`）；
- 兜底：`npm run check-images`（挂在 `prebuild` 上，`npm run build` 必然经过）——`media_folder` 指的是
  `public/uploads`，一旦那里出现图片（有人硬从后台媒体库上传），构建立即失败 → 传不进生产。
  只要出现"没被 sidecar 登记"或"躺在 `photos/` 之外 / `public/` 里"的图片，同理失败。

相关文件只有三个（Sveltia 走 CDN，**不是 npm 依赖**，构建不需要联网）：

| 文件 | 作用 |
| --- | --- |
| `public/admin/index.html` | 后台页面：引入**锁定版本** `@sveltia/cms@0.221.0` + `noindex` 防收录（样式已打进 JS，无独立 CSS） |
| `public/admin/config.yml` | 后台配置：backend（GitHub + 只用令牌登录）/ 站点域名 / series 与 posts 两个 collection 的字段 |
| `scripts/check-image-sources.mjs` | 照片来源兜底检查（上面第 3 层） |

### 6.1 上线后台只需做一次（约 3~5 分钟，全程点网页）

**照 `doc/admin-login-setup.md` 做**：在 GitHub 生成一个**访问令牌（PAT，classic，只勾 `repo`）**，
push 本模块改动后打开 `/admin/` → 点「使用访问令牌登录」→ 粘贴令牌即可。
> 为什么不再走 OAuth：新版 Decap 的 GitHub 后端只认 Netlify 登录代理（`api.netlify.com/auth`），
> 本站在 Cloudflare Pages 上，那个代理回 404 → 「Login with GitHub」必然 Not Found。已改用的 Sveltia
> 支持粘贴令牌直连，不需要任何第三方代理或自建服务器。之前注册的 OAuth App 可以删掉。
> ⚠️ 令牌**绝不写进仓库任何文件**，只粘贴在你浏览器里；泄漏/换机时按 6.1 文档一键撤销重发。

### 6.2 日常：文字在后台改，照片在本地导

```bash
npm run import -- --series <系列标识>   # 照片：只在本地跑，跑完 git push 上线
# 文字：打开 https://grphyblog.pages.dev/admin/ → 用访问令牌登录 → 改 → Publish（自动 commit + 自动重建）
```

保存成功时 GitHub 会多出一条 commit，Cloudflare Pages 检测到就自动重新构建，1~2 分钟后线上生效。
改坏了就按 `doc/account-setup.md` 第 6 节回滚（后台的改动本质就是一次普通提交，回滚方式完全一样）。

### 6.3 后台的两条已知边界（不是 bug，是取舍）

- **本地 `npm run dev` 打开 `/admin/` 是 Sveltia 的「使用本地仓库」入口**（走浏览器文件系统 API），
  与线上令牌登录是两条独立通道；离线自检请改用 `npm run test:run`（含字段与 schema 对齐、无上传落点等断言）。
- **后台预览里的封面图多半显示不出来**：Astro 构建把 `src/content` 里的图交给 Vite 资源管线、输出带 hash
  的 `/_astro/xxx.webp`，CDN 上的 CMS 拿不到那份映射；保存下来的 `cover` 仍是相对路径原文，前台取图走
  `src/utils/contentImages.ts`，与后台无关。图片 URL 基准规则的同步约定见 `src/utils/imageUrl.ts` 与
  `public/admin/config.yml` 头部注释。

