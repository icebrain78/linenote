# PRD — LineNote: 공장 현장 불량기록 하이브리드 AI 코파일럿

> 대상 대회: #BuildHybridAI 2026 (Google · Firebase AI Logic, Devpost)
> 마감: **2026-11-30 14:00 PST = 한국 12/1(화) 07:00** — 마감 후 커밋은 평가 안 됨
> 플랫폼: **Web (Chrome Desktop, Gemini Nano)** — 목표 상: Grand Prize 계열 + Best Web/Chrome App
> 개발 도구: Google Antigravity (이 문서를 그대로 에이전트에 넘긴다)
> 작성: 2026-11-22 · 개인 참가

---

## 0. Antigravity 에이전트에게 (먼저 읽을 것)

1. 이 문서가 유일한 요구사항 원본이다. 모호하면 **"Must" 기능을 먼저, 단순하게** 구현한다.
2. 앱 UI·README·코드 주석·커밋 메시지는 **모두 영어**로 쓴다 (대회 규정: 제출물 영어).
3. 작업은 §12 마일스톤 순서대로, 마일스톤마다 Implementation Plan → 구현 → 브라우저로 검증 → 커밋 순으로 진행한다.
4. **Firebase AI Logic(`firebase/ai`)을 실제로 import하고 호출**해야 한다 (README에 이름만 쓰면 실격 사유).
5. API 키·비밀값을 저장소에 커밋하지 않는다. `.env.local`(gitignore) + `.env.example`만 커밋.
6. 회사명·실존 고객사명을 코드·샘플데이터·영상에 넣지 않는다. 샘플은 가상의 "sheet-metal enclosure plant"로 한다.
7. 기술 사실(아래 §6)은 2026-11-18 기준 Firebase 공식 문서에서 확인한 내용이다. SDK 동작이 다르면 문서를 다시 확인하고 이 PRD를 고치지 말고 `docs/DEVIATIONS.md`에 기록한다.

---

## 1. 한 줄 요약

**공장 현장 작업자가 불량을 사진·짧은 메모로 남기면, 기밀 정보는 기기 밖으로 나가지 않게 Gemini Nano가 온디바이스에서 구조화하고, 비식별 데이터만 클라우드 Gemini로 보내 여러 건을 묶은 원인분석·8D 초안을 만드는 웹앱.**

핵심 메시지(심사위원용): *"Hybrid isn't a fallback trick here — it's a data-governance policy. The app decides per request where inference is allowed to run."*

## 2. 문제 정의

| 문제 | 현장 상황 | 왜 하이브리드인가 |
|---|---|---|
| 불량 기록이 안 남거나 부정확 | 작업 중 손이 바쁘고, 양식이 길어 퇴근 전에 몰아서 기억으로 작성 | 즉시·빠른 구조화 필요 → 온디바이스(지연 없음, 무료) |
| 기밀 데이터 | 고객사명·도면번호·단가가 메모와 사진에 섞여 있음. 외부 AI 업로드 금지 정책이 흔함 | 민감 정보는 **ONLY_ON_DEVICE**로 강제 |
| 통신 음영 | 금속 외함·철골 구조 공장은 Wi-Fi/LTE 음영 구역이 있음 | 오프라인에서도 온디바이스 처리 → 연결 시 동기화 |
| 원인분석은 큰 모델 필요 | 여러 건 비교, 파레토, 8D 초안은 긴 문맥·추론 필요 | 비식별 데이터만 **클라우드** 모델로 |
| 모든 PC가 Nano를 못 씀 | 사무실 PC·태블릿·폰 브라우저는 로컬 모델이 없을 수 있음 | 비민감 작업은 **PREFER_ON_DEVICE → 클라우드 폴백** |

> 통계·근거 수치는 Devpost 설명문 작성 단계(5단계)에서 출처와 함께 추가한다. 이 PRD에는 근거 없는 수치를 넣지 않는다.

**대상 사용자**
- Primary: 판금·조립 라인 작업자/검사원 (영어·한국어 혼용 메모)
- Secondary: 품질 담당자/반장 (주간 불량 분석, 8D 보고)

## 3. 범위

### Must (제출 필수)
- M1 불량 기록 입력: 텍스트 메모 + 사진(카메라/파일) 1장
- M2 온디바이스 구조화: 메모(+사진) → JSON 불량 레코드 (structured output)
- M3 민감도 라우터: 레코드별로 추론 위치 결정 + 클라우드 전송 전 마스킹
- M4 로컬 우선 저장·오프라인 큐: 오프라인에서도 기록, 온라인 복귀 시 동기화
- M5 클라우드 원인분석: 선택한 여러 건(비식별) → 원인 가설·파레토·8D 초안
- M6 Inference Source 가시화: 모든 AI 결과에 `On-device` / `Cloud` 배지 + Hybrid Log 패널
- M7 Firebase 연동: App Check, Auth(익명), Firestore, Hosting, Remote Config
- M8 Nano 미지원 환경에서도 동작 (폴백 확인 화면)

### Should (시간 되면)
- S1 Web Speech API 받아쓰기 버튼 (주의: 브라우저 음성인식은 온디바이스 보장 아님 → 민감 모드에서는 비활성)
- S2 대시보드: 불량유형 파레토 차트, 일자별 추이
- S3 8D 초안 Markdown/PDF 내보내기, CSV 내보내기
- S4 PWA 설치(오프라인 앱 셸)

### Won't (이번엔 안 함)
- Android/iOS 네이티브 앱, 다중 사업장·권한 관리, MES/ERP 연동, 실제 고객 데이터

## 4. 사용자 흐름

```
[작업자] 사진 찍고 "Bolt mark missing on M8 x4, left door hinge, cust ACME-77 drawing EN-2231" 입력
   ↓ (온디바이스, ONLY_ON_DEVICE — 원문은 기기 밖으로 안 나감)
[Nano] 구조화 JSON + 민감 토큰 탐지
   ↓
[화면] 카드: defectType=MISSING_TORQUE_MARK, part=hinge bolt M8, qty=4, severity=MAJOR
       🔒 Sensitive: customer, drawing no. → 클라우드에는 [CUSTOMER_1], [DRAWING_1]로 마스킹
       배지: On-device · 640 ms
   ↓ 저장 (로컬 → 온라인 시 Firestore에는 마스킹본만)
[품질담당] 이번 주 레코드 12건 선택 → "Analyze root causes"
   ↓ (클라우드, ONLY_IN_CLOUD, 마스킹본만 전송)
[Gemini cloud] 파레토, 원인 가설 3개, 8D D1~D8 초안
   배지: Cloud · gemini-3.5-flash-lite · 2.1 s
```

## 5. 기능 상세

### M1 기록 입력 (`/capture`)
- 큰 버튼 UI(장갑 착용 고려, 최소 터치 영역 48px).
- 입력: textarea(최대 500자), 사진 1장(`<input type="file" accept="image/jpeg,image/png" capture="environment">`), 라인/공정 선택(드롭다운, 샘플값).
- 사진은 클라이언트에서 긴 변 1024px로 리사이즈, JPEG로 변환 (온디바이스 입력은 JPEG/PNG만 지원).
- "Structure with AI" 버튼 → M2.

### M2 온디바이스 구조화
- 모델: `structurer` = `getGenerativeModel(ai, { mode: <M3가 결정> , onDeviceParams, inCloudParams })`
- 단발성(single-turn) 호출만 사용 (온디바이스는 chat 미지원).
- 출력 JSON 스키마 (structured output, enum 사용):

```json
{
  "defectType": "SCRATCH | DENT | MISSING_TORQUE_MARK | LOOSE_BOLT | PAINT_DEFECT | WRONG_PART | DIMENSION_OUT | WELD_DEFECT | OTHER",
  "part": "string",
  "location": "string",
  "quantity": "integer",
  "severity": "CRITICAL | MAJOR | MINOR",
  "suspectedCause": "string",
  "immediateAction": "string",
  "sensitiveSpans": [{ "text": "string", "kind": "CUSTOMER | DRAWING_NO | PRICE | PERSON | OTHER" }],
  "confidence": "number 0-1"
}
```

- 시스템 프롬프트 요지(영어로 작성): "You are a QC assistant on a factory floor. Extract a defect record. Never invent quantities. If unsure use OTHER and lower confidence."
- 사진이 있으면 텍스트+이미지 입력으로 호출(온디바이스 지원 범위).
- 결과 카드에서 각 필드 수정 가능(사람 확인 후 저장 = "human in the loop").

### M3 민감도 라우터 (이 앱의 핵심 차별점)
결정 순서:
1. **규칙 기반 사전 검사(클라이언트, AI 호출 전)**: Remote Config `sensitive_patterns`(정규식 목록)와 `customer_names`(가상 고객명 목록)로 원문 스캔.
   - 예: 도면번호 `/\b[A-Z]{2}-\d{3,5}\b/`, 단가 `/(₩|\$|KRW)\s?\d/`, 고객명 사전.
2. 매칭되거나, 사용자가 🔒 **Confidential** 토글을 켰으면 → `InferenceMode.ONLY_ON_DEVICE`
   - 로컬 모델이 없으면 **클라우드로 보내지 않고** 에러 화면: "This note contains confidential data and no on-device model is available. Saved locally without AI." (원문만 로컬 저장)
3. 아니면 → `InferenceMode.PREFER_ON_DEVICE` (로컬 없으면 클라우드 폴백 허용)
4. 구조화 후 Nano가 찾은 `sensitiveSpans` + 규칙 매칭을 합쳐 **마스킹본** 생성: 같은 값은 같은 토큰(`[CUSTOMER_1]`). 매핑표는 **로컬(IndexedDB)에만** 저장.
5. 클라우드로 가는 모든 요청(M5)은 마스킹본만 사용. 전송 직전 규칙 검사를 한 번 더 돌려 남은 민감 토큰이 있으면 전송 차단(fail-closed).

라우팅 정책 표 (README·영상에 그대로 사용):

| 작업 | Mode | 로컬 모델 없을 때 |
|---|---|---|
| 민감 메모 구조화 | ONLY_ON_DEVICE | AI 없이 로컬 저장 (클라우드 금지) |
| 일반 메모 구조화 | PREFER_ON_DEVICE | 클라우드 폴백 |
| 다건 원인분석/8D | ONLY_IN_CLOUD (마스킹본만) | 오프라인이면 큐에 넣고 나중에 실행 |
| 짧은 번역(KO↔EN 메모 표시) | PREFER_ON_DEVICE | 클라우드 폴백 |

- 기본 mode와 클라우드 모델명도 Remote Config로 원격 변경 가능하게 한다 (`structurer_mode`, `cloud_model`).

### M4 로컬 우선 저장·오프라인
- 원문·사진·마스킹 매핑: IndexedDB(Dexie)에만.
- Firestore에는 마스킹된 레코드만 (`persistentLocalCache` 사용으로 오프라인 쓰기 큐잉).
- 상단 상태바: Online/Offline, 대기 중 동기화 건수, On-device model 상태(available / downloading xx% / unavailable).

### M5 클라우드 원인분석 (`/analyze`)
- 레코드 목록에서 체크박스로 2~50건 선택 → "Analyze root causes".
- 출력(structured): `pareto[{defectType,count}]`, `hypotheses[{cause, evidenceRecordIds[], confidence}]` 3개, `eightD{D1..D8}` 초안, `nextChecks[]`.
- 결과 화면에 "Sent to cloud: masked fields only" 와 실제 전송된 JSON 미리보기(접이식) 표시 → 심사위원이 프라이버시를 눈으로 확인.
- 클라우드 응답의 마스킹 토큰은 **화면에서만 로컬 매핑으로 복원**(예: `[CUSTOMER_1]` → "ACME-77"), 복원본은 저장하지 않음.

### M6 Hybrid 가시화
- 모든 AI 결과 카드 우상단 배지: `response.inferenceSource` 값(`ON_DEVICE`/`IN_CLOUD`) + 지연시간(ms).
- `/hybrid-log` 패널: 시간, 작업, 요청 mode, 실제 source, latency, 클라우드 전송 바이트 수(마스킹본), 차단 여부. 세션 통계: on-device 비율, 클라우드 차단 건수.
- 이 화면이 영상의 "기술 구현" 증거 장면이다.

### M7 Firebase
- `initializeApp` → `initializeAppCheck`(웹 provider: reCAPTCHA. 개발 중에는 `self.FIREBASE_APPCHECK_DEBUG_TOKEN = true`, 토큰은 콘솔에 등록. localhost를 reCAPTCHA 허용 도메인에 넣지 않는다).
- Auth: 익명 로그인 (데모 진입 장벽 제거).
- Firestore 규칙: 본인 uid 문서만 읽기/쓰기.
- Hosting: `https://<project>.web.app` 공개 데모 URL.
- Remote Config: `sensitive_patterns`, `customer_names`, `structurer_mode`, `cloud_model`.

### M8 폴백 확인
- 시작 화면 "Device check": Chrome 버전, `LanguageModel.availability()` 결과, 안내(플래그 켜는 법).
- Nano 없는 브라우저(예: 휴대폰 Chrome, 타 브라우저)에서 같은 URL을 열면 일반 메모는 클라우드로 처리되고, 민감 메모는 차단되는 것을 보여준다.

## 6. 기술 구성 (공식 문서 확인 사항, 2026-11-18 기준)

| 항목 | 내용 |
|---|---|
| 프론트 | Vite + React + TypeScript, Tailwind, React Router, Dexie(IndexedDB), Recharts(S2), vite-plugin-pwa(S4) |
| SDK | `npm install firebase` (JS SDK **v13.0.0 이상** — 기본 클라우드 모델 `gemini-3.5-flash-lite`, 하이브리드는 v12.5.0+) |
| Import | `import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai"` |
| 백엔드 | `getAI(app, { backend: new GoogleAIBackend() })` (Gemini Developer API, 무료 시작) |
| 모드 | `InferenceMode.PREFER_ON_DEVICE / ONLY_ON_DEVICE / PREFER_IN_CLOUD / ONLY_IN_CLOUD` |
| 모델 준비 | 사용자 클릭 후 `model.initializeDeviceModel(progress => ...)` 호출 (첫 요청 전). ONLY_ON_DEVICE는 완료를 await |
| 출처 확인 | `result.response.inferenceSource` → `ON_DEVICE` / `IN_CLOUD` |
| 온디바이스 지원 | **단발성 텍스트 생성만**(chat 불가), 텍스트 / 텍스트+이미지(JPEG·PNG) 입력, structured output(JSON·enum), 스트리밍 가능. **오디오 입력 미지원** |
| 파라미터 | `onDeviceParams.createOptions`(expectedInputs/Outputs, initialPrompts), `inCloudParams.model / generationConfig` |
| 브라우저 | Chrome Desktop 139+, `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input` Enabled → 재시작. 모델 다운로드 수 분 소요 |
| App Check | Firebase AI Logic에 2026-11-02부터 자동 강제 적용 — 반드시 설정 |

코드 골격 (참고용, 에이전트가 완성):

```ts
// src/ai/models.ts
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { app } from "../firebase";

export const ai = getAI(app, { backend: new GoogleAIBackend() });

export function structurer(mode: InferenceMode) {
  return getGenerativeModel(ai, {
    mode,
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
        initialPrompts: [{ role: "system", content: [{ type: "text", value: STRUCTURER_SYSTEM }] }],
      },
    },
    inCloudParams: { model: remoteConfigCloudModel() },
  });
}

export const analyzer = getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD });
```

```ts
// 호출 후 공통 로깅
const t0 = performance.now();
const result = await model.generateContent(parts);
hybridLog.add({ task, requestedMode: mode, source: result.response.inferenceSource, ms: performance.now() - t0 });
```

> `expectedInputs`의 image 타입 표기, structured output 지정 방법(responseSchema 등)은 구현 시 `https://firebase.google.com/docs/ai-logic/hybrid/web/configuration-options` 와 API reference(`ai.hybridparams`)로 확인할 것.

### 폴더 구조
```
linenote/
  src/
    firebase.ts            # init, App Check, Auth, Remote Config
    ai/models.ts           # 모델 팩토리
    ai/router.ts           # 민감도 라우터 (M3) + 단위테스트
    ai/masking.ts          # 마스킹/복원 (M3) + 단위테스트
    ai/prompts.ts          # 시스템 프롬프트, 스키마
    data/db.ts             # Dexie
    data/sync.ts           # Firestore 동기화 (마스킹본만)
    pages/Capture.tsx  Records.tsx  Analyze.tsx  HybridLog.tsx  DeviceCheck.tsx
    components/SourceBadge.tsx  StatusBar.tsx  RecordCard.tsx
  sample-data/records.json   # 가상 샘플 30건 (영어/한국어 섞음)
  sample-data/images/        # 볼트 마킹 샘플 사진 (사용자 제공 공개 가능 이미지)
  docs/DEVIATIONS.md  docs/ARCHITECTURE.md (머메이드 다이어그램)
  firestore.rules  firebase.json  .env.example  LICENSE (Apache-2.0)  README.md
```

## 7. 비기능 요구사항
- 온디바이스 구조화 응답: 목표 2초 이내(모델 준비 완료 후, 측정치를 Hybrid Log에 표시).
- 민감 원문은 어떤 경로로도 네트워크 전송 금지 → `masking.ts`·`router.ts` 단위테스트(vitest)로 보장: "민감 패턴이 포함된 요청은 ONLY_IN_CLOUD 모델에 도달하지 않는다".
- 접근성: 대비 4.5:1, 키보드 조작, 버튼 라벨.
- 저장소에 실제 키·개인정보 없음. Firebase 웹 config는 `.env`로 주입.

## 8. 데모 시나리오 (유튜브 3분 이내, 영어 자막)

| 시간 | 장면 | 보여줄 것 (심사항목) |
|---|---|---|
| 0:00–0:20 | 문제: 공장 현장, 기밀 메모, 음영 구역 | 임팩트 |
| 0:20–0:55 | Chrome(Nano)에서 사진+민감 메모 입력 → On-device 배지, 🔒 마스킹 표시 | 기술·아이디어 |
| 0:55–1:20 | Wi-Fi 끄고 기록 → 오프라인 처리·대기 큐 → 다시 켜면 동기화 | 기술·디자인 |
| 1:20–1:50 | 휴대폰 브라우저(Nano 없음): 일반 메모는 Cloud 폴백, 민감 메모는 차단 | 하이브리드 정책(핵심) |
| 1:50–2:30 | 12건 선택 → 클라우드 원인분석·파레토·8D, "전송된 JSON" 미리보기로 마스킹 확인 | 기술·임팩트 |
| 2:30–2:50 | Hybrid Log: on-device 비율, 차단 건수, 지연시간 | 기술 |
| 2:50–3:00 | 아키텍처 1장 + 저장소/데모 URL | 완성도 |

## 9. 심사 기준 매핑

| 심사 항목 (각 1~5) | 대응 |
|---|---|
| Technological Implementation | 4개 InferenceMode를 작업별로 다르게 사용, `inferenceSource` 로깅, App Check·Remote Config·Firestore·Auth·Hosting, 라우터 단위테스트 |
| Design | 현장용 큰 버튼, 상태바, 사람 확인 후 저장, 기록→분석→보고까지 끝나는 흐름 |
| Potential Impact | 제조 현장 불량기록 누락·기밀 유출 우려라는 구체적 문제와 구체적 사용자(작업자·품질담당) |
| Quality of the Idea | "하이브리드 = 데이터 거버넌스 정책": 기기 가용성이 아니라 **데이터 민감도로 추론 위치를 결정**하고 fail-closed로 차단 |

## 10. 차별성 (역대 수상작 대비)
- Chrome Built-in AI Challenge의 Best Hybrid 수상작(Mentelo: 페이지 기술지원 챗, Trail: 오프라인 트레일 동반자, Orma/BrowseGraph: 브라우징 메모리)은 주로 "가용성·오프라인" 관점. LineNote는 **같은 앱 안에서 요청마다 민감도에 따라 로컬 강제/폴백 허용/클라우드 전용을 나누는 정책 라우팅**과 마스킹 왕복(마스킹 전송 → 로컬 복원)을 보여준다.
- 범용 요약·번역·챗봇이 아닌 제조 품질(불량 → 8D) 도메인.

## 11. 위험과 대응

| 위험 | 대응 |
|---|---|
| Nano가 한국어/이미지 구조화를 못함 | 데모 메모는 영어 위주, 한국어는 표시 번역만. 사진은 보조 입력(실패해도 텍스트만으로 구조화) |
| Nano 다운로드 실패·하드웨어 미지원 | Day 1에 사용자 PC에서 `LanguageModel.availability()` 확인. 안 되면 다른 PC 확보 |
| structured output이 온디바이스에서 불안정 | 스키마 단순화(enum 위주) + JSON 파싱 실패 시 1회 재시도, 그래도 실패면 수동 입력 폼 |
| App Check 설정 문제 | Day 1에 디버그 토큰으로 먼저 통과시킴 |
| 시간 부족 | Should 전부 포기 가능. Must M1~M8만으로 제출 |
| 클라우드 무료 한도 | 데모·테스트 횟수 관리. 필요 시 대회 쿼터 계정 Sprint3(11/25 10:00 PT 마감) 신청 |

## 12. 일정 (한국시간)

| 날짜 | 마일스톤 | 완료 기준 |
|---|---|---|
| 11/23(월) | **D1 셋업**: Firebase 프로젝트, AI Logic(Gemini Developer API) 활성화, App Check 디버그, Chrome 플래그·Nano 확인, Vite 골격, Hosting 첫 배포 | 배포 URL에서 "hello" 프롬프트가 On-device 배지로 응답 |
| 11/24(화) | **D2 M1+M2**: 입력 화면, 온디바이스 구조화, 결과 카드 수정·저장(IndexedDB) | 샘플 메모 5개 정상 구조화 |
| 11/25(수) | **D3 M3**: 라우터·마스킹·fail-closed + vitest | 단위테스트 통과, Remote Config 반영 |
| 11/26(목) | **D4 M4+M5**: Firestore 동기화(마스킹본), 오프라인 큐, 클라우드 원인분석 | 오프라인→온라인 동기화, 분석 결과 표시 |
| 11/27(금) | **D5 M6+M8**: 배지·Hybrid Log·Device check, 휴대폰 폴백 확인, UI 다듬기 | 영상 시나리오 전 장면 재현 가능 |
| 11/28(토) | **D6 Should 일부 + 버그 수정**, README·아키텍처 다이어그램, 라이선스 | 저장소 공개, About에 Apache-2.0 표시 |
| 11/29(일) | **D7 영상 촬영·편집(3분 이내, 영어 자막)**, 유튜브 공개 업로드, Devpost 설명문 | 영상 링크 공개 확인 |
| 11/30(월) | **D8 제출** (오후까지, 실제 마감 12/1 07:00) | Devpost Submit 완료, 데모 URL 동작 재확인 |

## 13. 제출 체크리스트 (Devpost)
- [ ] 영문 설명: How we used Firebase AI Logic / Features / Value proposition (신규 프로젝트임을 명시)
- [ ] 공개 GitHub 저장소 (계정 icebrain78), 소스·에셋·실행방법 포함, **Apache-2.0 라이선스가 About에 보임**
- [ ] `firebase/ai` 실제 import·호출 코드 존재
- [ ] 유튜브 **공개** 영상 3:00 이내, 실제 Chrome 구동 화면, 영어 자막
- [ ] 데모 URL(Firebase Hosting) + 테스트 방법(Chrome 플래그 안내, 익명 로그인이라 계정 불필요), 심사 종료(12/16)까지 유지
- [ ] 저장소·설명에 실제 API 키·개인정보·회사명 없음
- [ ] 마감 전 마지막 커밋 푸시

## 14. 사용자가 직접 해야 할 일 (에이전트가 못 하는 것)
1. Google 계정으로 Firebase 콘솔에서 프로젝트 생성 → Firebase AI Logic 시작(Gemini Developer API)
2. App Check: 웹앱 등록, reCAPTCHA 키 발급, 디버그 토큰 등록
3. Chrome 업데이트(139+) → 플래그 Enabled → 재시작 → DevTools에서 `await LanguageModel.availability()` 확인 (결과를 알려주면 됨)
4. Devpost 참가 등록(devpost.com/icebrain78), 유튜브 업로드, 최종 Submit
5. 공개해도 되는 볼트 마킹 샘플 사진 5~10장 전달
