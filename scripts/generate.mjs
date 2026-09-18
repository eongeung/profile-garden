#!/usr/bin/env node
// GitHub 활동량에 따라 자라는 픽셀 아트 나무 SVG를 만든다.
//   node scripts/generate.mjs          GITHUB_TOKEN으로 실제 활동을 읽어 dist/에 저장
//   node scripts/generate.mjs --demo   가짜 데이터로 preview/index.html 생성
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 캔버스: W×H 픽셀을 P배 확대, 아래에 FOOTER 높이의 정보 줄
const W = 72, H = 44, P = 6, FOOTER = 30;
const GY = 37;          // 땅이 시작되는 행
const CX = 36;          // 나무 중심 열

// ---------------------------------------------------------------- 설정 · 데이터

async function loadConfig() {
  let file = {};
  try {
    file = JSON.parse(await readFile(join(ROOT, 'garden.config.json'), 'utf8'));
  } catch { /* 설정 파일이 없으면 환경 변수와 기본값을 쓴다 */ }
  return {
    username: process.env.GARDEN_USER || file.username || process.env.GITHUB_REPOSITORY_OWNER,
    timeZone: file.timeZone || 'Asia/Seoul',
  };
}

async function gql(query, variables, token) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'profile-garden',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

async function fetchStats(username, timeZone, token) {
  const base = await gql(
    `query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionYears
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
        }
      }
    }`,
    { login: username },
    token,
  );
  if (!base.user) throw new Error(`GitHub user not found: ${username}`);
  const cc = base.user.contributionsCollection;

  // 연도별 합계를 한 번에 조회해 가입 이후 전체 기여 수를 구한다
  let total = 0;
  if (cc.contributionYears.length > 0) {
    const fields = cc.contributionYears
      .map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") { contributionCalendar { totalContributions } }`)
      .join('\n');
    const years = await gql(`query($login: String!) { user(login: $login) { ${fields} } }`, { login: username }, token);
    total = Object.values(years.user).reduce((sum, c) => sum + c.contributionCalendar.totalContributions, 0);
  }

  const days = cc.contributionCalendar.weeks.flatMap((w) => w.contributionDays);
  return summarize(total, days, todayIn(timeZone));
}

function todayIn(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

function shiftDate(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function summarize(total, days, today) {
  const count = new Map(days.map((d) => [d.date, d.contributionCount]));

  // 오늘 아직 활동이 없으면 어제부터 거꾸로 센다
  let cursor = (count.get(today) ?? 0) > 0 ? today : shiftDate(today, -1);
  let streak = 0;
  while ((count.get(cursor) ?? 0) > 0) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }

  const last = days
    .filter((d) => d.contributionCount > 0 && d.date <= today)
    .map((d) => d.date)
    .sort()
    .pop();
  const idleDays = last ? Math.round((Date.parse(today) - Date.parse(last)) / 86_400_000) : Infinity;

  // 어항용: 최근 30일(오늘 포함) 중 활동한 하루 수와 그 합계
  const recent = Array.from({ length: 30 }, (_, i) => count.get(shiftDate(today, i - 29)) ?? 0);
  const activeDays = recent.filter((c) => c > 0).length;
  const recentTotal = recent.reduce((a, b) => a + b, 0);

  return { total, streak, idleDays, activeDays, recentTotal, month: Number(today.slice(5, 7)) };
}

// ---------------------------------------------------------------- 성장 규칙

const STAGES = [
  { min: 0, name: 'SEED' },
  { min: 1, name: 'SPROUT' },
  { min: 10, name: 'SEEDLING' },
  { min: 50, name: 'SAPLING' },
  { min: 200, name: 'YOUNG TREE' },
  { min: 500, name: 'TREE' },
  { min: 1000, name: 'GREAT TREE' },
];

// 단계별 크기. 마지막 값은 GREAT TREE가 계속 자랄 수 있는 상한
const TRUNK_H = [0, 3, 5, 9, 13, 17, 20, 23];
const TRUNK_W = [0, 1, 1, 2, 2, 3, 4, 4];
const CANOPY_R = [0, 0, 3, 5, 7, 9, 11, 12];

function growth(total) {
  let s = 0;
  while (s + 1 < STAGES.length && total >= STAGES[s + 1].min) s++;

  // 같은 단계 안에서도 기여가 쌓일수록 조금씩 자란다
  const p = s + 1 < STAGES.length
    ? (total - STAGES[s].min) / (STAGES[s + 1].min - STAGES[s].min)
    : Math.min(1, Math.log2(total / 1000) / 3);
  const lerp = (arr) => arr[s] + (arr[s + 1] - arr[s]) * p;

  return {
    stage: s,
    name: STAGES[s].name,
    trunkH: Math.round(lerp(TRUNK_H)),
    trunkW: Math.round(lerp(TRUNK_W)),
    canopyR: lerp(CANOPY_R),
  };
}

// 마지막 활동 이후 지난 날수 → 잎이 남아 있는 비율
function leafDensity(idleDays) {
  if (idleDays <= 2) return 1;
  if (idleDays <= 6) return 0.82;
  if (idleDays <= 13) return 0.58;
  if (idleDays <= 29) return 0.34;
  return 0.12;
}

function seasonOf(month) {
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}

// ---------------------------------------------------------------- 색

function mix(hex, amount) {
  // amount > 0 이면 흰색 쪽, < 0 이면 검은색 쪽으로 섞는다
  const n = parseInt(hex.slice(1), 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const ch = (shift) => Math.round(((n >> shift) & 255) * (1 - a) + target * a);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('')}`;
}

const THEMES = {
  light: {
    sky: ['#9fd3ee', '#b2dcf1', '#c6e6f4', '#daeff7'],
    water: ['#7cc5e9', '#5db0dc', '#4599ca', '#317fb0'],
    frame: '#ffffff', text: '#1f2328', muted: '#656d76', border: '#d0d7de',
    dim: 0,
  },
  dark: {
    sky: ['#0b1224', '#101a31', '#15223f', '#1b2b4c'],
    water: ['#123049', '#0e2740', '#0b1f35', '#08182a'],
    frame: '#0d1117', text: '#e6edf3', muted: '#8d96a0', border: '#30363d',
    dim: -0.28,
  },
};

const LEAVES = {
  spring: [['#b6e67a', '#86c957', '#5aa142', '#356f30']],
  summer: [['#86d65e', '#55b043', '#338638', '#205b2d']],
  autumn: [
    ['#ffd36e', '#f5a742', '#da752d', '#9e4b23'],
    ['#ffa07a', '#e8663f', '#bb3f2f', '#7c2b25'],
  ],
  winter: [['#dce8ee', '#8faf9c', '#5a7c66', '#3c5847']],
};

const GRASS = {
  spring: ['#94d864', '#6fbb4c'],
  summer: ['#63b84a', '#49993c'],
  autumn: ['#bdb24d', '#9a923d'],
  winter: ['#f3f7fa', '#d3e0e8'],
};

// ---------------------------------------------------------------- 결정적 난수

function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 같은 사용자·좌표·용도면 항상 같은 값 → 날마다 모양이 바뀌지 않는다
const makeNoise = (seed) => (x, y, salt) => hash32(`${seed}:${salt}:${x}:${y}`) / 4294967296;

// ---------------------------------------------------------------- 그리기

function render({ username, stats, theme: themeName }) {
  const theme = THEMES[themeName];
  const season = seasonOf(stats.month);
  const noise = makeNoise(username);
  const g = growth(stats.total);
  const dim = (c) => (theme.dim ? mix(c, theme.dim) : c);

  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const set = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = c;
  };
  const circle = (cx, cy, r, c) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) set(x, y, c);
  };

  // 하늘: 띠 경계는 체크무늬로 섞는다
  const band = GY / theme.sky.length;
  for (let y = 0; y < GY; y++) {
    const b = Math.min(theme.sky.length - 1, Math.floor(y / band));
    const edge = b < theme.sky.length - 1 && y === Math.floor((b + 1) * band) - 1;
    for (let x = 0; x < W; x++) set(x, y, edge && (x + y) % 2 ? theme.sky[b + 1] : theme.sky[b]);
  }

  if (themeName === 'light') {
    circle(61, 7, 3.2, '#ffd45e');
    circle(60.5, 6.5, 1.6, '#ffe99c');
    const cloud = ['  ####   ', ' ####### ', '#########', ' ####### '];
    [[6 + Math.floor(noise(0, 0, 'cx') * 14), 6], [30 + Math.floor(noise(1, 0, 'cx') * 12), 12]].forEach(([ox, oy]) =>
      cloud.forEach((row, dy) => [...row].forEach((ch, dx) => {
        if (ch === '#') set(ox + dx, oy + dy, dy === cloud.length - 1 ? '#e6f3f9' : '#ffffff');
      })));
  } else {
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(noise(i, 0, 'sx') * W);
      const y = Math.floor(noise(i, 1, 'sy') * (GY - 14));
      if (Math.abs(x - 60) > 5 || Math.abs(y - 7) > 5) set(x, y, noise(i, 2, 'sb') > 0.5 ? '#fdf5d3' : '#6f7aa3');
    }
    circle(60, 7, 3.2, '#f3eecf');
    circle(61.6, 5.9, 2.7, theme.sky[0]);
  }

  // 땅
  const grass = GRASS[season].map(dim);
  const dirt = ['#8a5a3b', '#744a30', '#9d6b48'].map((c) => mix(c, theme.dim * 1.4));
  for (let x = 0; x < W; x++) {
    set(x, GY, grass[0]);
    set(x, GY + 1, (x % 2) ? grass[1] : grass[0]);
    set(x, GY + 2, (x % 2) ? dirt[0] : grass[1]);
    for (let y = GY + 3; y < H; y++) set(x, y, noise(x, y, 'dirt') < 0.13 ? dirt[2] : (y % 2 ? dirt[0] : dirt[1]));
    if (noise(x, 0, 'tuft') < 0.1) set(x, GY - 1, grass[0]);
  }

  // 나무
  const bark = dim('#7a4e2d'), barkDark = dim('#5a381f'), barkLight = dim('#96633b');
  const palettes = LEAVES[season].map((p) => p.map(dim));

  let layers = '';

  if (g.stage === 0) {
    for (let x = CX - 2; x <= CX + 2; x++) set(x, GY - 1, dirt[1]);
    for (let x = CX - 1; x <= CX + 1; x++) set(x, GY - 2, dirt[1]);
    set(CX, GY - 3, dim('#d4a86a'));
  } else if (g.stage === 1) {
    const stem = dim('#5aa142'), leaf = dim('#86c957');
    for (let i = 1; i <= g.trunkH; i++) set(CX, GY - i, stem);
    const top = GY - g.trunkH;
    set(CX - 1, top, leaf); set(CX - 2, top - 1, leaf);
    set(CX + 1, top + 1, leaf); set(CX + 2, top, leaf);
  } else {
    const { trunkH: h, trunkW: w, canopyR: r } = g;
    const x0 = CX - Math.floor(w / 2);
    const topY = GY - h;

    for (let y = GY - 1; y >= topY; y--)
      for (let i = 0; i < w; i++)
        set(x0 + i, y, w > 1 && i === w - 1 ? barkDark : w >= 3 && i === 0 ? barkLight : bark);
    if (w >= 2) { set(x0 - 1, GY - 1, barkDark); set(x0 + w, GY - 1, barkDark); }
    if (w >= 4) { set(x0 - 2, GY - 1, barkDark); set(x0 + w + 1, GY - 1, barkDark); }

    const blobs = [{ x: CX, y: topY - r * 0.35, r }];
    const branches = Math.min(4, g.stage - 1);
    for (let i = 0; i < branches; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      const y0 = Math.round(GY - h * (0.5 + 0.38 * noise(i, 0, 'by')));
      const len = Math.max(2, Math.round(r * (0.55 + 0.35 * noise(i, 1, 'bl'))));
      const sx = dir < 0 ? x0 - 1 : x0 + w;
      for (let k = 0; k < len; k++) set(sx + dir * k, y0 - Math.floor(k * 0.7), barkDark);
      blobs.push({ x: sx + dir * (len - 1), y: y0 - Math.floor((len - 1) * 0.7) - 1, r: r * (0.5 + 0.22 * noise(i, 2, 'br')) });
    }
    if (g.stage >= 4) blobs.push({ x: CX + (noise(0, 0, 'tx') - 0.5) * r * 0.6, y: topY - r * 0.95, r: r * 0.62 });

    const inCanopy = (x, y) => y < GY - 1 && blobs.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 * 1.15 <= b.r * b.r + 0.5);
    const cx0 = CX, cy0 = topY - r * 0.35, R = r + 2;
    const density = leafDensity(stats.idleDays) * (season === 'winter' ? 0.6 : 1);

    const minX = Math.floor(Math.min(...blobs.map((b) => b.x - b.r))) - 1;
    const maxX = Math.ceil(Math.max(...blobs.map((b) => b.x + b.r))) + 1;
    const minY = Math.max(0, Math.floor(Math.min(...blobs.map((b) => b.y - b.r))) - 1);
    const leaves = [];
    const canopyPx = [];
    const fallLayers = [];
    let canopyBottom = 0;

    for (let y = minY; y < GY - 1; y++) {
      for (let x = minX; x <= maxX; x++) {
        if (!inCanopy(x, y)) continue;
        canopyBottom = Math.max(canopyBottom, y);
        const up = inCanopy(x, y - 1), down = inCanopy(x, y + 1);
        const left = inCanopy(x - 1, y), right = inCanopy(x + 1, y);
        const edge = !(up && down && left && right);
        if (noise(x, y, 'leaf') >= density * (edge ? 0.8 : 1)) continue;

        const pal = palettes[palettes.length > 1 && noise(Math.floor(x / 3), Math.floor(y / 3), 'mix') > 0.55 ? 1 : 0];
        const v = (-(x - cx0) * 0.55 - (y - cy0) * 0.85) / R + (noise(x, y, 'shade') - 0.5) * 0.45;
        let idx = v > 0.45 ? 0 : v > 0.05 ? 1 : v > -0.45 ? 2 : 3;
        if (!down || !right) idx = Math.max(idx, 2);

        let color = pal[idx];
        if (season === 'spring' && idx <= 1 && noise(x, y, 'bloom') < 0.12) color = dim(noise(x, y, 'pink') > 0.5 ? '#f7b5cf' : '#ffdbe9');
        if (season === 'winter' && !up) color = dim('#ffffff');
        canopyPx.push({ x, y, c: color });
        if (!edge) leaves.push({ x, y });
      }
    }

    // 열매: 500 기여부터, 250마다 하나 (최대 9개)
    if (stats.total >= 500 && (season === 'summer' || season === 'autumn')) {
      const want = Math.min(9, Math.floor(stats.total / 250));
      const picked = [];
      for (const p of [...leaves].sort((a, b) => noise(a.x, a.y, 'fruit') - noise(b.x, b.y, 'fruit'))) {
        if (picked.length >= want) break;
        if (picked.some((q) => Math.abs(q.x - p.x) < 3 && Math.abs(q.y - p.y) < 3)) continue;
        picked.push(p);
        canopyPx.push({ x: p.x, y: p.y, c: dim('#e63946') });
        canopyPx.push({ x: p.x, y: p.y + 1, c: dim('#9d1b20') });
      }
    }

    // 떨어지는 잎: 가을이거나 오래 쉬었을 때
    const falling = season === 'autumn' ? 7 : stats.idleDays >= 7 ? Math.min(10, Math.floor(stats.idleDays / 3)) : 0;
    for (let i = 0; i < falling; i++) {
      // 수관 아래에서 출발해 땅까지 흩날린다
      const x = Math.round(cx0 - R + noise(i, 0, 'fx') * 2 * R);
      const y = Math.min(GY - 1, canopyBottom + 1);
      const dx = Math.round((noise(i, 1, 'fdx') - 0.5) * 9) * P;
      const dy = (GY - y) * P;
      fallLayers.push(`<g class="fall" style="--dx:${dx}px;--dy:${dy}px;animation-duration:${(7 + noise(i, 2, 'fdur') * 6).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'fdel') * 12).toFixed(1)}s">`
        + pixelRects([{ x, y, c: palettes[i % palettes.length][1 + (i % 2)] }]) + '</g>');
    }

    layers = `<g class="sway">${pixelRects(canopyPx)}</g>` + fallLayers.join('');
  }

  // 정보 줄
  const fmt = (n) => n.toLocaleString('en-US');
  const left = `@${username} · ${g.name}`;
  const right = stats.streak > 0
    ? `${fmt(stats.total)} contributions · ${stats.streak}-day streak`
    : stats.idleDays === Infinity
      ? 'waiting for the first commit'
      : `${fmt(stats.total)} contributions · watered ${stats.idleDays}d ago`;

  return toSvg(grid, theme, left, right, `${username}'s pixel garden: ${g.name}, ${fmt(stats.total)} contributions`, layers);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// ---------------------------------------------------------------- 움직임

// <img>로 삽입된 SVG 안에서도 CSS 애니메이션은 동작한다(스크립트는 불가).
// 움직임을 끄고 싶다는 OS 설정은 존중한다.
const STYLE = `<style>
@keyframes gd-sway { 0%,100% { transform: rotate(-0.8deg) } 50% { transform: rotate(0.8deg) } }
@keyframes gd-bob  { 0%,100% { transform: translate(0,0) } 25% { transform: translate(2px,-2.5px) } 75% { transform: translate(-2px,2.5px) } }
@keyframes gd-rise { 0% { transform: translateY(0); opacity: 0 } 12% { opacity: .85 } 88% { opacity: .85 } 100% { transform: translateY(var(--rise)); opacity: 0 } }
@keyframes gd-fall { 0% { transform: translate(0,0) rotate(0deg); opacity: 0 } 8% { opacity: 1 } 92% { opacity: 1 } 100% { transform: translate(var(--dx), var(--dy)) rotate(240deg); opacity: 0 } }
.sway { transform-box: fill-box; transform-origin: 50% 100%; animation: gd-sway 7s ease-in-out infinite }
.bob  { transform-box: fill-box; transform-origin: 50% 50%;  animation: gd-bob 5s ease-in-out infinite }
.rise { animation: gd-rise 6s linear infinite }
.fall { transform-box: fill-box; transform-origin: 50% 50%;  animation: gd-fall 9s linear infinite }
@media (prefers-reduced-motion: reduce) { .sway, .bob, .rise, .fall { animation: none } }
</style>`;

// 흩어진 픽셀 목록을 가로로 이어붙인 rect 로 (배경 격자와 같은 방식)
function pixelRects(px) {
  const rows = new Map();
  for (const q of px) {
    if (!rows.has(q.y)) rows.set(q.y, new Map());
    rows.get(q.y).set(q.x, q.c);
  }
  const out = [];
  for (const [y, row] of [...rows].sort((a, b) => a[0] - b[0])) {
    const xs = [...row.keys()].sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1 && row.get(xs[j + 1]) === row.get(xs[i])) j++;
      out.push(`<rect x="${xs[i] * P}" y="${y * P}" width="${(xs[j] - xs[i] + 1) * P}" height="${P}" fill="${row.get(xs[i])}"/>`);
      i = j + 1;
    }
  }
  return out.join('');
}

function toSvg(grid, theme, left, right, title, layers = '') {
  const rects = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < W) {
      const c = grid[y][x];
      let e = x + 1;
      while (e < W && grid[y][e] === c) e++;
      if (c) rects.push(`<rect x="${x * P}" y="${y * P}" width="${(e - x) * P}" height="${P}" fill="${c}"/>`);
      x = e;
    }
  }
  const w = W * P, h = H * P + FOOTER, ty = H * P + 19;
  const font = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs><clipPath id="frame"><rect width="${w}" height="${h}" rx="10"/></clipPath></defs>
${STYLE}
<g clip-path="url(#frame)">
<rect width="${w}" height="${h}" fill="${theme.frame}"/>
<g shape-rendering="crispEdges">${rects.join('')}${layers}</g>
<text x="12" y="${ty}" font-family="${font}" font-size="11" font-weight="700" fill="${theme.text}">${esc(left)}</text>
<text x="${w - 12}" y="${ty}" text-anchor="end" font-family="${font}" font-size="11" fill="${theme.muted}">${esc(right)}</text>
</g>
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="9.5" fill="none" stroke="${theme.border}"/>
</svg>
`;
}

// ---------------------------------------------------------------- 어항

// 물고기 스프라이트(오른쪽을 봄). B=몸통, E=눈, .=투명
const FISH = ['B.BB.', 'BBBBE', 'B.BB.'];
const FW = 5, FH = 3;

// 물고기 색 [몸통, 배 그늘]
const FISH_COLORS = [
  ['#f4a259', '#c97c33'],
  ['#e8615a', '#b53f3f'],
  ['#f2d06b', '#c9a53c'],
  ['#6fc3df', '#3f92b5'],
  ['#eef2f4', '#b3bfc7'],
  ['#c58bd6', '#9159ab'],
];

const SURF = 4;    // 수면이 있는 행
const FLOOR = 38;  // 자갈이 시작되는 행

function renderTank({ username, stats, theme: themeName }) {
  const theme = THEMES[themeName];
  const light = themeName === 'light';
  // 나무와 다른 시드를 써서 같은 사용자라도 배치가 겹치지 않게 한다
  const noise = makeNoise(`${username}#tank`);
  const dim = (c) => (theme.dim ? mix(c, theme.dim) : c);

  const grid = Array.from({ length: H }, () => Array(W).fill(null));
  const get = (x, y) => (x >= 0 && x < W && y >= 0 && y < H ? grid[y][x] : null);
  const set = (x, y, c) => {
    x = Math.round(x); y = Math.round(y);
    if (x >= 0 && x < W && y >= 0 && y < H) grid[y][x] = c;
  };

  // 수면 위 공기
  for (let y = 0; y < SURF; y++) for (let x = 0; x < W; x++) set(x, y, theme.frame);

  // 물: 아래로 갈수록 짙어진다
  const band = (FLOOR - SURF) / theme.water.length;
  for (let y = SURF; y < FLOOR; y++) {
    const b = Math.min(theme.water.length - 1, Math.floor((y - SURF) / band));
    const edge = b < theme.water.length - 1 && y === SURF + Math.floor((b + 1) * band) - 1;
    for (let x = 0; x < W; x++) set(x, y, edge && (x + y) % 2 ? theme.water[b + 1] : theme.water[b]);
  }

  // 수면 반짝임
  for (let x = 0; x < W; x++) {
    set(x, SURF, mix(theme.water[0], light ? 0.45 : 0.3));
    if (noise(x, 0, 'glint') < 0.2) set(x, SURF - 1, mix(theme.water[0], light ? 0.62 : 0.45));
  }

  // 비스듬히 내려오는 빛줄기
  for (let i = 0; i < 3; i++) {
    const x0 = 6 + Math.floor(noise(i, 0, 'ray') * (W - 18));
    for (let y = SURF + 1; y < FLOOR - 1; y++) {
      const x = x0 + Math.floor((y - SURF) * 0.45);
      if (get(x, y)) set(x, y, mix(get(x, y), light ? 0.16 : 0.1));
      if (get(x + 1, y)) set(x + 1, y, mix(get(x + 1, y), light ? 0.09 : 0.05));
    }
  }

  // 자갈
  const pebble = ['#8d8378', '#a09588', '#766d63', '#b3a99b'].map((c) => mix(c, theme.dim));
  for (let y = FLOOR; y < H; y++)
    for (let x = 0; x < W; x++)
      set(x, y, pebble[Math.floor(noise(x, y, 'peb') * pebble.length)]);
  for (let x = 0; x < W; x++)
    if (noise(x, 0, 'wet') < 0.4) set(x, FLOOR, mix(pebble[1], light ? 0.14 : -0.12));

  // 수초
  const weed = ['#3f9d5a', '#2f7a46', '#54b86c'].map(dim);
  const plants = 3 + Math.floor(noise(0, 0, 'pn') * 3);
  const layers = [];
  for (let i = 0; i < plants; i++) {
    const x0 = 3 + Math.floor(noise(i, 0, 'px') * (W - 6));
    const h = 5 + Math.floor(noise(i, 1, 'ph') * 13);
    const px = [];
    for (let k = 0; k < h; k++) {
      const y = FLOOR - 1 - k;
      const x = x0 + Math.round(Math.sin((k + i * 2) * 0.55) * 1.6);
      px.push({ x, y, c: weed[k % 2] });
      if (k % 3 === 0) px.push({ x: x + (i % 2 ? 1 : -1), y, c: weed[2] });
    }
    layers.push(`<g class="sway" style="animation-duration:${(6 + noise(i, 2, 'pd') * 5).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'pdl') * 7).toFixed(1)}s">${pixelRects(px)}</g>`);
  }

  // 물고기: 최근 30일 중 활동한 하루당 한 마리
  const fishCount = Math.max(0, Math.min(30, stats.activeDays));
  const placed = [];
  for (let i = 0, tries = 0; placed.length < fishCount && tries < 600; tries++) {
    const x = 1 + Math.floor(noise(i, tries, 'fx') * (W - FW - 2));
    const y = SURF + 2 + Math.floor(noise(i, tries, 'fy') * (FLOOR - SURF - FH - 3));
    if (placed.some((p) => Math.abs(p.x - x) < FW + 1 && Math.abs(p.y - y) < FH + 1)) continue;

    const right = noise(i, 0, 'dir') > 0.5;
    const pal = FISH_COLORS[Math.floor(noise(i, 1, 'col') * FISH_COLORS.length)].map(dim);
    const px = [];
    for (let dy = 0; dy < FH; dy++) {
      for (let dx = 0; dx < FW; dx++) {
        const ch = FISH[dy][right ? dx : FW - 1 - dx];
        if (ch === '.') continue;
        px.push({ x: x + dx, y: y + dy, c: ch === 'E' ? dim('#1b1f24') : dy === FH - 1 ? pal[1] : pal[0] });
      }
    }
    layers.push(`<g class="bob" style="animation-duration:${(4 + noise(i, 2, 'fd') * 4).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'fdl') * 8).toFixed(1)}s">${pixelRects(px)}</g>`);
    placed.push({ x, y });
    i++;
  }

  // 기포: 물만 덮는다
  const bubble = mix(theme.water[0], light ? 0.55 : 0.4);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(noise(i, 0, 'bx') * W);
    const y = SURF + 1 + Math.floor(noise(i, 1, 'by') * (FLOOR - SURF - 2));
    if (!theme.water.includes(get(x, y))) continue;
    layers.push(`<g class="rise" style="--rise:${-((y - SURF) * P + P)}px;animation-duration:${(5 + noise(i, 2, 'bd') * 5).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'bdl') * 10).toFixed(1)}s">${pixelRects([{ x, y, c: bubble }])}</g>`);
  }

  const fmt = (n) => n.toLocaleString('en-US');
  const left = `@${username} · ${fishCount} fish`;
  const right = stats.recentTotal > 0
    ? `last 30 days · ${fmt(stats.recentTotal)} contributions`
    : 'quiet water';

  return toSvg(grid, theme, left, right, `${username}'s aquarium: ${fishCount} fish from the last 30 days`, layers.join(''));
}

// ---------------------------------------------------------------- 실행

async function writeDemo(username) {
  const month = Number(todayIn('Asia/Seoul').slice(5, 7));
  const groups = [
    ['Growth stages', [0, 3, 25, 120, 350, 800, 2500].map((total) => ({ label: `${total} contributions`, stats: { total, streak: total ? 4 : 0, idleDays: total ? 0 : Infinity, month } }))],
    ['Seasons (800 contributions)', [4, 7, 10, 1].map((m) => ({ label: seasonOf(m), stats: { total: 800, streak: 12, idleDays: 0, month: m } }))],
    ['Idle days (350 contributions)', [0, 5, 10, 20, 40].map((idle) => ({ label: `${idle} days idle`, stats: { total: 350, streak: idle ? 0 : 3, idleDays: idle, month } }))],
  ];
  const card = (item, theme) => `<figure>${render({ username, stats: item.stats, theme })}<figcaption>${esc(item.label)} · ${theme}</figcaption></figure>`;
  const tanks = [0, 3, 8, 15, 22, 30].map((activeDays) => ({
    label: `${activeDays} active days`,
    stats: { activeDays, recentTotal: activeDays * 7, month },
  }));
  const tankCard = (item, theme) => `<figure>${renderTank({ username, stats: item.stats, theme })}<figcaption>${esc(item.label)} · ${theme}</figcaption></figure>`;
  const html = `<!doctype html><meta charset="utf-8"><title>profile-garden preview</title>
<style>
body{margin:0;padding:24px;background:#f6f8fa;font:14px system-ui,sans-serif;color:#1f2328}
h2{margin:32px 0 12px;font-size:16px}
.row{display:flex;flex-wrap:wrap;gap:16px}
figure{margin:0}
figcaption{font-size:12px;color:#656d76;margin-top:4px}
.dark{background:#0d1117;padding:16px;border-radius:12px}
.dark figcaption{color:#8d96a0}
</style>
${groups.map(([title, items]) => `<h2>${esc(title)}</h2><div class="row">${items.map((i) => card(i, 'light')).join('')}</div>`).join('\n')}
<h2>Aquarium — 최근 30일 중 활동한 하루당 물고기 한 마리</h2><div class="row">${tanks.map((i) => tankCard(i, 'light')).join('')}</div>
<h2>Dark theme</h2><div class="row dark">${groups[0][1].slice(3).map((i) => card(i, 'dark')).join('')}${tanks.slice(2).map((i) => tankCard(i, 'dark')).join('')}</div>`;
  await mkdir(join(ROOT, 'preview'), { recursive: true });
  await writeFile(join(ROOT, 'preview', 'index.html'), html);
  console.log('preview/index.html written');
}

const config = await loadConfig();

if (process.argv.includes('--demo')) {
  await writeDemo(config.username || 'octocat');
} else {
  const token = process.env.GITHUB_TOKEN;
  if (!config.username) throw new Error('Set "username" in garden.config.json or GARDEN_USER.');
  if (!token) throw new Error('GITHUB_TOKEN is required.');

  const stats = await fetchStats(config.username, config.timeZone, token);
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  for (const theme of Object.keys(THEMES)) {
    await writeFile(join(ROOT, 'dist', `tree-${theme}.svg`), render({ username: config.username, stats, theme }));
    await writeFile(join(ROOT, 'dist', `tank-${theme}.svg`), renderTank({ username: config.username, stats, theme }));
  }
  console.log(`${config.username}: ${growth(stats.total).name}, total ${stats.total}, streak ${stats.streak}, idle ${stats.idleDays}d`);
}
