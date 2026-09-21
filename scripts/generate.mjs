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

// 토큰이 가진 OAuth 스코프. 헤더를 주지 않는 토큰(Actions 기본 토큰 등)에서는 null로 남는다
let tokenScopes = null;

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
  if (tokenScopes === null) tokenScopes = res.headers.get('x-oauth-scopes');
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API error: ${JSON.stringify(json.errors ?? json)}`);
  return json.data;
}

// 토큰 주인. 조회에 실패해도 그림은 그려야 하므로 삼키고 null을 돌려준다
async function viewerLogin(token) {
  try {
    const data = await gql('query { viewer { login } }', {}, token);
    return data.viewer?.login ?? null;
  } catch {
    return null;
  }
}

async function fetchStats(username, timeZone, token) {
  const base = await gql(
    `query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionYears
          restrictedContributionsCount
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
  return {
    ...summarize(total, days, todayIn(timeZone)),
    countsPrivate: await countsPrivate(username, cc.restrictedContributionsCount, token),
  };
}

// 비공개 저장소 기여가 위 숫자에 들어 있는지 판단한다. 들어오는 길은 둘뿐이다.
//   1) 프로필 설정에서 비공개 기여를 공개한 경우. 이때 restrictedContributionsCount가 0보다 크고,
//      달력 합계에 이미 포함돼 있다. 따로 더하면 두 번 세는 셈이라 더하지 않는다.
//   2) 본인 계정의 read:user 토큰으로 조회한 경우. 공개하지 않아도 본인에게는 보인다.
async function countsPrivate(username, restricted, token) {
  if (restricted > 0) return true;
  const viewer = await viewerLogin(token);
  if (viewer?.toLowerCase() !== username.toLowerCase()) return false;
  return tokenScopes === null || tokenScopes.split(/,\s*/).includes('read:user');
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

  // 활동한 날의 기여 수를 그대로 넘긴다. 물고기 크기가 여기서 나온다
  const recentDays = recent.filter((c) => c > 0);

  return { total, streak, idleDays, activeDays, recentDays, recentTotal, month: Number(today.slice(5, 7)) };
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
const TRUNK_H = [0, 2, 4, 8, 13, 17, 20, 23];
const TRUNK_W = [0, 1, 1, 2, 3, 4, 5, 6];
const CANOPY_R = [0, 0, 2.4, 4.5, 7.5, 10, 11.2, 11.8];

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

// 두 색 사이를 t 만큼 섞는다
function blend(a, b, t) {
  const ch = (hex, shift) => (parseInt(hex.slice(1), 16) >> shift) & 255;
  return `#${[16, 8, 0].map((s) => Math.round(ch(a, s) * (1 - t) + ch(b, s) * t).toString(16).padStart(2, '0')).join('')}`;
}

// 위에서 아래로 BANDS 단계의 띠를 만든다. 단계가 촘촘해서 경계를 디더링할 필요가 없다
const BANDS = 14;
const ramp = (from, to) => Array.from({ length: BANDS }, (_, i) => blend(from, to, i / (BANDS - 1)));

const THEMES = {
  light: {
    sky: ramp('#9fd3ee', '#daeff7'),
    water: ramp('#7cc5e9', '#317fb0'),
    frame: '#ffffff', text: '#1f2328', muted: '#656d76', border: '#d0d7de',
    dim: 0,
  },
  dark: {
    sky: ramp('#0b1224', '#1b2b4c'),
    water: ramp('#123049', '#08182a'),
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

function scene({ username, stats, theme: themeName, plain = false }) {
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
  const layers = [];
  const circle = (cx, cy, r, c) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) set(x, y, c);
  };

  // 하늘: 위로 갈수록 짙어진다. plain 은 배경 없이 나무만 남긴다(문서용 띠)
  const band = GY / theme.sky.length;
  if (!plain) for (let y = 0; y < GY; y++) {
    const c = theme.sky[Math.min(theme.sky.length - 1, Math.floor(y / band))];
    for (let x = 0; x < W; x++) set(x, y, c);
  }

  if (plain) {
    // 해·달·구름·별은 배경이 있어야 말이 되므로 함께 뺀다
  } else if (themeName === 'light') {
    circle(61, 7, 3.2, '#ffd45e');
    circle(60.5, 6.5, 1.6, '#ffe99c');
    // 해 둘레 한 겹만 밝기가 오르내린다
    const halo = crescent(disc(61, 7, 4.6), disc(61, 7, 3.2)).map((p) => ({ ...p, c: '#ffe99c' }));
    layers.push(`<g class="pulse" style="animation-duration:11s"><g opacity="0.5">${pixelRects(halo)}</g></g>`);

    // 구름은 아주 느리게 흘러간다. 한 벌을 왼쪽 밖에 더 두어 끊기지 않게 잇는다
    const cloud = ['  ####   ', ' ####### ', '#########', ' ####### '];
    const cw = cloud[0].length, span = W + cw;
    [[6 + Math.floor(noise(0, 0, 'cx') * 14), 6], [30 + Math.floor(noise(1, 0, 'cx') * 12), 12]].forEach(([ox, oy], i) => {
      const px = [];
      for (const copy of [0, -span]) {
        cloud.forEach((row, dy) => [...row].forEach((ch, dx) => {
          if (ch === '#') px.push({ x: ox + dx + copy, y: oy + dy, c: dy === cloud.length - 1 ? '#e6f3f9' : '#ffffff' });
        }));
      }
      layers.push(`<g class="drift" style="--to:${span * P}px;animation-duration:${96 + i * 34}s;animation-delay:-${(noise(i, 1, 'cd') * 90).toFixed(1)}s;animation-timing-function:steps(${span},end)">${pixelRects(px)}</g>`);
    });
  } else {
    // 별은 세 조로 나눠 엇갈리게 깜빡인다
    const stars = [[], [], []];
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(noise(i, 0, 'sx') * W);
      const y = Math.floor(noise(i, 1, 'sy') * (GY - 14));
      if (Math.abs(x - 60) > 5 || Math.abs(y - 7) > 5) stars[i % 3].push({ x, y, c: noise(i, 2, 'sb') > 0.5 ? '#fdf5d3' : '#6f7aa3' });
    }
    stars.forEach((px, i) => {
      if (px.length) layers.push(`<g class="twinkle" style="animation-duration:${(5.2 + i * 1.7).toFixed(1)}s;animation-delay:-${(i * 2.3).toFixed(1)}s">${pixelRects(px)}</g>`);
    });

    // 초승달: 큰 원에서 작은 원을 뺀 자리만 칠한다(덮어 지우면 하늘 띠와 색이 어긋난다)
    for (const p of crescent(disc(60, 7, 3.2), disc(61.6, 5.9, 2.7))) set(p.x, p.y, '#f3eecf');
    const glow = crescent(disc(60, 7, 4.4), disc(60, 7, 3.4)).map((p) => ({ ...p, c: '#cfd8ee' }));
    layers.push(`<g class="pulse" style="animation-duration:13s"><g opacity="0.3">${pixelRects(glow)}</g></g>`);
  }

  // 땅
  const grass = GRASS[season].map(dim);
  const dirt = ['#8a5a3b', '#744a30', '#9d6b48'].map((c) => mix(c, theme.dim * 1.4));
  const tufts = [];
  for (let x = 0; x < W; x++) {
    set(x, GY, grass[0]);
    set(x, GY + 1, (x % 2) ? grass[1] : grass[0]);
    set(x, GY + 2, (x % 2) ? dirt[0] : grass[1]);
    for (let y = GY + 3; y < H; y++) set(x, y, noise(x, y, 'dirt') < 0.13 ? dirt[2] : (y % 2 ? dirt[0] : dirt[1]));
    if (noise(x, 0, 'tuft') < 0.1) tufts.push({ x, y: GY - 1, c: grass[0] });
  }

  // 여름 햇살: 나무 뒤로 비스듬히 내리쬔다
  if (season === 'summer' && themeName === 'light' && !plain) {
    for (let i = 0; i < 3; i++) {
      const px = [];
      let rx = 56 - i * 9 + Math.floor(noise(i, 0, 'sunx') * 4);
      for (let y = 9; y < GY - 1; y++) { px.push({ x: Math.round(rx), y, c: '#ffffff' }); rx -= 0.62; }
      layers.push(`<g class="pulse" style="animation-duration:${(7 + i * 2.5).toFixed(1)}s;animation-delay:-${i * 2}s"><g opacity="0.3">${pixelRects(px)}</g></g>`);
    }
  }

  // 나무
  const bark = dim('#7a4e2d'), barkDark = dim('#5a381f'), barkLight = dim('#96633b');
  const palettes = LEAVES[season].map((p) => p.map(dim));

  // 가을에는 발치에 낙엽이 쌓인다
  if (season === 'autumn') {
    for (let x = 0; x < W; x++) {
      if (noise(x, 5, 'litter') >= 0.28) continue;
      const pal = palettes[Math.floor(noise(x, 6, 'lit2') * palettes.length)];
      set(x, GY - 1, pal[1 + Math.floor(noise(x, 7, 'lit3') * 3)]);
    }
  }

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
    if (w >= 5) {
      set(x0 - 3, GY - 1, barkDark); set(x0 + w + 2, GY - 1, barkDark);
      set(x0 - 2, GY - 2, barkDark); set(x0 + w + 1, GY - 2, barkDark);
    }

    const blobs = [{ x: CX, y: topY - r * 0.35, r }];
    const branches = Math.max(0, Math.min(5, g.stage - 1));
    for (let i = 0; i < branches; i++) {
      const dir = i % 2 === 0 ? -1 : 1;
      const y0 = Math.round(GY - h * (0.5 + 0.38 * noise(i, 0, 'by')));
      const len = Math.max(2, Math.round(r * (0.55 + 0.35 * noise(i, 1, 'bl'))));
      const sx = dir < 0 ? x0 - 1 : x0 + w;
      for (let k = 0; k < len; k++) set(sx + dir * k, y0 - Math.floor(k * 0.7), barkDark);
      blobs.push({ x: sx + dir * (len - 1), y: y0 - Math.floor((len - 1) * 0.7) - 1, r: r * (0.5 + 0.22 * noise(i, 2, 'br')) });
    }
    if (g.stage >= 4) blobs.push({ x: CX + (noise(0, 0, 'tx') - 0.5) * r * 0.6, y: topY - r * 0.95, r: r * 0.62 });
    if (g.stage >= 6) {
      blobs.push({ x: CX - r * 0.58, y: topY - r * 0.72, r: r * 0.5 });
      blobs.push({ x: CX + r * 0.62, y: topY - r * 0.46, r: r * 0.45 });
    }

    const inCanopy = (x, y) => y < GY - 1 && blobs.some((b) => (x - b.x) ** 2 + (y - b.y) ** 2 * 1.15 <= b.r * b.r + 0.5);
    // 겉면에 가까운 잎일수록 바람을 크게 탄다. 2=겉잎, 1=중간, 0=속잎
    const depthAt = (x, y) => {
      const on = (dx, dy) => inCanopy(x + dx, y + dy);
      if (!(on(0, -1) && on(0, 1) && on(-1, 0) && on(1, 0))) return 2;
      if (!(on(0, -2) && on(0, 2) && on(-2, 0) && on(2, 0))) return 1;
      return 0;
    };
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
        canopyPx.push({ x, y, c: color, depth: depthAt(x, y) });
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
        canopyPx.push({ x: p.x, y: p.y, c: dim('#e63946'), depth: depthAt(p.x, p.y) });
        canopyPx.push({ x: p.x, y: p.y + 1, c: dim('#9d1b20'), depth: depthAt(p.x, p.y + 1) });
      }
    }

    // 떨어지는 잎: 가을이거나 오래 쉬었을 때
    const falling = season === 'autumn' ? 15
      : season === 'spring' ? 8
        : stats.idleDays >= 7 ? Math.min(10, Math.floor(stats.idleDays / 3)) : 0;
    // 봄에 떨어지는 건 잎이 아니라 꽃잎이다
    const petal = season === 'spring' ? ['#f7b5cf', '#ffdbe9', '#f28fb4'].map(dim) : null;
    for (let i = 0; i < falling; i++) {
      // 수관 아래에서 출발해 땅까지 흩날린다
      const x = Math.round(cx0 - R + noise(i, 0, 'fx') * 2 * R);
      const y = Math.min(GY - 1, canopyBottom + 1);
      const rows = Math.max(1, GY - y);
      const swing = P * (1 + (i % 2));
      fallLayers.push(
        `<g class="fall" style="--dy:${rows * P}px;animation-duration:${(7 + noise(i, 2, 'fdur') * 6).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'fdel') * 12).toFixed(1)}s;animation-timing-function:steps(${rows},end)">`
        + `<g class="sway" style="--a:${swing}px;animation-duration:${(1.6 + noise(i, 1, 'fdx') * 1.6).toFixed(1)}s">`
        + pixelRects([{ x, y, c: petal ? petal[i % petal.length] : palettes[i % palettes.length][1 + (i % 2)] }])
        + '</g></g>');
    }

    const depths = [[], [], []];
    for (const q of canopyPx) depths[q.depth].push(q);
    const beat = ['12.5s', '9.1s', '6.7s'], lag = ['0s', '-2.1s', '-4.3s'];
    const rustle = depths
      .map((px, d) => (px.length ? `<g class="sway" style="--a:${P}px;animation-duration:${beat[d]};animation-delay:${lag[d]}">${pixelRects(px)}</g>` : ''))
      .join('');
    layers.push(`<g class="gust" style="--g:${P}px;animation-duration:17s">${rustle}</g>`, fallLayers.join(''));
  }

  // 겨울에는 화면 전체로 눈이 내린다
  if (season === 'winter' && !plain) {
    for (let i = 0; i < 20; i++) {
      const x = Math.floor(noise(i, 0, 'snowx') * W);
      const y = Math.floor(noise(i, 1, 'snowy') * 6);
      const rows = GY - y;
      layers.push(`<g class="fall" style="--dy:${rows * P}px;animation-duration:${(9 + noise(i, 2, 'snowd') * 8).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'snowl') * 16).toFixed(1)}s;animation-timing-function:steps(${rows},end)">`
        + `<g class="sway" style="--a:${P}px;animation-duration:${(2.2 + noise(i, 4, 'snoww') * 2).toFixed(1)}s">`
        + pixelRects([{ x, y, c: dim('#ffffff') }]) + '</g></g>');
    }
  }

  // 나비: 봄·여름에 수관 근처를 맴돈다
  const flies = plain || g.stage < 2 ? 0 : season === 'spring' ? 2 : season === 'summer' ? 1 : 0;
  for (let i = 0; i < flies; i++) {
    const cols = { '#': dim(noise(i, 0, 'wing') > 0.5 ? '#ffd76e' : '#f79ac8'), o: dim('#4a3b2a') };
    const fx = CX - 12 + Math.floor(noise(i, 1, 'flyx') * 24);
    const fy = GY - 8 - Math.floor(noise(i, 2, 'flyy') * 12);
    const frames = flipbook(
      pixelRects(sprite(FLUTTER[0], cols, fx, fy)),
      pixelRects(sprite(FLUTTER[1], cols, fx, fy)),
      (0.28 + noise(i, 3, 'flyf') * 0.12).toFixed(2), noise(i, 4, 'flyfd'));
    layers.push(`<g class="sway" style="--a:${2 * P}px;animation-duration:${(3.4 + noise(i, 5, 'flysx') * 2).toFixed(1)}s">`
      + `<g class="bob" style="--a:${P}px;animation-duration:${(2.2 + noise(i, 6, 'flysy') * 1.6).toFixed(1)}s">${frames}</g></g>`);
  }

  if (tufts.length) layers.push(`<g class="sway" style="--a:${P}px;animation-duration:13s;animation-delay:-3.5s">${pixelRects(tufts)}</g>`);

  // 정보 줄
  const fmt = (n) => n.toLocaleString('en-US');
  const left = `@${username} · ${g.name}`;
  const right = stats.streak > 0
    ? `${fmt(stats.total)} contributions · ${stats.streak}-day streak`
    : stats.idleDays === Infinity
      ? 'waiting for the first commit'
      : `${fmt(stats.total)} contributions · watered ${stats.idleDays}d ago`;

  return { grid, theme, left, right, title: `${username}'s pixel garden: ${g.name}, ${fmt(stats.total)} contributions`, layers: layers.join('') };
}

function render(opts) {
  const s = scene(opts);
  return toSvg(s.grid, s.theme, s.left, s.right, s.title, s.layers);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// 나비(2프레임 날갯짓). #=날개, o=몸통, .=투명
const FLUTTER = [['#.#', '.o.', '#.#'], ['.#.', '.o.', '.#.']];

// ---------------------------------------------------------------- 움직임

// <img>로 삽입된 SVG 안에서도 CSS 애니메이션은 동작한다(스크립트는 불가).
// 움직임을 끄고 싶다는 OS 설정은 존중한다.
// 이동량은 모두 격자 한 칸(P)의 배수이고 steps() 로 프레임을 끊는다. 소수점 px 로
// 미끄러지면 보간 때문에 픽셀이 뭉개져서, 끊어 주는 쪽이 오히려 선명하다.
// 그룹 하나는 축 하나만 맡고(가로·세로·깜빡임) 중첩해서 합친다.
const STYLE = `<style>
@keyframes gd-sway  { 0%,100% { transform: translateX(0) } 25% { transform: translateX(var(--a)) } 50% { transform: translateX(0) } 75% { transform: translateX(calc(0px - var(--a))) } }
@keyframes gd-bob   { 0%,100% { transform: translateY(0) } 25% { transform: translateY(var(--a)) } 50% { transform: translateY(0) } 75% { transform: translateY(calc(0px - var(--a))) } }
@keyframes gd-gust  { 0%,60% { transform: translateX(0) } 64%,78% { transform: translateX(var(--g)) } 82%,100% { transform: translateX(0) } }
@keyframes gd-fall  { 0% { transform: translateY(0); opacity: 0 } 6% { opacity: 1 } 88% { opacity: 1 } 100% { transform: translateY(var(--dy)); opacity: 0 } }
@keyframes gd-rise  { 0% { transform: translateY(0); opacity: 0 } 10% { opacity: .9 } 78% { opacity: .9 } 100% { transform: translateY(var(--rise)); opacity: 0 } }
@keyframes gd-swim  { 0%,4% { transform: translateX(0) scaleX(1) } 46%,48% { transform: translateX(var(--sx)) scaleX(1) }
  48.5%,50% { transform: translateX(var(--sx)) scaleX(-1) } 92%,98% { transform: translateX(0) scaleX(-1) }
  98.5%,100% { transform: translateX(0) scaleX(1) } }
@keyframes gd-glint { 0%,46% { opacity: 0 } 52%,62% { opacity: 1 } 68%,100% { opacity: 0 } }
@keyframes gd-pulse { 0%,100% { opacity: .55 } 50% { opacity: 1 } }
@keyframes gd-drift { 0% { transform: translateX(0) } 100% { transform: translateX(var(--to)) } }
@keyframes gd-twinkle { 0%,88% { opacity: 1 } 90%,94% { opacity: .2 } 96%,100% { opacity: 1 } }
@keyframes gd-f1    { 0%,49% { opacity: 1 } 50%,100% { opacity: 0 } }
@keyframes gd-f2    { 0%,49% { opacity: 0 } 50%,100% { opacity: 1 } }
.sway  { animation: gd-sway 8s steps(1,end) infinite }
.bob   { animation: gd-bob 4s steps(1,end) infinite }
.gust  { animation: gd-gust 17s steps(1,end) infinite }
.fall  { animation: gd-fall 9s linear infinite }
.rise  { animation: gd-rise 6s linear infinite }
.swim  { transform-box: fill-box; transform-origin: 50% 50%; animation: gd-swim 16s linear infinite }
.glint { animation: gd-glint 4s steps(1,end) infinite }
.pulse { animation: gd-pulse 9s ease-in-out infinite }
.drift { animation: gd-drift 96s linear infinite }
.twinkle { animation: gd-twinkle 6s steps(1,end) infinite }
.f1    { animation: gd-f1 .5s steps(1,end) infinite }
.f2    { animation: gd-f2 .5s steps(1,end) infinite }
@media (prefers-reduced-motion: reduce) {
  .sway, .bob, .gust, .fall, .rise, .swim, .glint, .pulse, .drift, .twinkle, .f1, .f2 { animation: none }
  .f2 { opacity: 0 }
}
</style>`;

// 채워진 원의 픽셀 좌표. 두 개를 빼면 초승달이나 후광이 된다
function disc(cx, cy, r) {
  const px = [];
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.3) px.push({ x, y });
    }
  }
  return px;
}

// 두 원의 차집합
function crescent(outer, inner) {
  const cut = new Set(inner.map((p) => `${p.x},${p.y}`));
  return outer.filter((p) => !cut.has(`${p.x},${p.y}`));
}

// 문자 격자를 픽셀 목록으로. 오른쪽을 보는 스프라이트는 flip 으로 뒤집는다.
// colors 에 없는 문자는 투명으로 둔다.
function sprite(rows, colors, x0, y0, flip = false) {
  const w = rows[0].length;
  const px = [];
  rows.forEach((row, dy) => {
    for (let dx = 0; dx < w; dx++) {
      const c = colors[row[flip ? w - 1 - dx : dx]];
      if (c) px.push({ x: x0 + dx, y: y0 + dy, c });
    }
  });
  return px;
}

// 두 프레임을 번갈아 보여 준다(페이드가 아니라 교체 — 날갯짓용)
function flipbook(a, b, dur, delay) {
  const s = `animation-duration:${dur}s;animation-delay:-${delay.toFixed(2)}s`;
  return `<g class="f1" style="${s}">${a}</g><g class="f2" style="${s}">${b}</g>`;
}

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

// 물고기 스프라이트(오른쪽을 봄). #=몸통 d=등·꼬리 :=배 *=무늬 ^=지느러미 o=눈 .=투명
// 폭이 좁은 순서로 둔다. 그날 기여가 많을수록 뒤쪽 종이 나온다
const FISH_SPECIES = [
  ['.##.',
    'd##o',
    '.##.'],
  ['.ddd.',
    'd####',
    'dd##o',
    'd####',
    '.^:::'],
  ['d..dd.',
    'dd####',
    'dd###o',
    'd.^:::'],
  ['..ddd..',
    'dd#*#*#',
    'dd#*#*o',
    '.d^::::'],
  ['..ddddd.',
    'dd#####o',
    '.d^:::::'],
];

// 물고기 색 [몸통, 등·꼬리]. 배·무늬는 몸통색에서 계산한다
const FISH_COLORS = [
  ['#f4a259', '#c97c33'],
  ['#e8615a', '#b53f3f'],
  ['#f2d06b', '#c9a53c'],
  ['#6fc3df', '#3f92b5'],
  ['#eef2f4', '#b3bfc7'],
  ['#c58bd6', '#9159ab'],
  ['#7fd6a2', '#46a06e'],
  ['#8fa2f0', '#5567c4'],
];

// 자갈 위를 아주 느리게 오가는 달팽이. s=껍데기 c=무늬 b=몸 a=더듬이
const SNAIL = ['.ss..a', 'sscsbb', '.bbbbb'];

// 바닥 장식 [주색, 그늘색]. A·B 두 문자만 쓴다
const DECOR = [
  { rows: ['.A.A.', 'ABABA', 'BBBBB'], colors: ['#f2ddd2', '#c69b8b'] },
  { rows: ['A...A', 'A.A.A', '.AAA.', '..A..', '..B..'], colors: ['#e8746a', '#b8453f'], sway: true },
  { rows: ['.AAAAA.', 'ABBBBBA', '..A.A..'], colors: ['#6b4b35', '#4e3627'] },
  { rows: ['..AA..', '.AAAA.', 'AABBAA'], colors: ['#7b7168', '#5c554e'] },
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

  // 수면 위: 공기와 유리 테두리. 빈 띠로 두면 카드가 잘린 것처럼 보인다
  for (let y = 0; y < SURF; y++) for (let x = 0; x < W; x++) set(x, y, theme.frame);
  for (let x = 0; x < W; x++) {
    set(x, 0, mix(theme.border, light ? -0.22 : 0.16));
    set(x, 1, theme.border);
  }
  // 유리 안쪽에 맺힌 물방울
  for (let i = 0; i < 3; i++) {
    set(6 + Math.floor(noise(i, 0, 'dew') * (W - 12)), 2 + (i % 2), mix(theme.frame, light ? -0.14 : 0.24));
  }

  // 물: 아래로 갈수록 짙어진다
  const band = (FLOOR - SURF) / theme.water.length;
  for (let y = SURF; y < FLOOR; y++) {
    const c = theme.water[Math.min(theme.water.length - 1, Math.floor((y - SURF) / band))];
    for (let x = 0; x < W; x++) set(x, y, c);
  }

  // 수면: 물결선은 고정이고 반짝임만 깜빡인다
  const layers = [];
  const glints = [[], [], []];
  for (let x = 0; x < W; x++) {
    set(x, SURF, mix(theme.water[0], light ? 0.45 : 0.3));
    if (noise(x, 0, 'glint') < 0.2) glints[x % 3].push({ x, y: SURF - 1, c: mix(theme.water[0], light ? 0.62 : 0.45) });
  }
  glints.forEach((px, i) => {
    if (px.length) layers.push(`<g class="glint" style="animation-duration:${(3.4 + i * 1.3).toFixed(1)}s;animation-delay:-${(i * 1.7).toFixed(1)}s">${pixelRects(px)}</g>`);
  });

  // 비스듬히 내려오는 빛줄기: 아주 느리게 흐르고 밝기가 오르내린다
  for (let i = 0; i < 3; i++) {
    const x0 = 6 + Math.floor(noise(i, 0, 'ray') * (W - 18));
    const core = [], side = [];
    for (let y = SURF + 1; y < FLOOR - 1; y++) {
      const x = x0 + Math.floor((y - SURF) * 0.45);
      if (get(x, y)) core.push({ x, y, c: '#ffffff' });
      if (get(x + 1, y)) side.push({ x: x + 1, y, c: '#ffffff' });
    }
    layers.push(`<g class="sway" style="--a:${P}px;animation-duration:${19 + i * 4}s;animation-delay:-${(noise(i, 1, 'rd') * 18).toFixed(1)}s">`
      + `<g class="pulse" style="animation-duration:${(8 + noise(i, 2, 'rp') * 6).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'rpd') * 9).toFixed(1)}s">`
      + `<g opacity="${light ? 0.17 : 0.11}">${pixelRects(core)}</g><g opacity="${light ? 0.09 : 0.06}">${pixelRects(side)}</g>`
      + '</g></g>');
  }

  // 자갈
  const pebble = ['#8d8378', '#a09588', '#766d63', '#b3a99b'].map((c) => mix(c, theme.dim));
  for (let y = FLOOR; y < H; y++)
    for (let x = 0; x < W; x++)
      set(x, y, pebble[Math.floor(noise(x, y, 'peb') * pebble.length)]);
  for (let x = 0; x < W; x++)
    if (noise(x, 0, 'wet') < 0.4) set(x, FLOOR, mix(pebble[1], light ? 0.14 : -0.12));

  // 바닥 장식: 어항마다 종류도 자리도 달라진다
  const decorFrom = Math.floor(noise(0, 1, 'doff') * DECOR.length);
  for (let i = 0, decor = 3 + Math.floor(noise(0, 0, 'dn') * 2); i < decor; i++) {
    // 종류가 겹치지 않게 돌려 가며 고른다
    const d = DECOR[(decorFrom + i) % DECOR.length];
    const dw = d.rows[0].length;
    const x = 2 + Math.min(W - dw - 4, Math.floor((W - dw - 4) * (i + noise(i, 1, 'dx')) / decor));
    const y = FLOOR - d.rows.length;
    const colors = { A: mix(d.colors[0], theme.dim), B: mix(d.colors[1], theme.dim) };
    if (!d.sway) { layers.push(pixelRects(sprite(d.rows, colors, x, y))); continue; }
    // 산호는 윗가지만 물살을 탄다
    const top = d.rows.slice(0, -2);
    layers.push(pixelRects(sprite(d.rows.slice(-2), colors, x, y + top.length))
      + `<g class="sway" style="--a:${P}px;animation-duration:${(7 + noise(i, 2, 'dd') * 4).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'ddl') * 6).toFixed(1)}s">${pixelRects(sprite(top, colors, x, y))}</g>`);
  }

  // 달팽이 한 마리. 물고기와 같은 순찰 애니메이션을 훨씬 느리게 쓴다
  {
    const sw = SNAIL[0].length;
    const x = 4 + Math.floor(noise(0, 0, 'snx') * (W - sw - 20));
    const dist = 12 + Math.floor(noise(0, 1, 'snd') * 7);
    const px = sprite(SNAIL, {
      s: mix('#c8823f', theme.dim), c: mix('#8f5828', theme.dim),
      b: mix('#e8dcc8', theme.dim), a: mix('#d8c9b2', theme.dim),
    }, x, FLOOR - SNAIL.length);
    layers.push(`<g class="swim" style="--sx:${dist * P}px;animation-duration:${(dist * 6).toFixed(0)}s;animation-delay:-${(noise(0, 2, 'snl') * 60).toFixed(1)}s;animation-timing-function:steps(${dist},end)">${pixelRects(px)}</g>`);
  }

  // 수초
  const weed = ['#3f9d5a', '#2f7a46', '#54b86c'].map(dim);
  const plants = 3 + Math.floor(noise(0, 0, 'pn') * 3);
  for (let i = 0; i < plants; i++) {
    const x0 = 3 + Math.floor(noise(i, 0, 'px') * (W - 6));
    const h = 5 + Math.floor(noise(i, 1, 'ph') * 13);
    const root = [], stem = [], tip = [];
    for (let k = 0; k < h; k++) {
      const y = FLOOR - 1 - k;
      const x = x0 + Math.round(Math.sin((k + i * 2) * 0.55) * 1.6);
      const seg = k < 2 ? root : k < h * 0.6 ? stem : tip;
      seg.push({ x, y, c: weed[k % 2] });
      if (k % 3 === 0) seg.push({ x: x + (i % 2 ? 1 : -1), y, c: weed[2] });
    }
    const beat = 6 + noise(i, 2, 'pd') * 5;
    const lag = (noise(i, 3, 'pdl') * 7).toFixed(1);
    layers.push(pixelRects(root)
      + `<g class="sway" style="--a:${P}px;animation-duration:${(beat * 1.4).toFixed(1)}s;animation-delay:-${lag}s">${pixelRects(stem)}</g>`
      + `<g class="sway" style="--a:${P}px;animation-duration:${beat.toFixed(1)}s;animation-delay:-${lag}s">${pixelRects(tip)}</g>`);
  }

  // 물고기: 최근 30일 중 활동한 하루당 한 마리
  const fishCount = Math.max(0, Math.min(30, stats.activeDays));
  const days = stats.recentDays ?? [];
  const placed = [];
  for (let i = 0, tries = 0; placed.length < fishCount && tries < 2000; tries++) {
    // 1 → 치어, 2~3 → 둥근형, 4~7 → 기본, 8~15 → 줄무늬, 16+ → 길쭉이
    const tier = Math.floor(Math.log2(Math.max(1, days[i] ?? 1)));
    const kind = FISH_SPECIES[Math.min(FISH_SPECIES.length - 1, tier)];
    const fw = kind[0].length, fh = kind.length;
    const x = 1 + Math.floor(noise(i, tries, 'fx') * (W - fw - 2));
    const y = SURF + 2 + Math.floor(noise(i, tries, 'fy') * (FLOOR - SURF - fh - 3));
    // 사각형끼리 한 칸 여유를 두고 겹치지 않게
    if (placed.some((p) => x < p.x + p.w + 1 && p.x < x + fw + 1 && y < p.y + p.h + 1 && p.y < y + fh + 1)) continue;

    // 여유가 큰 쪽으로 순찰한다. 이동 방향이 곧 바라보는 방향이다
    const roomR = W - 1 - fw - x, roomL = x - 1;
    const dir = roomR >= roomL ? 1 : -1;
    const dist = Math.max(0, Math.min(4 + Math.floor(noise(i, 4, 'sw') * 11), dir > 0 ? roomR : roomL));
    const [skin, back] = FISH_COLORS[Math.floor(noise(i, 1, 'col') * FISH_COLORS.length)];
    // 밝은 몸통에는 어두운 무늬를, 어두운 몸통에는 밝은 무늬를 넣는다
    const lum = parseInt(skin.slice(1, 3), 16) * 0.3 + parseInt(skin.slice(3, 5), 16) * 0.6 + parseInt(skin.slice(5, 7), 16) * 0.1;
    const px = sprite(kind, {
      '#': dim(skin), d: dim(back), ':': dim(mix(skin, 0.34)),
      '*': dim(mix(skin, lum > 180 ? -0.45 : 0.62)), '^': dim(mix(back, 0.14)), o: dim('#1b1f24'),
    }, x, y, dir < 0);
    const body = `<g class="bob" style="--a:${P}px;animation-duration:${(3.4 + noise(i, 2, 'fd') * 2.8).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'fdl') * 8).toFixed(1)}s">${pixelRects(px)}</g>`;
    layers.push(dist < 2 ? body
      : `<g class="swim" style="--sx:${dir * dist * P}px;animation-duration:${(dist * (1.15 + noise(i, 5, 'fsp') * 0.7)).toFixed(1)}s;animation-delay:-${(noise(i, 6, 'fsd') * 24).toFixed(1)}s;animation-timing-function:steps(${dist},end)">${body}</g>`);
    placed.push({ x, y, w: fw, h: fh });
    i++;
  }

  // 기포: 물만 덮는다
  const bubble = mix(theme.water[0], light ? 0.55 : 0.4);
  for (let i = 0; i < 16; i++) {
    const x = Math.floor(noise(i, 0, 'bx') * W);
    const y = SURF + 1 + Math.floor(noise(i, 1, 'by') * (FLOOR - SURF - 2));
    if (!theme.water.includes(get(x, y))) continue;
    const rows = y - SURF + 1;
    layers.push(`<g class="rise" style="--rise:${-rows * P}px;animation-duration:${(5 + noise(i, 2, 'bd') * 5).toFixed(1)}s;animation-delay:-${(noise(i, 3, 'bdl') * 10).toFixed(1)}s;animation-timing-function:steps(${rows},end)">`
      + `<g class="sway" style="--a:${P}px;animation-duration:${(1.2 + noise(i, 4, 'bw') * 1.4).toFixed(1)}s">`
      + pixelRects([{ x, y, c: bubble }]) + '</g></g>');
  }

  const fmt = (n) => n.toLocaleString('en-US');
  const left = `@${username} · ${fishCount} fish`;
  const right = stats.recentTotal > 0
    ? `last 30 days · ${fmt(stats.recentTotal)} contributions`
    : 'quiet water';

  return toSvg(grid, theme, left, right, `${username}'s aquarium: ${fishCount} fish from the last 30 days`, layers.join(''));
}

// ---------------------------------------------------------------- 문서용 띠

// README 에서 단계·계절을 한눈에 보여 주는 가로 띠. 카드에서 하늘·구름만 빼고
// 작게 줄인 타일을 늘어놓는다. 라이트 한 벌만 만들고 캡션까지 흰 타일 안에 넣어,
// GitHub 이 어떤 테마든 띠 자체는 똑같이 보인다.
// 잘라낼 격자 창(칸 단위)은 --docs 출력을 재서 정한 값이다. 창 바깥은 clip 이 아니라
// 아예 rect 를 만들지 않는다 — 땅이 전폭이라 그대로 두면 용량이 몇 배가 된다.
// 성장 규칙(TRUNK_H·CANOPY_R)을 건드리면 수관이 넘치지 않는지 다시 확인할 것.
const WIN_STAGES = { x0: 15, x1: 59, y0: 0 };   // GREAT TREE 가 17..57 칸을 쓴다
const WIN_SEASONS = { x0: 16, x1: 57, y0: 1 };  // 800 기여 고정이라 조금 더 좁다
const CAP = 22;   // 캡션 줄 높이(px)
const SKY = '#cfe7f3';   // 타일 배경. 하늘 띠 가운데쯤 되는 단색
const GAP = 8;    // 타일 사이 간격(px)

function strip(username, items, title, { x0, x1, y0 }) {
  const t = THEMES.light;
  const tw = (x1 - x0 + 1) * P, sh = (H - y0) * P, th = sh + CAP;
  const w = tw * items.length + GAP * (items.length - 1);
  const font = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

  const tiles = items.map((item, i) => {
    const s = scene({ username, stats: item.stats, theme: 'light', plain: true });

    // 창 안쪽만 가로로 이어붙여 rect 로 (toSvg 와 같은 방식)
    const rects = [];
    for (let y = y0; y < H; y++) {
      let x = x0;
      while (x <= x1) {
        const c = s.grid[y][x];
        let e = x + 1;
        while (e <= x1 && s.grid[y][e] === c) e++;
        if (c) rects.push(`<rect x="${x * P}" y="${y * P}" width="${(e - x) * P}" height="${P}" fill="${c}"/>`);
        x = e;
      }
    }

    // 수관·낙엽은 layers 에 절대 좌표로 들어 있어 통째로 옮기고 타일 밖은 잘라낸다
    return `<g transform="translate(${i * (tw + GAP)},0)">`
      + `<g clip-path="url(#tile)">`
      + `<rect width="${tw}" height="${th}" fill="${t.frame}"/><rect width="${tw}" height="${sh}" fill="${SKY}"/>`
      + `<g transform="translate(${-x0 * P},${-y0 * P})" shape-rendering="crispEdges">${rects.join('')}${s.layers}</g>`
      + `<text x="${tw / 2}" y="${sh + 14}" text-anchor="middle" font-family="${font}" font-size="11" font-weight="700" fill="${t.muted}">${esc(item.label)}</text>`
      + `</g>`
      + `<rect x="0.5" y="0.5" width="${tw - 1}" height="${th - 1}" rx="7.5" fill="none" stroke="${t.border}"/>`
      + `</g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${th}" viewBox="0 0 ${w} ${th}" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<defs><clipPath id="tile"><rect width="${tw}" height="${th}" rx="8"/></clipPath></defs>
${STYLE}
${tiles.join('\n')}
</svg>
`;
}

async function writeDocs(username) {
  const month = Number(todayIn('Asia/Seoul').slice(5, 7));
  const tree = (total, m = month) => ({ total, streak: 4, idleDays: 0, month: m });

  // 단계마다 그 구간 한가운데쯤 되는 기여 수로 그린다. 캡션이 표를 대신한다
  const stages = [[0, 'SEED', '0'], [4, 'SPROUT', '1+'], [25, 'SEEDLING', '10+'], [110, 'SAPLING', '50+'],
    [330, 'YOUNG TREE', '200+'], [750, 'TREE', '500+'], [2500, 'GREAT TREE', '1,000+']]
    .map(([total, name, at]) => ({
      label: `${name} · ${at}`,
      stats: total ? tree(total) : { total: 0, streak: 0, idleDays: Infinity, month },
    }));

  // 열매 규칙까지 함께 보이도록 800 기여로 고정한다
  const seasons = [[4, 'SPRING'], [7, 'SUMMER'], [10, 'AUTUMN'], [1, 'WINTER']]
    .map(([m, name]) => ({ label: name, stats: tree(800, m) }));

  await mkdir(join(ROOT, 'docs'), { recursive: true });
  await writeFile(join(ROOT, 'docs', 'stages.svg'), strip(username, stages, 'profile-garden growth stages', WIN_STAGES));
  await writeFile(join(ROOT, 'docs', 'seasons.svg'), strip(username, seasons, 'profile-garden seasons', WIN_SEASONS));
  console.log('docs/stages.svg, docs/seasons.svg written');
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
  const tanks = [0, 3, 8, 15, 22, 30].map((activeDays) => {
    const recentDays = Array.from({ length: activeDays }, (_, i) => 1 + ((i * 7) % 23));
    return {
      label: `${activeDays} active days`,
      stats: { activeDays, recentDays, recentTotal: recentDays.reduce((a, b) => a + b, 0), month },
    };
  });
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
} else if (process.argv.includes('--docs')) {
  await writeDocs(config.username || 'octocat');
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
  if (!stats.countsPrivate) {
    console.warn('비공개 저장소 기여는 빠져 있다. README의 "비공개 기여까지 세기"를 참고한다.');
  }
}
