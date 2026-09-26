# 仓库体积基线（repo-size log）

> performance-acceptance 任务 9 ｜ 口径来源：designv0.0.1.md §6 性能预算、§「原图永不入库」边界
> 目的：给"什么时候该迁 R2 / 何时该孤儿分支重建"留一条可复核的死数字，不靠记忆拍脑袋。

## 基线快照（2026-09-26）

| 项 | 值 | 说明 |
| --- | --- | --- |
| 工作树（tracked，不含 node_modules/dist/.astro/raw/thumbs） | ≈ 12 MB | 主要是 `src/content/**/photos/*.webp`（展示图+缩略图） |
| `.git` | ≈ 9.4 MB | 提交历史（当前很浅，未累积大二进制历史） |
| `dist`（一次完整构建产物） | ≈ 3.0 MB | 10 个页面 + 内联资源；单页传输 38–91 KB |
| tracked 图片数 | 18 张 `.webp` | 9 展示图 + 9 缩略图（种子内容，含 draft 条目文件） |
| 单张最大展示图 | 683 KB（< 800 KB 上限） | `daily-frames/P1230861.webp` |
| 单张最大缩略图 | 64.7 KB（< 80 KB 上限） | 同上 |

> 复核命令：`npm run audit:size`（图片体积红线 + 构建后 `<img>` 属性）；
> `du -sh .git` 与 `git ls-files | grep '\.webp$' | wc -l` 看仓库规模。

## 触发线与预案（约定，非现状）

照片持续入库会推高 `.git`。**软触发线 ≈ 1 GB**（`.git` + 工作树图片合计）；到线时任选其一：

- **预案 A（推荐·退出路径已预留）**：图片改走 **Cloudflare R2 / 图床**。
  全站图片 URL 的唯一出口是 `src/utils/imageUrl.ts` 的 `base`——把 `PUBLIC_IMAGE_BASE`
  指到 R2 域名即可整体迁移，业务代码一行不改（design §3 边界③、§"预留 B 方案退出路径"）。
- **预案 B（本地兜底·不改架构）**：用**孤儿分支重建**瘦身——新建无历史的 orphan 分支，
  只带当前内容快照重新提交，丢弃历史里的旧图版本；`git push --force` 前必须与站长确认
  （历史一旦丢弃不可逆）。适合"图片仍留在 Git，但历史膨胀"的场景。

## 注意

- `raw/`（相机原图）与 `thumbs/`（本地暂存缩略图）**已在 .gitignore**，永不入库——这是体积不失控的第一道闸。
  原图只在站长硬盘，备份由站长自行负责（见 `doc/account-setup.md` 第 8 节）。
- 每次 `npm run build` 前 `prebuild` 会跑 `check-image-sources`（R5）挡"非脚本来源图片"，
  间接防止大 jpg 被误提交进 `public/` 或 `photos/` 之外。
