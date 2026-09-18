# profile-garden

GitHub 활동을 먹고 자라는 픽셀 아트 나무. 매일 한 번 기여 기록을 읽어 SVG 두 장(라이트/다크)을 다시 그리고 `dist/`에 커밋한다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-dark.svg">
  <img src="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-light.svg" alt="pixel garden" width="432">
</picture>

## 프로필에 붙이기

프로필 README(`eongeung/eongeung`)에 아래를 넣으면 테마에 따라 알아서 바뀐다.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-dark.svg">
  <img src="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-light.svg" alt="pixel garden" width="432">
</picture>
```

## 동작 방식

`.github/workflows/garden.yml`이 매일 06:20 KST(그리고 스크립트를 수정해 push 할 때마다) 실행된다.
`scripts/generate.mjs`가 GitHub GraphQL API로 기여 기록을 읽고, 아래 규칙으로 나무를 그린 뒤
`dist/tree-light.svg`·`dist/tree-dark.svg`를 갱신한다. 변경이 없으면 커밋하지 않는다.

`Actions` 탭에서 `garden` 워크플로를 수동 실행(`Run workflow`)할 수도 있다.

### 성장 — 가입 이후 총 기여 수

| 총 기여 | 단계 |
| --- | --- |
| 0 | `SEED` |
| 1+ | `SPROUT` |
| 10+ | `SEEDLING` |
| 50+ | `SAPLING` |
| 200+ | `YOUNG TREE` |
| 500+ | `TREE` |
| 1,000+ | `GREAT TREE` |

단계 사이에서도 기여가 쌓이는 만큼 줄기와 수관이 조금씩 커진다.
`GREAT TREE` 이후로는 기여가 두 배씩 늘 때마다 완만하게 자란다.

### 시듦 — 마지막 활동 이후 지난 날

| 방치 일수 | 잎 |
| --- | --- |
| 0–2일 | 무성함 |
| 3–6일 | 82% |
| 7–13일 | 58% |
| 14–29일 | 34% |
| 30일+ | 12% |

7일 넘게 쉬면 잎이 떨어지기 시작하고, 정보 줄에 `watered Nd ago`로 표시된다.

### 계절 · 열매

봄(3–5월)은 연두에 꽃, 여름(6–8월)은 짙은 초록, 가을(9–11월)은 단풍과 낙엽,
겨울(12–2월)은 눈 덮인 가지. 총 기여 500 이상이면 여름·가을에 250당 하나씩
열매가 달린다(최대 9개).

같은 계정이면 가지 방향과 잎 위치는 항상 같다 — 사용자 이름을 시드로 쓰는 결정적 난수라 날마다 모양이 흔들리지 않는다.

## 설정

`garden.config.json`:

```json
{
  "username": "eongeung",
  "timeZone": "Asia/Seoul"
}
```

`username`은 환경 변수 `GARDEN_USER`로도 덮어쓸 수 있다. `timeZone`은 "오늘"과 연속 일수를 판정하는 기준이다.

비공개 저장소 기여까지 세고 싶다면 `read:user` 권한의 PAT를 만들어 저장소 시크릿 `GARDEN_TOKEN`으로 등록한다.
없으면 워크플로가 기본 `GITHUB_TOKEN`으로 공개 기여만 센다.

## 로컬에서

```bash
# 가짜 데이터로 모든 단계·계절·방치 일수를 한 페이지에 펼쳐 본다
node scripts/generate.mjs --demo   # → preview/index.html

# 실제 활동으로 dist/ 생성 (토큰 필요)
GITHUB_TOKEN=ghp_... node scripts/generate.mjs
```

Node 20 이상이 필요하다(내장 `fetch` 사용).
