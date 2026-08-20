import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pages = [
  'index.html',
  'pages/ai-text/index.html',
  'pages/c2pa/index.html',
  'pages/text/index.html',
  'pages/according/index.html',
  'pages/exif/index.html',
  'pages/lsb-order/index.html',
  'pages/lsb-img/index.html',
  'pages/lsb-encryption/index.html',
  'pages/fft/index.html',
];
const tools = [
  'pages/ai-text/',
  'pages/c2pa/',
  'pages/text/',
  'pages/according/',
  'pages/exif/',
  'pages/lsb-order/',
  'pages/lsb-img/',
  'pages/lsb-encryption/',
  'pages/fft/',
];

const failures = [];

function fail(file, message) {
  failures.push(`${file}: ${message}`);
}

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`, 'i'));
  return match ? match[1] ?? match[2] : null;
}

function resolveLocalLink(file, href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean || /^(?:[a-z]+:|\/\/|#)/i.test(href)) return null;
  const absolute = resolve(root, dirname(file), clean);
  if (clean.endsWith('/')) return join(absolute, 'index.html');
  return absolute;
}

for (const file of pages) {
  const absolute = join(root, file);
  if (!existsSync(absolute)) {
    fail(file, '入口文件不存在');
    continue;
  }

  const html = readFileSync(absolute, 'utf8');
  const expectedRoot = file === 'index.html' ? 'assets/' : '../../assets/';

  if (!/^<!doctype html>/i.test(html.trimStart())) fail(file, '缺少 HTML5 doctype');
  if (!/<html\s+lang="zh-CN"/i.test(html)) fail(file, 'html lang 必须为 zh-CN');
  if (!/<meta\s+name="viewport"/i.test(html)) fail(file, '缺少 viewport');
  if (!/<title>[^<]+<\/title>/i.test(html)) fail(file, '缺少非空 title');
  if (!/<meta\s+name="description"\s+content="[^"]+"/i.test(html)) fail(file, '缺少 description');
  if (!/<meta\s+name="robots"\s+content="[^"]+"/i.test(html)) fail(file, '缺少 robots');
  if (!/<link\s+rel="canonical"\s+href="https:\/\/unstone\.github\.io\/digital-watermarking\//i.test(html)) fail(file, 'canonical 不正确');
  if (!/<meta\s+property="og:title"/i.test(html)) fail(file, '缺少 og:title');
  if (!/<meta\s+name="twitter:card"/i.test(html)) fail(file, '缺少 twitter:card');
  if (!html.includes(`href="${expectedRoot}theme.css"`) && !html.includes(`href='${expectedRoot}theme.css'`)) fail(file, '未接入 theme.css');
  if (!html.includes(`href="${expectedRoot}layout.css"`) && !html.includes(`href='${expectedRoot}layout.css'`)) fail(file, '未接入 layout.css');
  if (!html.includes(`href="${expectedRoot}signals.css"`) && !html.includes(`href='${expectedRoot}signals.css'`)) fail(file, '未接入 signals.css');
  if (count(html, /<h1\b/gi) !== 1) fail(file, '必须且只能有一个 h1');
  if (!/<header\s+class="topbar"/i.test(html)) fail(file, '缺少静态 topbar');
  if (!/<main\b/i.test(html)) fail(file, '缺少 main');
  if (!/<footer\s+class="site"/i.test(html)) fail(file, '缺少全站 footer');

  const footer = html.match(/<footer\s+class="site"[\s\S]*?<\/footer>/i)?.[0] ?? '';
  for (const tool of tools) {
    const href = file === 'index.html' ? `./${tool}` : `../../${tool}`;
    if (!footer.includes(`href="${href}"`) && !footer.includes(`href='${href}'`)) {
      fail(file, `footer 缺少工具链接 ${tool}`);
    }
  }

  for (const block of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      fail(file, `JSON-LD 无法解析：${error.message}`);
    }
  }
  if (!/<script\s+type="application\/ld\+json">/i.test(html)) fail(file, '缺少 JSON-LD');

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (attribute(tag, 'alt') === null) fail(file, `图片缺少 alt：${tag.slice(0, 80)}`);
  }

  for (const match of html.matchAll(/<a\b[^>]*\shref=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    const href = match[1] ?? match[2];
    const target = resolveLocalLink(file, href);
    if (!target) continue;
    if (!normalize(target).startsWith(root) || !existsSync(target)) {
      fail(file, `内部链接无目标：${href} -> ${relative(root, target)}`);
    }
  }
}

if (failures.length) {
  console.error(`站点校验失败（${failures.length} 项）：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`站点校验通过：${pages.length} 个入口页，SEO、结构、图片与内部链接均有效。`);
