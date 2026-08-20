import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

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
const baselineFlag = process.argv.indexOf('--baseline');
const baseline = baselineFlag >= 0 ? process.argv[baselineFlag + 1] : null;
const seoFields = [
  ['title', /<title>([^<]+)<\/title>/i],
  ['description', /<meta\s+name="description"\s+content="([^"]+)"/i],
  ['keywords', /<meta\s+name="keywords"\s+content="([^"]+)"/i],
  ['robots', /<meta\s+name="robots"\s+content="([^"]+)"/i],
  ['canonical', /<link\s+rel="canonical"\s+href="([^"]+)"/i],
  ['og:title', /<meta\s+property="og:title"\s+content="([^"]+)"/i],
  ['og:description', /<meta\s+property="og:description"\s+content="([^"]+)"/i],
  ['og:url', /<meta\s+property="og:url"\s+content="([^"]+)"/i],
  ['og:image', /<meta\s+property="og:image"\s+content="([^"]+)"/i],
  ['twitter:title', /<meta\s+name="twitter:title"\s+content="([^"]+)"/i],
  ['twitter:description', /<meta\s+name="twitter:description"\s+content="([^"]+)"/i],
  ['twitter:image', /<meta\s+name="twitter:image"\s+content="([^"]+)"/i],
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

function plainText(source) {
  return source
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, '');
}

function structuredItems(value) {
  return Array.isArray(value?.['@graph']) ? value['@graph'] : [value];
}

function headingLevels(source) {
  return [...source.matchAll(/<h([1-6])\b/gi)].map((match) => Number(match[1]));
}

function localTargets(file, source) {
  const targets = new Set();
  for (const match of source.matchAll(/<a\b[^>]*\shref=(?:"([^"]*)"|'([^']*)')[^>]*>/gi)) {
    const target = resolveLocalLink(file, match[1] ?? match[2]);
    if (target && normalize(target).startsWith(root)) targets.add(relative(root, target));
  }
  return targets;
}

function structuredIdentities(source) {
  const identities = new Set();
  for (const block of source.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      for (const item of structuredItems(JSON.parse(block[1]))) {
        identities.add(`${item?.['@type'] ?? ''}|${item?.['@id'] ?? item?.name ?? ''}`);
        for (const entity of item?.mainEntity ?? []) identities.add(`Question|${entity.name ?? ''}`);
      }
    } catch {
      // 主校验循环会报告 JSON 语法错误。
    }
  }
  return identities;
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

  if (baseline) {
    try {
      const previous = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, encoding: 'utf8' });
      for (const [name, pattern] of seoFields) {
        if (previous.match(pattern)?.[1] !== html.match(pattern)?.[1]) fail(file, `${name} 与 ${baseline} 不一致`);
      }
      const previousLevels = new Set(headingLevels(previous));
      const currentLevels = new Set(headingLevels(html));
      for (const level of previousLevels) {
        if (!currentLevels.has(level)) fail(file, `标题层级 h${level} 相比 ${baseline} 丢失`);
      }
      const currentTargets = localTargets(file, html);
      for (const target of localTargets(file, previous)) {
        if (!currentTargets.has(target)) fail(file, `内部链接目标相比 ${baseline} 丢失：${target}`);
      }
      const currentStructured = structuredIdentities(html);
      for (const identity of structuredIdentities(previous)) {
        if (!currentStructured.has(identity)) fail(file, `JSON-LD 实体相比 ${baseline} 丢失：${identity}`);
      }
    } catch (error) {
      fail(file, `无法读取基线 ${baseline}：${error.message.split('\n')[0]}`);
    }
  }

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
  const levels = headingLevels(html);
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index] > levels[index - 1] + 1) fail(file, `标题层级从 h${levels[index - 1]} 跳到 h${levels[index]}`);
  }
  if (!/<header\s+class="topbar"/i.test(html)) fail(file, '缺少静态 topbar');
  if (!/<main\b/i.test(html)) fail(file, '缺少 main');
  if (!/<footer\s+class="site"/i.test(html)) fail(file, '缺少全站 footer');
  if (file !== 'index.html' && !/<div\s+class="boundary-grid"/i.test(html)) fail(file, '缺少“能做 / 不能做”能力边界');

  const footer = html.match(/<footer\s+class="site"[\s\S]*?<\/footer>/i)?.[0] ?? '';
  for (const tool of tools) {
    const href = file === 'index.html' ? `./${tool}` : `../../${tool}`;
    if (!footer.includes(`href="${href}"`) && !footer.includes(`href='${href}'`)) {
      fail(file, `footer 缺少工具链接 ${tool}`);
    }
  }

  const structured = [];
  for (const block of html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi)) {
    try {
      structured.push(JSON.parse(block[1]));
    } catch (error) {
      fail(file, `JSON-LD 无法解析：${error.message}`);
    }
  }
  if (!/<script\s+type="application\/ld\+json">/i.test(html)) fail(file, '缺少 JSON-LD');

  if (file === 'index.html') {
    const faq = structured.flatMap(structuredItems).find((item) => item?.['@type'] === 'FAQPage');
    const visibleFaq = new Map();
    const faqList = html.match(/<div\s+class="faq-list">([\s\S]*?)<\/div>\s*<\/section>/i)?.[1] ?? '';
    for (const article of faqList.matchAll(/<article\s+class="faq-item">([\s\S]*?)<\/article>/gi)) {
      const question = article[1].match(/<h3>([\s\S]*?)<\/h3>/i)?.[1];
      const answer = article[1].match(/<p>([\s\S]*?)<\/p>/i)?.[1];
      if (question && answer) visibleFaq.set(plainText(question), plainText(answer));
    }
    for (const entity of faq?.mainEntity ?? []) {
      const visible = visibleFaq.get(plainText(entity.name ?? ''));
      const answer = plainText(entity.acceptedAnswer?.text ?? '');
      if (!visible || visible !== answer) fail(file, `FAQ 与 JSON-LD 不一致：${entity.name}`);
    }
    if (visibleFaq.size !== (faq?.mainEntity?.length ?? 0)) fail(file, '可见 FAQ 与 JSON-LD 数量不一致');
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (attribute(tag, 'alt') === null) fail(file, `图片缺少 alt：${tag.slice(0, 80)}`);
  }

  for (const match of html.matchAll(/<(?:input|textarea|select)\b[^>]*>/gi)) {
    const tag = match[0];
    const type = attribute(tag, 'type');
    if (['hidden', 'button', 'submit'].includes(type)) continue;
    const id = attribute(tag, 'id');
    const labelled = id && new RegExp(`<label\\s+[^>]*for=(?:"${id}"|'${id}')`, 'i').test(html);
    if (!labelled && attribute(tag, 'aria-label') === null && attribute(tag, 'aria-labelledby') === null) {
      fail(file, `表单控件缺少显式标签：${tag.slice(0, 80)}`);
    }
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

console.log(`站点校验通过：${pages.length} 个入口页，SEO、结构、表单、图片与内部链接均有效${baseline ? `；SEO 与 ${baseline} 一致` : ''}。`);
