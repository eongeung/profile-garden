# profile-garden

GitHub 활동을 먹고 자라는 픽셀 아트 정원. 매일 한 번 기여 기록을 읽어 **나무**(가입 이후 누적)와 **어항**(최근 30일)을 라이트/다크 두 벌씩, 모두 네 장의 SVG로 다시 그리고 `dist/`에 커밋한다.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-dark.svg">
  <img src="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-light.svg" alt="pixel tree" width="432">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tank-dark.svg">
  <img src="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tank-light.svg" alt="pixel aquarium" width="432">
</picture>

## 내 계정에 가져다 쓰기

1. 이 저장소를 [fork](https://github.com/eongeung/profile-garden/fork) 한다.
2. `garden.config.json`에서 `"username"` 줄을 지운다 — 저장소 주인이 자동으로 쓰인다.
   (다른 계정을 그리고 싶으면 그 아이디로 바꾼다.) `timeZone`은 본인 시간대로 둔다.
3. fork 된 저장소의 `Actions` 탭에서 워크플로를 활성화하고 `garden` → `Run workflow`
   를 한 번 눌러 `dist/`를 내 활동으로 덮어쓴다. 이후로는 매일 자동으로 돈다.
4. 프로필 README(`내아이디/내아이디`)에 아래 `<picture>` 블록을 넣되 URL의 `eongeung`을
   내 아이디로 바꾼다.

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-dark.svg">
  <img src="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tree-light.svg" alt="pixel tree" width="432">
</picture>
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tank-dark.svg">
  <img src="https://raw.githubusercontent.com/eongeung/profile-garden/main/dist/tank-light.svg" alt="pixel aquarium" width="432">
</picture>
```

보는 사람의 테마에 따라 알아서 바뀐다. 나무만, 또는 어항만 쓰고 싶으면 해당 `<picture>`
블록만 넣으면 된다. 크기는 `width`로 맞춘다.

### 비공개 기여까지 세기

기본 토큰은 남의 눈으로 프로필을 보는 것과 같아서 공개 기여만 센다. 비공개 저장소에서
주로 일했다면 나무가 실제보다 작게 자란다. 넣는 길은 둘이고 하나만 고르면 된다.

- [Settings → Public profile](https://github.com/settings/profile) 의
  *Include private contributions on my profile* 를 켠다. 저장소 이름은 드러나지 않고
  잔디 칸의 숫자만 올라간다. 시크릿이 필요 없고, 프로필 잔디와 나무의 숫자가 같아진다.
- 공개하기 싫으면 `read:user` 권한의
  [classic PAT](https://github.com/settings/tokens/new?scopes=read:user&description=profile-garden) 을
  만들어 저장소 시크릿 `GARDEN_TOKEN`으로 등록한다(`gh secret set GARDEN_TOKEN`).
  나무에만 반영되고 프로필 잔디는 그대로다.

둘 다 아니면 워크플로 로그에 `비공개 저장소 기여는 빠져 있다`가 남고 공개 기여만으로 그린다.

## 동작 방식

`.github/workflows/garden.yml`이 매일 06:20 KST(그리고 스크립트를 수정해 push 할 때마다) 실행된다.
`scripts/generate.mjs`가 GitHub GraphQL API로 기여 기록을 읽고, 아래 규칙으로 나무를 그린 뒤
`dist/`의 네 파일(`tree-light`·`tree-dark`·`tank-light`·`tank-dark`)을 갱신한다. 변경이 없으면 커밋하지 않는다.

`Actions` 탭에서 `garden` 워크플로를 수동 실행(`Run workflow`)할 수도 있다.

## 나무 — 가입 이후 누적

### 성장 — 총 기여 수

![growth stages](https://raw.githubusercontent.com/eongeung/profile-garden/main/docs/stages.svg)

단계 사이에서도 기여가 쌓이는 만큼 줄기와 수관이 조금씩 커진다.
`GREAT TREE` 이후로는 기여가 두 배씩 늘 때마다 완만하게 자란다.

### 시듦 — 마지막 활동 이후 지난 날

![wither by idle days](https://raw.githubusercontent.com/eongeung/profile-garden/main/docs/wither.svg)

7일 넘게 쉬면 잎이 떨어지기 시작하고, 정보 줄에 `watered Nd ago`로 표시된다.
다시 커밋하면 이튿날 그림에서 되살아난다.

### 계절 · 열매

![seasons](https://raw.githubusercontent.com/eongeung/profile-garden/main/docs/seasons.svg)

봄 3–5월, 여름 6–8월, 가을 9–11월, 겨울 12–2월. 총 기여 500 이상이면
여름·가을에 250당 하나씩 열매가 달린다(최대 9개).

같은 계정이면 가지 방향과 잎 위치는 항상 같다 — 사용자 이름을 시드로 쓰는 결정적 난수라 날마다 모양이 흔들리지 않는다.
아이디가 다르면 나무 모양도 다르다.

## 어항 — 최근 30일

나무가 쌓인 총량을 보여준다면 어항은 요즘 흐름을 보여준다.

**물고기 한 마리 = 최근 30일(오늘 포함) 중 기여가 있었던 하루.** 매일 커밋하면 30마리가 가득 차고,
한 달을 쉬면 빈 수조에 수초만 남는다. 그날 기여가 많을수록 물고기가 크고, 16개를 넘으면 길쭉이가 된다.
정보 줄에는 마리 수와 그 30일 동안의 총 기여 수가 적힌다.

물고기의 색·방향·위치, 수초와 기포 배치는 사용자 이름을 시드로 쓰는 결정적 난수라 날마다 흔들리지 않는다.
나무와는 다른 시드를 써서 두 그림의 배치가 겹치지 않는다.

## 설정

`garden.config.json`:

```json
{
  "username": "eongeung",
  "timeZone": "Asia/Seoul"
}
```

`username`은 지우면 저장소 주인이 쓰이고, 환경 변수 `GARDEN_USER`로도 덮어쓸 수 있다.
`timeZone`은 "오늘"과 연속 일수를 판정하는 기준이다.

갱신 주기는 `.github/workflows/garden.yml`의 `cron`으로 바꾼다. UTC 기준이라
KST로 읽으려면 9시간을 더해야 한다(`20 21 * * *`이 06:20 KST).

## 로컬에서

```bash
# 가짜 데이터로 모든 단계·계절·방치 일수를 한 페이지에 펼쳐 본다
node scripts/generate.mjs --demo   # → preview/index.html

# README 에 넣는 단계·시듦·계절 띠를 다시 만든다 (성장 규칙을 고쳤을 때만)
node scripts/generate.mjs --docs   # → docs/stages.svg, wither.svg, seasons.svg

# 실제 활동으로 dist/ 생성 (토큰 필요)
GITHUB_TOKEN=$(gh auth token) node scripts/generate.mjs
```

Node 20 이상이 필요하다(내장 `fetch` 사용). 성장 규칙(`STAGES`, `TRUNK_H`, `CANOPY_R`)이나
색(`THEMES`, `LEAVES`)을 고칠 때는 `--demo`로 확인하는 편이 빠르다.

## 잘 안 될 때

- **프로필에서 그림이 그대로다.** GitHub가 이미지를 camo 프록시로 캐시한다. `dist/`가 갱신된
  뒤에도 몇 분 걸리니 강력 새로고침으로 확인한다.
- **워크플로가 돌지 않는다.** fork 한 저장소는 Actions가 꺼진 채로 시작한다. 또 60일 동안
  저장소에 활동이 없으면 GitHub가 스케줄을 멈추므로 `Run workflow`로 다시 깨운다.
- **커밋 단계에서 권한 오류가 난다.** `Settings → Actions → General → Workflow permissions`가
  *Read and write permissions* 인지 본다.
- **나무가 SEED로 나온다.** 기여가 0으로 읽힌 것이다. `username`이 맞는지, 비공개 저장소에서만
  일했다면 위 「비공개 기여까지 세기」를 확인한다.

## 라이선스

MIT.
