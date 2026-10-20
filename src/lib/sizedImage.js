/* Web-sized copies of this site's own uploads (server/imageSizes.js). Anything that is not a
   local upload (an older Base44 media URL, say) is returned untouched. */
const LOCAL = /^\/uploads\/([\w.-]+\.(?:jpe?g|png|webp))$/i;

export function sized(url, w) {
  const m = LOCAL.exec(url || '');
  return m ? `/api/img/${m[1]}?w=${w}` : url;
}

/** srcSet for an <img>, or undefined for an image that cannot be resized */
export function sizedSet(url, widths = [480, 800, 1200, 1600]) {
  return LOCAL.test(url || '') ? widths.map((w) => `${sized(url, w)} ${w}w`).join(', ') : undefined;
}
