# 内容后台登录指引 · Sveltia + GitHub 访问令牌（模块 11）· v0.0.2

> 面向：**会用网页点、不写代码**的你。全程在浏览器里做，大约 3~5 分钟。
> 目标：让线上 `https://grphyblog.pages.dev/admin/` 这个内容后台能登录、能改文字。
> 前置：仓库已建好并推上去、Cloudflare Pages 已能访问站点（见 `doc/account-setup.md` 第 2~4 节）。
>
> 这一版**取代**了原来的「注册 OAuth App / 填 client_id」流程。为什么换：
> 见下一节。你不用再注册任何 OAuth App，之前建的 `grphyblog admin` OAuth App 可以直接删掉。

---

## 0. 为什么从 Decap 换成了 Sveltia（一句话版）

Decap CMS 新版（3.x）的 GitHub 后端**删掉了「直接用 GitHub 账号登录」**，只认 Netlify 的登录代理；
本站托管在 Cloudflare Pages，那个代理回 404，点「Login with GitHub」必然报 Not Found。
Sveltia 是 Decap/Netlify CMS 的现役继任者，读同一份 `config.yml`、同一套内容仓库，
支持**粘贴一个 GitHub 访问令牌**直接登录——不需要任何第三方代理，也不需要自建服务器。

---

## 1. 先看这张表：谁做什么

| 步骤 | 谁做 | 做完长什么样 |
| --- | --- | --- |
| 1. 在 GitHub 生成一个访问令牌（PAT） | **你在浏览器点** | 一串 `ghp_...` 开头的字符，只显示一次，先存好 |
| 2. 把它 push 上线（本仓库改动） | 主 Agent（需你确认推送） | 线上 `/admin/` 出现 Sveltia 登录页 |
| 3. 打开后台、粘贴令牌登录 + 验收 | **你在浏览器点** | 进得去、能改文字、没有上传入口 |

⚠️ 令牌**不写进仓库任何文件**，只粘贴在你浏览器里（存在本机 localStorage）。

---

## 2. 生成 GitHub 访问令牌（照抄每一步）

1. 用**有仓库写权限的 GitHub 账号**（就是建 `Elaina0510/grphyblog` 那个号）登录 github.com。
2. 打开：**https://github.com/settings/tokens/new**
   （路径：右上角头像 → **Settings** → 左侧最底部 **Developer settings** →
   **Personal access tokens** → **Tokens (classic)** → 右上 **Generate new token (classic)**）
3. 表单从上往下填：

   | 输入框 | 填什么 |
   | --- | --- |
   | **Note**（备注） | `grphyblog admin`（认得出就行） |
   | **Expiration**（有效期） | 建议选 **90 days** 或 **Custom…No expiration**（见第 6 节安全提醒） |
   | **Select scopes**（勾选权限） | **只勾第一项 `repo`**（整行勾选框点一下即可，含子项）。别的都不勾 |

4. 拉到底点 **Generate token**。
5. 页面顶部出现一串 `ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`。点右边的 📋 复制。
   👉 **这串就是全部。它只显示这一次，关掉页面就看不到了**（忘了就回这里再生成一个、把旧的删掉）。

> **不要**勾 `admin:repo`、`delete_repo`、`workflow` 这些——后台只需要写内容，`repo` 一项就够。
> **不要**用 Fine-grained token：经典 `repo` 令牌与本仓库的公开仓 + 内容写权限口径最稳。

---

## 3. 上线本仓库改动（交给主 Agent，需你确认）

这一步是主 Agent 把「Decap→Sveltia」的改动提交并推送（`public/admin/`、`tests/`、`doc/`、`src/utils/imageUrl.ts`）。
它会在推送前向你确认。**你不用碰命令行。**

推送后等 1~2 分钟 Pages 重建，浏览器打开 **https://grphyblog.pages.dev/admin/**
→ 看到 **Sveltia CMS** 登录页，中间有一个 **「使用访问令牌登录」** 按钮
（旁边还有「使用本地仓库」——那是离线试错用的，先不管）。

---

## 4. 登录 + 逐项验收（模块 11 · 门禁 D 线上部分）

1. 点 **使用访问令牌登录** → 出现一个输入框 → 粘贴第 2 节复制的 `ghp_...` → 确认/登录。
2. 进去后左侧能看到 **系列 / 随笔** 两个栏目 = 登录成功。
3. 逐项验收（**每项都该是"能改、不能传图"**）：

   | 验什么 | 怎么做 | 预期 |
   | --- | --- | --- |
   | 改文字 | 进 `系列 → 夜光 · 城市`（city-lights），把标题改一个字 → 右上 **发布/Publish** | GitHub 仓库多一条 commit（作者是你的账号），1~2 分钟后线上标题变了 |
   | 排序 | 同一页把 **排序权重** 从 1 改成 2 → 发布 | 首页/系列列表顺序跟着变 |
   | 发布/撤下 | 把 **草稿开关** 打开 → 发布；再关掉 → 发布 | 打开后该系列从线上消失，关闭后回来 |
   | 选封面 | 看 **封面** 字段 | 是**只能打字的文本框**，没有"上传/拖拽/选择文件"按钮 |
   | 传图 | 试着把桌面一张 jpg **拖到后台页面上** | 没有任何上传反应；正文里也不会插入图片 |
   | 无 sidecar 编辑口 | 看左侧栏目与条目列表 | 找不到 `photos.meta.json` 或 `photos/`，它们不是可编辑条目 |

4. 全绿 = **模块 11 达成**。有任何一项不对，先按第 5 节对号，再把现象贴回给主 Agent。

> 建议验收后，把刚才改的标题/排序**改回原值再发布一次**，或让主 Agent 直接回滚那条测试 commit。

---

## 5. 出问题对照表

| 现象 | 大概率原因 | 怎么办 |
| --- | --- | --- |
| `/admin/` 空白或 404 | Pages 还没构建完；或访问的是 `/admin`（没斜杠） | 等 1 分钟强刷；地址补成 `/admin/` |
| 登录页仍显示 "Login with GitHub" 且点了报 Not Found | 浏览器缓存了旧版 `/admin/`（旧 Decap 页） | 硬刷新 `Ctrl+Shift+R`；或无痕窗口打开；确认第 3 步已 push 且 Pages 构建成功 |
| 粘贴令牌后报 **401 / Bad credentials** | 令牌复制不全、或已过期/被删 | 回第 2 节重新生成一个，整串复制 |
| 登录进去但保存报 **403 / Needs more permissions** | 该令牌没勾 `repo`，或该账号对仓库没有写权限 | 重新生成并勾上 `repo`；确认登录的是仓库属主账号 |
| 左侧没有「系列 / 随笔」，或看不到已有条目 | 嵌套集合的目录层数（`nested.depth`）与仓库形态没对上 | 只改 `public/admin/config.yml` 里 series 的 `depth: 2`：先试 `1` 再试别的，每次 push 后强刷；**哪一档生效告诉主 Agent**，它会钉进配置与单测 |
| 保存后网站没变 | Pages 构建失败或在排队 | Pages → Deployments → 看最新那条 **Build logs**；若日志出现 `[check-image-sources]` 红字，说明有人往 public/ 塞了非脚本图片，删掉那张图再 push |

---

## 6. 撤销 / 换域名 / 安全红线

- **换电脑、令牌泄漏、不想再让它登录**：GitHub → Settings → **Developer settings** →
  **Personal access tokens** → 找到 `grphyblog admin` → **Delete（撤销）**。网站前台不受影响（静态）。
  下次要再进后台，就再生成一个。
- **换域名**（以后绑自定义域）：改 `public/admin/config.yml` 的 `site_url` / `display_url`
  与 `astro.config.mjs` 的 `site`，两处域名必须一致；令牌与本流程无关，不用重发。
- **安全红线**：
  1. 仓库里**永远不出现任何令牌**（`.env` / config / README 都不行）；令牌只活在浏览器 localStorage。
  2. 经典 `repo` 令牌权限不小（等于该账号对仓库的读写），**设个有效期**、不用时能一键撤销，是给自己的兜底。
  3. 后台只能改文字：照片只出自本地 `npm run import`，`photos/` 与 `photos.meta.json` 不经后台。
  4. Sveltia 走 CDN 且**版本已锁**（`public/admin/index.html` 里是 `@sveltia/cms@0.221.0`，不是 latest）；
     升级 = 手动改那一行 + 线上再登录验一次。
