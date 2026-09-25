# GitHub OAuth App 注册指引（decap-cms 任务 3）· v0.0.1

> 面向：**会用网页点、不写代码**的你。全程在浏览器里做，大约 5~8 分钟。
> 目标：让线上 `https://grphyblog.pages.dev/admin/` 这个内容后台能"用 GitHub 账号登录"。
> 前置：仓库已建好并推上去、Cloudflare Pages 已能访问站点（见 `doc/account-setup.md` 第 2~4 节）。
>
> **本清单不做的事**：不引入 Netlify 或任何第三方代理；不把任何密钥写进仓库；
> 不需要你在命令行里敲任何东西（回填那一小步由主 Agent 或你复制粘贴完成）。

---

## 0. 先看这张表：谁做什么

| 步骤 | 谁做 | 做完长什么样 |
| --- | --- | --- |
| 1. 注册 OAuth App、拿 `client_id` | **你在浏览器点** | 一串 `Iv1.xxxx` 或 40 位十六进制字符，抄下来 |
| 2. 把 `client_id` 填进配置文件 | 你复制粘贴（或交给主 Agent） | `public/admin/config.yml` 里那一行去掉 `#` |
| 3. 提交 + push → Pages 自动重建 | 主 Agent / 你平时的 push 流程 | 线上 `/admin/` 出现 "Login with GitHub" |
| 4. 线上登录验收（任务 10） | 你点一下授权 + 主 Agent 核对 | 改标题 → GitHub 多一条机器人 commit → 网站自动更新 |

⚠️ 现在文件里的 `client_id` 是**注释掉的占位**，不填就是"后台打不开登录"，不会有别的副作用。

---

## 1. 开工前确认 3 件事

1. **登录的是有仓库写权限的 GitHub 账号**（就是你建 `Elaina0510/grphyblog` 那个号）。
   后台的"谁能改内容"= "这个 OAuth App 授权出去的 GitHub 账号里，谁对仓库有写权限"。
   仓库是 Public，所以别人**能看**代码，但**改不动**——没有写权限的账号登录后保存会失败。
2. 仓库确实是 **Public**（仓库首页右边 About 里勾的是 Public）。设计口径（design §3）就是公开仓库 + OAuth 挡写。
3. 你已经知道站点地址是 `https://grphyblog.pages.dev`（Pages 项目名换了的话，本清单里所有域名都要跟着换）。

---

## 2. 注册 OAuth App（照抄每个输入框）

1. 浏览器打开 **https://github.com/settings/developers**
   （路径就是：右上角头像 → **Settings** → 左侧最底下 **Developer settings** → **OAuth Apps**）
2. 右上点 **New OAuth App**。
3. 四个输入框按下面填，然后点 **Register application**：

   | 输入框 | 填什么 |
   | --- | --- |
   | **Application name** | `grphyblog admin`（随便认得出就行） |
   | **Homepage URL** | `https://grphyblog.pages.dev` |
   | **Application description**（可留空） | `个人摄影博客 /admin 后台登录用` |
   | **Authorization callback URL** | `https://grphyblog.pages.dev/admin/` ⚠️ **结尾的斜杠要保留** |

   > 为什么回调地址填 `/admin/`：这是 **implicit 流**（GitHub 直接把令牌塞在浏览器地址栏的
   > `#access_token=...` 片段里返回），它跟 Netlify 那套 `GitHub callback proxy` 不是同一路。
   > Decap 是纯前端页面，**谁来接收这个片段？就是 /admin/ 这个页面本身**——全站只有它加载了 Decap。
   > 所以回调必须落在一个真实存在、且带 Decap 的页面上，也就是 `/admin/`。
   > 如果你照本清单登录后 GitHub 报 `redirect_uri mismatch`，见第 8 节排错表（别自己猜着改域名）。
4. 注册完，页面顶部会显示 **OAuth Apps / grphyblog admin**，下面有一行
   **`Client ID`**（形如 `Iv23f...` 或 40 位十六进制）。点它右边的 📋 复制。
   👉 **整份清单里你只需要这一串。**
5. 再下面的 **Client secrets** 区块：
   - GitHub 会让你点 **Generate a new client secret**。**你可以直接跳过，不点也行。**
   - ⚠️ **绝对不要**把 secret 抄进项目里的任何文件（包括 `config.yml`、`.env`、README）。
     implicit 流用不到它；而这个目录会随站点打包上线，写进去就等于把钥匙贴在门上。
     （只有第 7 节的"本地代理自测"才会在**你本机环境变量**里临时用到它，不落仓库一个字节。）

---

## 3. 把 client_id 填进 config.yml

文件位置：项目目录里 **`public/admin/config.yml`**（用记事本 / VS Code 打开都行）。

找到 `backend:` 下面这一段（大约在第 40~50 行，紧跟在 `auth_type: github` 后面）：

```yaml
  # TODO: client_id 由 doc/github-oauth-setup.md 注册 OAuth App 后填入（去掉注释、替换尖括号）。
  #       只填 client_id；implicit 流**没有** client_secret，也**绝不**把 secret 写进本文件
  #       （本目录会随站点公开，任何 secret 都等于公开）。
  # client_id: <GITHUB_OAUTH_CLIENT_ID>
```

把**最后一行**改成（去掉开头的 `# `，把尖括号整个换成你抄来的那串）：

```yaml
  client_id: Iv23liExampleExampleExample
```

要点：
- `client_id` 前面**不能留 `#`**，缩进要和上面的 `branch: main` **一样多（两个空格）**。
- 只改这一行，别的什么都不动（YAML 靠缩进，多一个空格就报错）。
- 改完保存。这就是"填好了"。

## 4. 让改动上线

这步就是你平时发布内容的那三条命令（在**项目目录**的 Git Bash 里）：

```bash
npm run build        # 本地先确认能构建（会顺带跑图片来源兜底检查）
git add public/admin/config.yml
git commit -m "feat(decap): 填入 GitHub OAuth client_id"
git push
```

> 由主 Agent 统一提交时，把上面这两步交给它做即可，你只管确认第 3 步的文件已保存。

等 1~2 分钟 Pages 重建完成，浏览器打开 **https://grphyblog.pages.dev/admin/**
→ 应该看到 Decap 的登录页，中间一个 **"Login with GitHub"** 按钮。

---

## 5. 线上登录 + 验收（decap-cms 任务 10）

1. 点 **Login with GitHub** → 跳到 GitHub 的授权页（标题是你起的 `grphyblog admin`）
   → 权限会写着 **Public repo**（就一项，不会要 admin 权限）→ 点 **Authorize <app 名>**。
2. 自动跳回 `/admin/`，看到左侧有 **Series / Posts** 两个栏目 = 登录成功。
3. 逐项验收（**每项都该是"能改、不能传图"**）：

   | 验什么 | 怎么做 | 预期 |
   | --- | --- | --- |
   | 改文字（任务 7） | 进 `Series → 夜光 · 城市`，把标题改一个字 → 右上 **Publish** | GitHub 仓库多一条 commit（作者是你的账号），1~2 分钟后线上标题变了 |
   | 排序（任务 7） | 同一页把 **排序权重** 从 1 改成 2 → Publish | 首页/系列列表里的顺序跟着变 |
   | 发布/撤下（任务 7） | 把 **草稿开关** 打开 → Publish；再关掉 → Publish | 打开后该系列从线上消失，关闭后回来 |
   | 选封面（任务 6） | 看 **封面** 字段 | 是一个**只能打字的文本框**，没有"上传/拖拽/选择文件"按钮 |
   | 传图（任务 6） | 试着从桌面把一张 jpg **拖到后台页面上** | 没有任何上传反应；正文里也不会插入图片文件 |
   | 无 sidecar 编辑口 | 看左侧栏目和条目列表 | 找不到 `photos.meta.json` 或 `photos/`，它们不是可编辑条目 |

4. 上面全绿 = **里程碑 3（模块 11）达成**。有任何一项不对，先按第 8 节对号，再把现象贴回给主 Agent。

---

## 6. 撤销授权 / 换域名（以后可能用到）

- **换电脑或不想让它再登录**：GitHub → Settings → **Applications** → **Authorized OAuth Apps**
  → 找到 `grphyblog admin` → **Revoke**。网站本身不受影响（前台是静态的）。
- **换域名**（比如以后绑自定义域）：回第 2 节把 OAuth App 的 Homepage URL 与
  **Authorization callback URL** 改成新域名，同时改 `public/admin/config.yml` 的
  `site_url` / `display_url` 和 `astro.config.mjs` 的 `site`。三处域名必须一致。
- **删掉整个后台**：GitHub OAuth Apps 页面里那个 App 可以直接 Delete，仓库不用动。

---

## 7.（可选，任务 9）本地自测：不 push 就在本机试一遍

> 这条**不是必须**，且需要你在本机开两个终端窗口 + 一个浏览器。
> 本地实现阶段没有浏览器环境，所以这一步**标注为"需你本机人工验证"**。
> 原理：`local_backend: true`（config.yml 里已开）让 Decap 去连本机的 git gateway 代理
> `decap-server`，保存的 commit 只落在**本地仓库**，试完 `git reset` 丢弃即可。

```bash
# 终端 A（项目目录，Git Bash）：起本地代理，然后 astro dev 起站点
npm_config_proxy=false npm_config_https_proxy=false npx decap-server
# 终端 B：
npm run dev
```

浏览器打开终端 B 给出的本地地址、后面接 `/admin/`，例如 `http://localhost:4321/admin/?local_backend=true`
→ 登录（本地代理会走一次 GitHub 授权；`decap-server` 需要本机环境变量
`GITHUB_CLIENT_ID` 和 `GITHUB_CLIENT_SECRET` 才能完成这一步——**secret 只放在环境变量里，
不进仓库**；不想设环境变量的话，本地这条自测直接跳过，改做下面的"离线验证"）。

改一条文字 → 回终端跑：

```bash
git log --oneline -3      # 应该看到一条 Decap 生成的 commit
git status                # 工作树干净（内容已提交到本地）
git reset --hard HEAD~1   # ⚠️ 只丢这一条本地试错 commit；确认它就是你刚试的那条再按回车
```

**离线验证（不用代理、不用浏览器，随时能做）**——本地实现阶段已全部跑过：

```bash
npm run build             # 构建通过；dist/admin/ 里能看到 index.html 与 config.yml
npm run check-images      # 照片只出自 npm run import 的兜底检查
npm run test:run          # 422 + 本模块新增用例：字段与 schema 对齐、无上传落点、版本锁定等
```

---

## 8. 出问题对照表

| 现象 | 大概率原因 | 怎么办 |
| --- | --- | --- |
| `/admin/` 打开是空白或 404 | Pages 还没构建完；或访问的是 `/admin`（没斜杠） | 等 1 分钟强刷；地址补成 `/admin/` |
| 点登录后 GitHub 报 **`redirect_uri_mismatch`** / `error=redirect_uri_mismatch` | 第 2 节回调 URL 与实际访问地址不一致 | ① 确认你访问的是 `https://grphyblog.pages.dev/admin/`（带斜杠、https、域名一字不差）；② 还不行就把回调 URL 改成 `https://grphyblog.pages.dev/admin/` 之外的候选（`.../callback`、`.../admin/callback`）再试一次，**并把哪一条成功了告诉主 Agent**——若需要 `/callback` 这种独立路径，得额外放一个只做跳转的小页面（`public/callback/index.html`），这属主 Agent 的改动，不要自己乱建 |
| 登录后回来说 **bad state parameter** | 授权页在另一个标签/浏览器开的，本地 state 丢了 | 关掉所有相关标签，重新从 `/admin/` 点登录；别用"后退"回到授权页 |
| 登录成功但保存时报 **403 / Needs more permissions** | 授权的 GitHub 账号对仓库没有写权限（或组织仓库限制了第三方 App） | 用仓库属主账号登录；组织仓库要在 GitHub 上给该 OAuth App 授权（**Third-party Access** 里批准） |
| 登录后左侧没有 Series / Posts，或栏目里**看不到已有的系列** | `config.yml` 里 `series.nested` 的 `depth` / `index_file` 与本仓库目录形态没对上（Decap 各版本对"层数"口径略不同） | 只改 `public/admin/config.yml` 里 `depth: 2` 那一行：先试 `1`，再试 `100`，每次 push 后强刷 `/admin/`。**哪一行生效了请告诉主 Agent**，它会把这个值钉进单测注释；`index_file: index` 与 `path: '{{slug}}/index'` 两行别动（那是 `src/content/series/<标识>/index.md` 的映射） |
| 后台左侧没有 Series/Posts，或报配置错 | `config.yml` 缩进被改坏了 | 对照仓库里原版把 `client_id` 那一行的缩进改成和 `branch: main` 一致；YAML 不支持 Tab |
| 保存后网站没变 | Pages 构建失败或还在排队 | Pages → Deployments → 看最新那条的 **Build logs**；若日志里出现 `[check-image-sources]` 开头的红字，说明有人往仓库塞了非脚本图片，删掉那张图再 push |
| 想临时禁掉后台 | — | 把 `config.yml` 改回注释状态（`# client_id: ...`）并 push：没有 client_id，登录按钮点不动，前台完全不受影响 |

---

## 9. 安全红线（design §3 / §4，别越界）

1. **仓库里永远只有 `client_id`，没有 `client_secret`。** implicit 流不需要 secret。
2. 真正的门槛是"**这个 GitHub 账号必须对仓库有写权限**"——OAuth App 谁都能授权，
   但没写权限的账号保存只会失败。所以：不要把仓库的写权限给不相关的协作者。
3. 后台只能改文字：照片只出自本地 `npm run import`，`photos/` 与 `photos.meta.json` 不经后台。
4. Decap CMS 走 CDN 且**版本已锁**（`public/admin/index.html` 里写的是 `decap-cms@3.16.3`，
   不是 `latest`）；若将来 Decap 停维，按 design §3 迁 Sveltia CMS，**影响面只有 `public/admin/`
   这一个目录**，内容与构建不动。
