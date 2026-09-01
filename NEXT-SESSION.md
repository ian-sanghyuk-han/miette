# 다음 세션 시작 프롬프트

> 아래 상자를 통째로 복사해서 **새 세션**에 붙여넣으세요.
> 새 세션에서 시작하는 게 중요합니다 — 필요한 건 전부 이 저장소에 있고,
> 지난 대화는 하나도 필요 없습니다. 그게 토큰을 가장 크게 아낍니다.

---

## P2a — 지도를 살린다

```
Miette 프로젝트 P2a를 시작하자.

먼저 읽을 것 (이 셋이면 충분하다):
  miette/MIETTE-KICKOFF.md   — 유일한 사양서. §8.2 지도, §8.3 색과 글꼴, §8.4 가게 카드
  miette/design/Main.dc.html — 지도 화면 목업 (실제 데이터로 그려져 있다)
  miette/design/Place.dc.html — 가게 카드 목업

데이터는 이미 다 있다. 새로 받지 말 것:
  data/places.json       빵집 1,921곳 (54곳에 입상 이력 aw 붙어 있음)
  data/paris.json        20구 경계 + 물길
  data/competitions.json 대회 14종 설명 (ko/en/fr)
  data/laureates.json    입상자 306명

P2a에서 할 일은 이것뿐이다:
  1. miette/index.html 하나에 지도를 그린다 — SVG, 타일 서버 없음, CDN 없음
  2. 손가락으로 밀고 확대/축소가 된다
  3. 빵집 점이 보이고, 확대하면 이름이 뜬다 (Estela index.html의 라벨 티어링 참고,
     단 Estela 저장소는 읽기만 할 것)
  4. 점을 누르면 가게 카드가 아래에서 올라온다 (Place.dc.html 그대로)
  5. 상단 필터 칩 — 종류 / 수상점 / 개인 가게만

P2a에서 하지 않을 일 (다음 단계다):
  도장·저장·3개국어·PWA·순위·사진 비교

끝나면 로컬에서 열리는 걸 확인하고 세 줄로 보고해줘.
```

---

## 그다음 (참고용, 각각 새 세션)

- **P2b** — 도장 + IndexedDB 저장 + `navigator.storage.persist()` + JSON 내보내기/가져오기
  (사양서 §6.1, §10.2). 목업: `design/Stamp.dc.html`, `design/Record.dc.html`
- **P2c** — `i18n/{ko,en,fr}.json` + 즉시 전환 + `manifest.json` + 서비스워커 +
  `apple-touch-icon` + GitHub Pages 배포. 목업: `design/Settings.dc.html`, `design/Icon.dc.html`
- **P3~P4.5** — 빵 단위 기록 · VS와 Bradley–Terry 순위 · 가성비 사분면 · 눈으로 재기

---

## 지금까지 끝난 것 (2026-09-01)

- **P0** 데이터 — 빵집 1,921 · 20구 경계 · 대회 14종 · 입상자 306명(빵집 54곳 연결)
- **P1** 화면 12장 — https://claude.ai/code/artifact/52efea35-3c05-4618-b80f-729fb9e58f01

**오너가 이미 결정한 것** (다시 묻지 말 것):
이름 Miette · 파리 먼저 · 부제 "빵자취를 따라서" · 헌정 "빵 냄새가 나면 걸음이 빨라지는 사람에게" ·
별점 없음(순위는 VS로만) · 3개 국어 · 아이폰 · 비상업 개인 선물 · 사진은 판정하지 않고 근거만 낸다
