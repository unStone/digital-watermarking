/** EXIF 元信息读取与清除 */

const HIGHLIGHT = new Set([
  'Make', 'Model', 'LensModel', 'Software', 'DateTimeOriginal', 'DateTime',
  'Artist', 'Copyright', 'ImageDescription', 'UserComment', 'HostComputer',
]);

/** ExifReader 的 value 形态很多（数组、有理数、Uint8Array），统一转成可读字符串 */
function readable(tag) {
  if (tag == null) return '';
  if (typeof tag.description === 'string' && tag.description) return tag.description;
  const value = tag.value;
  if (value == null) return '';
  if (Array.isArray(value)) return value.slice(0, 12).join(', ');
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 200);
  return String(value);
}

window.addEventListener('DOMContentLoaded', function () {
  UI.mountTopbar('exif/');

  const fileInput = document.getElementById('file');
  const stripBtn = document.getElementById('strip');
  const tagsBody = document.getElementById('tags');
  const tagsCard = document.getElementById('tags-card');
  const gpsCard = document.getElementById('gps-card');
  const empty = document.getElementById('empty');

  let currentFile = null;
  let gpsText = '';

  fileInput.onchange = async function () {
    currentFile = this.files[0];
    if (!currentFile) return;
    stripBtn.disabled = false;

    let tags = {};
    try {
      tags = await ExifReader.load(currentFile);
    } catch (err) {
      UI.toast('解析失败：' + err.message);
    }

    const entries = Object.entries(tags)
      .map(([name, tag]) => [name, readable(tag)])
      .filter(([, value]) => value !== '')
      .sort((a, b) => (HIGHLIGHT.has(b[0]) ? 1 : 0) - (HIGHLIGHT.has(a[0]) ? 1 : 0));

    tagsBody.innerHTML = entries.map(([name, value]) =>
      '<tr><td>' + (HIGHLIGHT.has(name) ? '<strong>' + name + '</strong>' : name) +
      '</td><td>' + value.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])) + '</td></tr>'
    ).join('');

    tagsCard.hidden = entries.length === 0;
    empty.hidden = entries.length > 0;
    document.getElementById('tag-count').textContent = entries.length ? '共 ' + entries.length + ' 项' : '';

    const lon = tags.GPSLongitude && tags.GPSLongitude.description;
    const lat = tags.GPSLatitude && tags.GPSLatitude.description;
    if (lon != null && lat != null) {
      const lonRef = tags.GPSLongitudeRef && tags.GPSLongitudeRef.value;
      const latRef = tags.GPSLatitudeRef && tags.GPSLatitudeRef.value;
      const lonNum = String(lonRef).indexOf('W') >= 0 ? -Math.abs(lon) : lon;
      const latNum = String(latRef).indexOf('S') >= 0 ? -Math.abs(lat) : lat;
      gpsText = latNum + ',' + lonNum;
      document.getElementById('lon').textContent = lonNum;
      document.getElementById('lat').textContent = latNum;
      document.getElementById('map-link').href = 'https://www.openstreetmap.org/?mlat=' + latNum + '&mlon=' + lonNum + '#map=16/' + latNum + '/' + lonNum;
      gpsCard.hidden = false;
    } else {
      gpsCard.hidden = true;
      gpsText = '';
    }
  };

  document.getElementById('copy-gps').onclick = function () { UI.copy(gpsText, '坐标已复制'); };

  stripBtn.onclick = function () {
    if (!currentFile) return;
    getImageInfo(null, currentFile, (err, data) => {
      if (err) return UI.toast(err.message);
      const canvas = document.createElement('canvas');
      canvas.width = data.width;
      canvas.height = data.height;
      canvas.getContext('2d').drawImage(data.imgElement, 0, 0);
      // 走一遍 canvas 重新编码，元信息自然就丢了
      UI.downloadCanvas(canvas, 'no-exif.png');
      UI.toast('已导出无元信息的 PNG');
    });
  };
});
