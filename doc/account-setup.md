# 账号与上线操作清单（account setup）· v0.0.1

> 面向：**会装软件、会点网页、不写代码**的你。全程在 Windows 上操作，每一步都写了「点哪里 / 填什么 / 应该看到什么」。
> 覆盖：GitHub 建仓 → 本地推送 → Cloudflare Pages 自动构建 → 日常发布与回滚。
> 设计依据：`doc/designv0.0.1.md` §3（部署链）、§8（账号与环境）。

---

## 0. 先看这张分工表：哪些是你点鼠标，哪些已经做好了

| 环节 | 谁做 | 说明 |
| --- | --- | --- |
| 装 Node.js 24、装依赖、写代码与测试 | ✅ 已完成 | 见 `README.md` 第 1 节 |
| 本地 Git 仓库、11 次提交、`.gitignore` 挡住原图 | ✅ 已完成 | 工作树干净，随时可推 |
| `.nvmrc`（告诉云端用 Node 24） | ✅ 已完成 | 仓库根目录，内容就一行 `24` |
| 构建产物结构 / 404 页面 / 路径大小写的本地断言 | ✅ 已完成 | `npm run test:run`，见 `tests/unit/deployment.test.ts` |
| **注册 GitHub / Cloudflare 账号** | 🙋 你 | AI 碰不到你的邮箱和手机号 |
| **GitHub 建空仓库** | 🙋 你（网页点） | 下面第 2 节 |
| **本地关联远端并 push** | ⚠️ **对外可见动作** | 命令已备好（第 3 节），**执行前需你确认**；执行者是用户本人或主 Agent 取得明确同意后 |
| **Cloudflare Pages 连接与首次部署** | 🙋 你（网页点） | 下面第 4 节 |
| 首次部署后的线上验证、改标点验证、回滚演练 | 🙋 你（看效果） | 下面第 5、6 节 |

**为什么这么分**：整条链路里只有「推代码 + 点网页」两件事，做完之后，以后发布和回滚都不用再打开 Cloudflare 控制台。

**阅读方式**：Windows 上快捷键 `Ctrl` + `L` 是浏览器地址栏全选；下文出现的 `Win` 键就是键盘左下角那个窗户图标键。所有「复制」都是 `Ctrl` + `C`、「粘贴」是 `Ctrl` + `V`。

---

## 1. 准备两个账号（约 10 分钟）

### 1.1 GitHub 账号

1. 浏览器打开 <https://github.com/join>
2. 填 用户名 / 邮箱 / 密码 → 完成人机验证 → **Create account**。
3. 之后会进到一个有问卷的页面（"What brings you to GitHub today?"），**右上角可以整页跳过**（Close / Skip）。
4. 验证邮箱：GitHub 会发一封 "Verify your email address"，点信里的按钮即可。**不验证不影响推送，但可能影响 Pages 构建列表显示仓库**，建议顺手做掉。
5. 记下你的 **GitHub 用户名**（右上角头像 → Settings → 左侧 Account 里 "Username"）。后面很多地址要用，形如 `https://github.com/<你的用户名>/grphyblog`。

> ⚠️ 用户名会直接出现在公开网址里。介意隐私就用一个不含真实姓名的用户名。

### 1.2 Cloudflare 账号

1. 浏览器打开 <https://dash.cloudflare.com/sign-up>
2. 填邮箱 + 密码（密码规则较严：**必须同时含字母和数字，8 位以上**，别用太短的）→ **Create Account**。
3. 收验证邮件 → 点确认。
4. 登录后会问 "Which of these describes you?"（选 Professional / Hobbyist 都行）→ 随便选一个，进得去 Dashboard 就成功。
5. 它可能提示开启两步验证（2FA）。**现在可以不开**（右上角 X / 稍后），但站点上线后建议开一次。

> 免费档需要**一张能验证身份的银行卡或手机号**吗？Pages 静态托管的注册**不要求**绑卡；如果某个入口强制要求，说明那个入口是 Workers Paid 相关，回到第 4 节用 Pages 路径即可。

### 1.3 本机 Git 能不能用

按 `Win` 键 → 输入 `git bash` → 回车打开 **Git Bash**（装过 Git for Windows 就有；项目此前已在用它）。输入：

```bash
git --version
```

看到 `git version 2.x.x` 就行。**下面所有命令都在 Git Bash 里执行**，且先确认你在项目目录：

```bash
cd /d/hermeswork/grphyblog
git status
```

应该看到 `On branch main`、`nothing to commit, working tree clean`。

---

## 2. GitHub 建一个**空**仓库（必须 Public）

### 2.1 为什么必须 Public

设计要求（design §3）：网站本身就是公开的，照片页谁都能看，所以**仓库也公开**；后台 `/admin` 的写权限靠 GitHub OAuth 网关约束（那是后台上线那一步的事，见第 8 节），**不靠"把仓库藏起来"**。私有仓库还会让 Cloudflare Pages 的 Git 集成多一道授权，没必要。

### 2.2 建仓步骤

1. 打开 <https://github.com/new>（或任意 GitHub 页面右上角 **`+`** → **New repository**）。
2. 按下表填：

   | 字段 | 填什么 | 注意 |
   | --- | --- | --- |
   | Repository name | `grphyblog` | 只允许字母数字和 `-_.`。想换成别的名字可以，但**后面第 4.5 节的域名要跟着对上**。 |
   | Description | `个人摄影博客 · Astro 静态站` | 可留空，纯展示。 |
   | **可见性** | **选 `Public`** | ⚠️ 默认就是 Public，**别误选 Private**（页面上会红字提示 "Public: anyone can see"，这正是我们要的）。 |
   | Add README | **不要勾** | ⚠️ 关键：勾了远端就有内容，本地首次 push 会被拒。 |
   | Add .gitignore | **不要勾**（选 `None`） | ⚠️ 本地已有 `.gitignore`，远端再加一份会冲突/覆盖口径。 |
   | Add license | **不要勾**（选 `None`） | 同上。保持仓库"完全空"。 |

3. 点最下面绿色按钮 **Create repository**。
4. 建好后会停在 "…Quick setup" 页面，中间有一大块黄色提示："**or push an existing repository from the command line**"。**这个页面就是我们要的地方，别关。**

### 2.3 把仓库地址抄下来（HTTPS 和 SSH 两条，选一条用）

在刚建好的仓库页面上：

1. 确保左上标签是 **`<> Code`**（默认就是）。
2. 点 **Code** 按钮（绿色/深灰，右侧带 `⌄`）→ 弹出小面板。
3. 面板里有三个小标签：**Local** / **HTTPS** / **SSH**（有的版本显示为 `Clone` 区的两个标签）。
   - **HTTPS** 那一行形如：`https://github.com/<你的用户名>/grphyblog.git` → 右侧有 **复制图标** ⧉，点一下。
   - **SSH** 那一行形如：`git@github.com:<你的用户名>/grphyblog.git` → 同样点 ⧉。
4. 两条**都粘到记事本存一下**（`Win` + `R` → 输入 `notepad` → 回车）。

**用哪一条？**

- **推荐 HTTPS**：Windows 的 Git 自带"凭据管理器"，第一次 push 会自动弹浏览器让你登录 GitHub 授权，之后不用管。
- SSH 需要你先在 GitHub 上登记一次公钥（`ssh-keygen` → 复制 `~/.ssh/id_ed25519.pub` → GitHub Settings → **SSH and GPG keys** → **New SSH key** → 粘贴 → Add）。**没弄过就别走这条路**，用 HTTPS。

---

## 3. 把本地仓库推上去 ⚠️ 对外可见动作

> **这一步会把你仓库里的内容放到公网上**（此前所有提交：源码 + Markdown + 已压缩的展示图/缩略图）。
> **AI 不会、也没有代你做这一步。** 下面命令块请你确认后自己粘贴执行；如果你希望主 Agent 代跑，需要你先明确同意。

### 3.1 推之前 30 秒复核（确认原图和密钥没跟着上路）

在项目目录的 Git Bash 里：

```bash
git status
git ls-files | findstr /I "raw/ thumbs/ .env"
```

**预期**：

- `git status` 显示 `nothing to commit, working tree clean`（或列出本次部署相关的少量新文件，见 3.4）。
- 第二条命令**什么都不输出**（退出码 1 是正常的）。有输出 = 有素材被误跟踪了 → **先停下来**，把结果贴给主 Agent 处理，别急着 push。

顺手再确认要推的东西规模合理（应该只有几百个文件、几十 MB 级别）：

```bash
git count-objects -vH | findstr size-pack
git log --oneline -5
```

### 3.2 关联远端 + 首次推送（把 `<URL>` 换成 2.3 抄来的地址）

```bash
cd /d/hermeswork/grphyblog
git remote add origin <URL>
git push -u origin main
```

逐条说明：

| 命令 | 作用 | 你会看到什么 |
| --- | --- | --- |
| `git remote add origin <URL>` | 给远端起名叫 `origin` 并记下地址。**只跑一次**，写进本地配置，不会改动任何文件。 | 没任何输出 = 成功。 |
| `git push -u origin main` | 把本地 `main` 分支整体上传，并记住"以后 push 就推到这里"。 | 先是**浏览器自动弹出 GitHub 登录/授权页**（Git Credential Manager），登录并点 **Authorize**；回到终端开始 `Writing objects: 100%`，最后出现 `branch 'main' set up to track 'origin/main'`。 |

如果第一次 push 出现 `error: src refspec main does not match any` → 说明当前分支名不是 `main`，跑 `git branch --show-current` 看一下，把命令里的 `main` 换成实际分支名。

如果报 `remote origin already exists` → 说明之前已经关联过：先 `git remote -v` 检查地址对不对；地址不对才需要 `git remote set-url origin <URL>`。

如果被拒并提示 `Updates were rejected because the remote contains work that you do not have` → 说明建仓时手快勾了 README/gitignore。按下面顺序处理（只会把远端那份小文件合进来，不丢东西）：

```bash
git pull --rebase origin main
git push -u origin main
```

### 3.3 验证远端真的有内容了

浏览器刷新 <https://github.com/>`<你的用户名>`/grphyblog：

- 能看到文件树：`src/`、`public/`、`scripts/`、`tests/`、`doc/`、`README.md`、`astro.config.mjs`、`package.json`、**`package-lock.json`**、**`.nvmrc`**、`.gitignore`。
- 顶部应显示 `main` 分支、提交数 11（加上第 3.4 节的检查点会更多）。
- **绝对不该出现** `raw/` 和 `thumbs/` 两个目录（原图与本地暂存永不上网）。
- ⚠️ `package-lock.json` 与 `.nvmrc` 必须在：前者让云端 `npm ci` 装出一模一样的依赖，后者让云端知道要用 Node 24。缺任何一个，Pages 构建很可能失败。

### 3.4 关于「本次部署新增的文件」

本地产物（`.nvmrc`、`doc/account-setup.md`、README 新章节、`tests/unit/deployment.test.ts`）在 AI 交付后由**主 Agent 打检查点提交**。如果你看到 `git status` 里有这些未提交文件，正常流程是：

```bash
git add .nvmrc doc README.md tests
git commit -m "docs: 部署上线操作清单与产物断言"
git push
```

（`git push` 从第二次起就不用带 `-u origin main` 了。）

---

## 4. Cloudflare Pages：连接 Git 并设好构建参数

### 4.1 进 Pages 的入口

1. 打开 <https://dash.cloudflare.com/>，用 1.2 的账号登录。
2. 左侧竖排菜单找 **Workers & Pages**（有的界面显示为 **Compute (Workers) → Workers & Pages**；也可能在首页 "Projects & Solutions" 里）。
3. 进去后点 **`+ Create`** / **Create application** 按钮（通常在页面**上方或右侧的蓝色按钮**）。
4. 出现的页面顶部有标签：**Workers** / **Pages** / **Containers** 之类 → **选 `Pages` 标签**。
5. Pages 标签下的卡片里选 **"Build and deploy"→ 拉取/连接 Git 仓库那一张**（名字在不同版本里叫 `Pull from Git` / `Connect to Git` / `Build & deploy`）。
   - ⚠️ **别选** "Hello World" 或 "Deploy (via CLI)"，那两个不是我们要的自动构建链。

### 4.2 授权 Cloudflare 读你的 GitHub

1. 列表里若已经能看到 `grphyblog` → 直接选中它。
2. 看不到仓库 → 点 **"Manage accounts"** / **"+ Add account"** 或下方 **"Authenticate"** 按钮：
   - 跳到 GitHub 授权页 → 提示安装/授权 **"Cloudflare Workers"** GitHub App。
   - 权限范围选 **"Only select repositories"** → 勾 `grphyblog`（比"全部仓库"更保险）→ **Install / Authorize**。
3. 回到 Cloudflare，点 **Begin setup**。

**Pages 只需要"读"你的仓库**（读代码去构建），提交权在你本地 Git；这一点不用担心它乱改你仓库。

### 4.3 构建设置（**照抄，别改**）

页面会分 "Set up builds and deployments" 一块，逐格填：

| 界面字段（不同版本措辞） | 填什么 | 为什么 |
| --- | --- | --- |
| **Project name** | `grphyblog` | ⚠️ 这个名字直接决定访问域名：`grphyblog.pages.dev`。本地 `astro.config.mjs` 里的 `site` 写的就是这个值（design §3 口径）。想换别的名字可以，但**换完请按 4.6 改一次 `site` 再重构建**。 |
| **Production branch** | `main` | 只有这个分支的 push 会生成正式版。 |
| **Framework preset**（框架预设） | **`Astro`**；下拉里没有就选 **`None`** | 本项目是 Astro 7 纯静态；选 None 也完全能构建，预设只是帮填默认参数。 |
| **Build command** | `npm run build` | 和 `package.json` 里的脚本一致。 |
| **Build output directory** | `dist` | ⚠️ 必须填，且**不要**写成 `src/dist` 或 `/dist`。留空 = 整站 404 的常见原因。 |
| **Root directory** | 留空（=仓库根） | 本项目就在根，别改。 |
| **Environment variables**（环境变量） | 加一条：**`NODE_VERSION` = `24`** | 与仓库里的 `.nvmrc`（内容 `24`）和 `package.json` 的 `engines.node: "24"` 三处同一口径，双保险。 |

- 有的界面把 Build command 等藏在 **"Build advanced"** / **Settings → Builds & deployments → Builds** 里；找不到就先随便创建，然后按 4.4 之后去项目 **Settings** 里改。
- 填好点 **Save and Deploy** / **Deploy site**。

### 4.4 等首次构建

1. 页面跳到 **Deployments**，最上面那条显示 "Queued" → "Building"。
2. 看进度：点那条部署 → 右侧/下方有 **"Build logs"** / **View logs**。
3. **预期**：日志里依次出现 `npm ci` → `astro build` → 一行形如 `10 page(s) built`（页数会随你的内容增减，数字不同是正常的）→ `✓ Build completed successfully`。
4. 首次构建大约 **1~3 分钟**。状态变绿 **"Success"** 即可。
5. 变红 **"Failed"** → 直接跳第 7 节排错。

### 4.5 打开线上地址做 6 类页面验收

1. 部署成功后，页面顶部/右侧会给出地址，形如 **`https://grphyblog.pages.dev`**；也可以进 项目 → **Overview** 里点那个链接（标 "production"）。
   - 首次访问可能提示 "This site is not yet available / DNS 正在配置"，等 1 分钟刷新。
2. **逐条访问下面 6 类页面**（把域名换成你自己的）：

   | # | 页面 | 地址 | 应该看到 |
   | --- | --- | --- | --- |
   | 1 | 首页 | `https://grphyblog.pages.dev/` | 「开卷 / 精选 / 最新系列 / 最新随笔」四区；封面与照片正常显示，不是灰块 |
   | 2 | 系列列表 | `https://grphyblog.pages.dev/series/` | 系列卡片网格，带张数与年份 |
   | 3 | 系列详情 | `https://grphyblog.pages.dev/series/city-lights/` | 目次行 + 照片流；点图能开全屏灯箱 |
   | 4 | 随笔列表 | `https://grphyblog.pages.dev/posts/` | 随笔条目列表（草稿不在这里，正常） |
   | 5 | 随笔详情 | `https://grphyblog.pages.dev/posts/2026-09-21-morning-fog/` | 正文 + 内联插图；图能点开 |
   | 6 | 关于页 | `https://grphyblog.pages.dev/about/` | 版权/口径说明页 |

   > 上面 3、5 里的 `city-lights` / `2026-09-21-morning-fog` 是**当前种子内容的真实标识**。你以后新导入的照片/随笔，标识会变（列表页点进去看地址栏即可）。草稿状态的条目（`daily-frames`、`2026-08-10-foggy-morning`）**不出现**才是对的。
3. 再随手访问一个不存在的路径，例如 `https://grphyblog.pages.dev/duijiangbujian/` → 应该显示本站**那个带"回首页"按钮的 404 页**，而不是 Cloudflare 的默认错误页或纯文字 "Not Found"。（这一步对应 deployment 任务 7 的线上部分；本地已有产物断言。）
4. `/admin` **现在还打不开**，是正常的：后台（内容管理，引擎 Sveltia）属下一个模块（内容后台），上线后第 8 节再说。

### 4.6 域名与 `site` 对齐（只在改了项目名时要做）

本地 `astro.config.mjs` 顶部附近有：

```js
site: 'https://grphyblog.pages.dev',
```

如果你第 4.3 节把 Pages 项目名改成别的（例如 `justyou` → `https://justyou.pages.dev`），需要：

1. 用记事本或任意编辑器打开 `astro.config.mjs`，把这一行的网址改成你的真实域名。
2. 本地跑 `npm run test:run` 确认没红。
3. `git add astro.config.mjs` → `git commit -m "chore: 对齐 Pages 域名"` → `git push`。
4. 或者在 Cloudflare 里改：项目 → **Settings** → **Pages/Custom domains** → 把 Site Name 改回 `grphyblog`，与代码保持一致（更省事）。

> 不改也不会让站点崩，只影响规范链接（canonical）与分享卡片上的网址口径。

---

## 5. 日常发布：改内容 → push → 自动上线

上线后你的日常动作只有 4 步，**不需要再登录 Cloudflare**。

1. 本地准备内容（照片走 `npm run import`，文字直接改 `src/content/**` 或在 `/admin` 后台改，见 `README.md` 第 3 节）。
2. 本地看一眼：`npm run dev` → 浏览器开 `http://localhost:4321` → `Ctrl` + `C` 停掉。
3. 提交并推送：

   ```bash
   git status
   git add src/content
   git commit -m "photo: 新增日常帧系列 5 张"
   git push
   ```

4. 等 **1~2 分钟**（Pages 自动触发一次构建）。刷新线上地址即生效。
   - 想看它在构建：Cloudflare → 项目 → **Deployments**，最上面那条就是本次 push。
   - 想立刻确认是不是"真的没变"：按 `Ctrl` + `F5` 强制刷新（绕开浏览器缓存）。

**发布前那条 `git status` 别省**：它是"原图/密钥不入库"的最后一道人工闸（`.gitignore` 已自动挡，但每次瞄一眼更放心）。

---

## 6. 回滚：退回上一个版本

设计口径：**回滚 = 让 GitHub 上多一次"撤销改动"的提交**。它同样是一次 push，所以 Pages 会自动重新构建出旧版本。
**不登命令行、不登 Cloudflare 也能完成**（Cloudflare 那条只作应急，见 6.5）。

### 先按情形选一条路

| 你的情形 | 走哪条 | 说明 |
| --- | --- | --- |
| 就一两个文件改坏了（某段手记、某个系列的 Markdown） | **6.2 网页直接编辑回去** | 最简单、必然可行，推荐你日常用这条 |
| 那次改动是通过 Pull Request 合并进来的 | **6.1 末尾说的 PR 页面 `Revert` 按钮** | 必然可行 |
| 整批退回到某次提交之前的状态（比如刚导入的 20 张图压过头了） | **6.1 compare 链接法** | 依赖 GitHub 的自动 Revert 标题；界面不配合就转 6.2 / 6.4 |
| 想一步到位、不折腾网页 | **6.4 命令行 `git revert`** | 必然可行 |
| 线上错误内容正被人看到，先止血 | **6.5 Cloudflare 一键回退** | 临时手段，之后仍要把仓库真改回去 |

### 6.1 纯网页整站回退（compare 链接法）

1. 打开仓库 <https://github.com/>`<你的用户名>`/grphyblog。
2. 先找到**"要退回的那个状态"**：
   - 点文件列表上方的 **`⌄ Commits`**（提交列表）。
   - 每一行右侧有个 **⧉ 图标**（"Copy the full SHA"）→ 点一下，就把那次提交的 40 位编号复制了。**复制出问题前的那一次**（也就是最近一次还好的状态）。
3. 到"回滚草稿"页：把地址栏拼成下面这样（`旧提交编号` 粘成第 2 步复制的那串，`main` 就是正式分支），`Ctrl` + `L` 全选后粘贴回车：

   ```
   https://github.com/<你的用户名>/grphyblog/compare/main...旧提交编号?expand=1
   ```

   （`?expand=1` 的意思是"把差异全部展开"，一定要带。）
4. 点绿色 **Create pull request**。
   - GitHub 会把标题自动写成 **"Revert to the state at `<短编号>`"** —— 看到这个标题就说明方向对了，别改。
   - 说明栏随便写一句"回滚：照片压过头了"。
5. 在 PR 页面点 **Create pull request**（若又弹一层）→ 再点绿色 **Merge pull request** → **Confirm merge**。
6. 合并 = 一次新的 push → Cloudflare 自动构建 → 1~2 分钟后线上回到旧版。
7. 验证：强刷线上页面（`Ctrl` + `F5`），确认内容就是你要退回的那版。

> ⚠️ 诚实提示：第 3~5 步靠的是 GitHub「比较到一个旧提交 → 自动生成 Revert 标题」这个行为，而**我没法离线替你验证你当时看到的界面长什么样**。
> 如果页面提示 "There isn't anything to compare" 或者没有可合并的更改，**别硬试**，直接改用 **6.2**（单个文件）或 **6.4**（命令行，必然成功）。
>
> 另一种更短的情形：那次改动是走 **Pull Request** 合并进来的 → 打开那个 PR 页面 → 右下角 **Revert** 按钮 → GitHub 自动生成一个"回滚 PR" → **Merge pull request**。完事。

### 6.2 网页直接编辑回去（最保险：只有一两个文件坏了）

1. 在仓库文件树里点到那个文件（例如 `src/content/series/city-lights/index.md`）→ 打开。
2. 点文件右上角的 **铅笔图标**（"Edit this file"）。
   - 如果 GitHub 提示要 fork 一份，说明你**登录的不是仓库所有者的账号**——先切账号，别继续。
3. 把内容改回原样（删掉刚加的那段 / 把数字改回去）。
4. 右上角绿色 **Commit changes…** → 说明栏写"回滚：xxx" → 再点 **Commit changes**。
   - ⚠️ 选 **"Commit directly to the `main` branch"**（默认就是）。选了 "Create a new branch" 会多出一个 PR 要你自己合并。
5. 这本身就是一次 push（只不过从网页提交）→ Pages 自动构建 → 1~2 分钟后生效。

> 为什么这条最保险：它不依赖任何"GitHub 猜你想退到哪儿"的逻辑，你改成什么样，线上就是什么样。

### 6.3 不确定"原样"长什么样？先把旧版内容调出来看

仓库 → Commits → 找到那次还好的提交 → 复制它的编号 → 地址栏拼成下面这样（把最后一段换成你那个文件的路径）：

```
https://github.com/<你的用户名>/grphyblog/blob/<旧提交编号>/src/content/series/city-lights/index.md
```

看到旧版内容 → 全选复制 → 回到 6.2 的编辑框粘贴 → Commit changes。

### 6.4 命令行回滚（必然成功的兜底）

在项目目录的 Git Bash 里：

```bash
git log --oneline -10          # 最上面那条就是最近的提交，找问题那次的编号
git revert --no-edit <出问题的提交编号>
git push
```

`git revert` 只撤销那一次改动、并留下一条新记录，**不会丢历史**（比 `reset` 安全）。

> ⚠️ 不要用 `git push --force` 或 `git reset --hard` 来"回滚"：那会改写历史、可能连带毁掉本地未备份的内容。

### 6.5 应急止血（GitHub 那边来不及时）

Cloudflare 项目 → **Deployments** → 找最近一次"Success"的旧部署 → 点进去 → 右上 **`⋯`** 菜单 → **Rollback to this deployment**。
这会**立刻**把线上切回那版，但它只是临时手段（下次 push 就把它覆盖了），最终仍要用 6.1~6.4 把仓库里的内容真的改回去。此路仅作应急，**日常发布与回滚不需要登 Cloudflare**（deployment 验收标准）。

---

## 7. 首次部署失败排错表（最常见三类先列）

进 项目 → 最新一条 **Failed** 的部署 → **Build logs**，从日志最后往上看红色行。对号入座：

| 日志/现象里的关键词 | 原因 | 怎么办 |
| --- | --- | --- |
| `npm ERR! code EBADENGINE` / `Required node version 24 not found` / 构建里 Node 版本明显是 18、20 | 云端 Node 与 `engines.node` 不符，`.nvmrc` 没生效 | ① 确认远端仓库根目录**真的有 `.nvmrc`**（内容 `24`）；② 到 项目 → **Settings → Environment variables → Production** 加 `NODE_VERSION` = `24`；③ 重新部署（Deployments → 右上 **⋯** → **Retry deployment**）。 |
| `npm ci can only install with an existing package-lock.json` / `The command `npm ci` ...` / `EUSAGE ... lock file` | 锁文件缺失或与 `package.json` 不一致（改依赖没跑 `npm install`） | 本地执行 `npm install` → 把生成/更新的 **`package-lock.json`** 一起 `git add package-lock.json && git commit -m "chore: 同步锁文件" && git push`；确认它已在远端仓库里。 |
| 构建 Success，但打开站点是 **Cloudflare 的 "Not found" / 整站 404** | **Build output directory** 填错或留空 | 项目 → **Settings → Builds & deployments → Build configs** → 把 Build output directory 改成 `dist`（不带斜杠），Build command 保持 `npm run build` → Save and Deploy。 |
| `ENOENT: no such file or directory, open 'src/content/series/city-lights/...'`、或线上某张图 404 但本地能看，而日志里没有 | **路径大小写**：Windows 不分大小写，云端 Linux 分（`Photo.webp` ≠ `photo.webp`） | 本地核对报错路径的真实大小写并改成完全一致，再 `git add` → `git commit` → `git push`。（本地已有同类断言：`tests/unit/deployment.test.ts` 会拿产物里的真实文件名做精确比对。） |
| `sharp` 安装失败 / `Could not find anySharp` / `node-pre-gyp ERR!` | 原生依赖在云端重新编译超时/失败 | 先在 Deployments → **⋯ → Retry deployment** 重试一次（偶发网络）；仍失败就把 `node_modules` 相关的 `.nvmrc` / `NODE_VERSION` 复核一遍（见上面第 1 行），Node 主版本对齐后 sharp 才有对应预编译包。 |
| 卡在 `Queued` 很久、或提示超过每月构建额度 | 免费档每月构建次数有限（Pages 免费档有构建次数上限，静态流量与请求数**不限带宽**；本项目纯静态日常用不满） | 具体额度数字以 Cloudflare 定价页为准（**我没有联网核对，避免给你过期数字**）。日常把多次改动攒成一次 push 就足够省；也可在 Settings 里关掉 preview 部署省额度。 |
| 提交列表里看不到自己的仓库 | GitHub App 授权范围没含这个仓库 | Cloudflare → 项目 → **Settings → Source → Edit**，或回 GitHub **Settings → Applications → Cloudflare Workers → Repository access** 改成含 `grphyblog` → 回到 Cloudflare 刷新。 |
| push 时报 `Permission denied (publickey)` | 用了 SSH 地址但没登记公钥 | 改回 HTTPS：`git remote set-url origin https://github.com/<你的用户名>/grphyblog.git` → 重新 `git push`（会弹浏览器授权）。 |

**万能重试**：项目 → **Deployments** → 右上 **`⋯`** → **Retry deployment**（会重新拉最新提交再构建一次）。

---

## 8. 两条不能破的安全红线（本清单不越界）

1. **原图与密钥永不入库。** `raw/`（相机原图）与 `thumbs/`（本地暂存缩略图）已被 `.gitignore` 排除，进仓库的只有压缩产物（`.webp` + `.thumb.webp`）与 Markdown。第 3.1 节那两条命令就是复核这件事；每次 push 前看一眼 `git status`。备份是你自己的事——原图只在你的硬盘上，定期拷一份到移动硬盘/网盘。
2. **`/admin` 后台登录用的 GitHub 访问令牌（PAT）不在这份清单里生成。** 它是后台上线那一步（内容后台模块，门禁 Gate D）才做的事，逐步指引在 `doc/admin-login-setup.md`：后台引擎是 Sveltia，登录方式=在 `/admin/` 粘贴一个只勾 `repo` 权限的**个人访问令牌**（PAT），**不注册 OAuth App、不用 client_secret、不引入 Netlify 等第三方代理**。真正的门槛是"这个令牌所属的 GitHub 账号必须对仓库有写权限"——所以那一步会同时提醒你把仓库写权限只留给自己。本清单不做。

---

## 9. 域名策略（v1 明确不做的事）

- v1 只用 `*.pages.dev` 免费子域（第 4.3 节的 Project name 决定它）。
- 自定义域名（例如 `photo.xxx.com`）留 TODO：以后在 Cloudflare 项目 → **Settings → Pages/Custom domains → Set up a domain**，按提示加一条 DNS 记录即可，届时再改 `astro.config.mjs` 的 `site` 并重构建（见 4.6）。

---

## 10. 做完请回填这三行（贴回给主 Agent）

```
GitHub 仓库地址      = ______________________________
Cloudflare Pages 域名 = ______________________________
最后一步看到什么     = ______________________________   （例：6 类页面全通、404 页正常 / 卡在构建日志的某一行）
```

顺手勾掉这几项，方便对进度（对应 `doc/tasksv0.0.1/deployment.md`）：

| 任务 | 你的动作 | 状态 |
| --- | --- | --- |
| 2 推送主分支、确认 `.gitignore` 生效 | 第 3 节 | ☐ |
| 3 Pages 构建设置（`npm run build` / `dist` / Node 24） | 第 4.3 节 | ☐ |
| 4 首次构建通过 + `*.pages.dev` 6 类页面可访问 | 第 4.4、4.5 节 | ☐ |
| 5 改一个标点 → push → 1~2 分钟生效 | 第 5 节（标点验证见下面第 11 节） | ☐ |
| 6 回滚演练 | 第 6 节（日常最省事的是 6.2） | ☐ |
| 7 线上 404 路由确认 | 第 4.5 节第 3 条 | ☐ |

## 11. 链路验证的"最小改动"演练（deployment 任务 5）

只想验证"push 真的会自动上线"，别改重要内容：

1. 用记事本打开 `src/content/posts/2026-09-21-morning-fog.md`，在**正文最后**改一个真实存在的字符：把某个句号改成感叹号，或把某个"的"改成"之"——**必须有至少一个字符的差别**（加了又删等于没改，`git status` 是干净的，也就不会触发构建）。
2. 在项目目录 Git Bash：

   ```bash
   git status
   git add src/content/posts/2026-09-21-morning-fog.md
   git commit -m "test: 验证发布链路"
   git push
   ```

3. 等 1~2 分钟 → 打开 `https://grphyblog.pages.dev/posts/2026-09-21-morning-fog/` → `Ctrl` + `F5` → 看到那个改动就说明链路通了。
4. 想撤销这次演练：照第 6.2 节把那个字符改回去再提交一次最省事（或第 6.4 节 `git revert`）。

---

### 附：这份清单里哪些是"确定的"、哪些要你自己看一眼

- **确定**（本地已实测）：构建命令、输出目录、6 类页面路径、404 产物、Node 版本三处对齐、`.gitignore` 生效。跑 `npm run build` 与 `npm run test:run` 即验证（见 `tests/unit/deployment.test.ts`）。
- **要你自己看一眼**：GitHub / Cloudflare 网页的**按钮措辞和位置会变**（界面按 2026 年中的形态写，每个关键步骤我都给了替代说法和"找不到就去哪里改"的路径）；免费档**具体额度数字**我没有联网核对，以 Cloudflare 定价页为准。卡住就把**报错原文**（日志最后 10 行，或 `git push` 的完整输出）贴给主 Agent，别自己猜着改。
