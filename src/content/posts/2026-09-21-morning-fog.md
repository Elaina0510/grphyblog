---
title: 晨雾里的第一束光
date: 2026-09-21
cover: dawn-01.webp
tags: [风光, 晨雾]
draft: false
photos:
  - dawn-01.webp
---

记录性质的一篇：文字为主，插图随拍。照片统一收在 `src/content/pool/photos/` 照片池里，
元数据由导入脚本维护的全局 `photos.meta.json` 记载。

晨雾还没散，光已经先落到田埂上——低处斜切过来，草尖的水汽把轮廓泡软了。
这类片子通常一天只有十几分钟能拍到，撑不起一个系列，所以放在随笔里。

![晨雾落在田埂上，第一束光从低处斜切过来](photo:dawn-01.webp)

插图走的是和系列同一套管线：`npm run import --pool` 把原图压成展示版 + 缩略图 WebP、
EXIF 写进全局 `photos.meta.json`；正文里只写 `![说明](photo:照片ID)`，
宽高与灯箱帧序列在构建期按池里的 sidecar 回填。

雾散之后就没东西可拍了。收工，回城里写这段字。
