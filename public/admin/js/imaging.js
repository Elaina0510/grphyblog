// =============================================================================
// imaging.js —— 浏览器端的图片解码 / Canvas 重编码（唯一碰 DOM 的图像代码）
//
// E6 已定取舍：直传走 Canvas 重编码（2560px 长边 WebP），代价是 EXIF 全丢
// —— 浏览器不把它给我们，所以 sidecar 里打 `exifIncomplete: true`，
// 池页与前台 EXIF 卡显示「EXIF 待补」。在意拍摄参数的图走本地 `npm run import -- --pool`。
//
// 宽高的「真值」取自**产物**：重编码后再解码一次产物拿 width/height，
// 解码失败才退回 canvas 尺寸（两者在正常情况下必然相同，这里只是不按常量推算）。
// =============================================================================

/** 解码用户选的文件（createImageBitmap 优先，Safari 老版本退回 <img> + objectURL）。 */
export async function decodeImageFile(file) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      close: () => bitmap.close?.(),
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise((resolve, reject) => {
      const node = new Image();
      node.onload = () => resolve(node);
      node.onerror = () => reject(new Error('这张图浏览器解不开（格式不支持或文件损坏）'));
      node.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

/** canvas → Blob（浏览器不支持 image/webp 时退回原图类型提示）。 */
function toBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Canvas 编码失败（浏览器不支持 WebP 或内存不足）'));
      },
      type,
      quality,
    );
  });
}

/**
 * 把源图缩到指定尺寸并编码成 WebP。
 *
 * @param {{source: CanvasImageSource, width:number, height:number}} image 解码产物
 * @param {{width:number, height:number}} plan imageplan.planCompression 的结果
 * @param {number} quality 0~1
 * @returns {Promise<{blob: Blob, bytes: Uint8Array, width:number, height:number}>}
 */
export async function encodeScaled(image, plan, quality) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(plan.width));
  canvas.height = Math.max(1, Math.round(plan.height));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('拿不到 2D 画布上下文');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image.source, 0, 0, canvas.width, canvas.height);

  const blob = await toBlob(canvas, 'image/webp', quality);
  const bytes = new Uint8Array(await blob.arrayBuffer());

  // 「宽高从产物读真值」：再解一次编码结果，而不是相信上面的计划值
  let width = canvas.width;
  let height = canvas.height;
  try {
    const probe = await createImageBitmap(blob);
    width = probe.width;
    height = probe.height;
    probe.close?.();
  } catch {
    // 解不开就沿用 canvas 尺寸（同一块画布的产物，数值必然一致）
  }
  return { blob, bytes, width, height };
}
