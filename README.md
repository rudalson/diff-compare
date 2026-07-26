# TinyDiff

<p align="center">
  <img src="https://img.shields.io/badge/Electron-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron Badge" />
  <img src="https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB" alt="React Badge" />
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript Badge" />
  <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite Badge" />
</p>

**TinyDiff**는 대표적인 비교 유틸리티인 *Beyond Compare*에서 영감을 받아 제작된 현대적이고 세련된 디자인의 데스크톱 파일 및 폴더 비교 도구입니다.

Electron을 기반으로 한 안전한 OS 파일 시스템 접근성, React + Vite의 고속 프런트엔드 렌더링, 그리고 커스텀 Myers Diff 알고리즘을 결합하여 가볍고 강력한 디프(Diff) 환경을 제공합니다.

---

## ⚡ 주요 기능 (Key Features)

### 📁 폴더 비교 & 동기화 (Folder Compare & Sync)
* **대칭형 좌우 분할 트리뷰**: Beyond Compare 스타일로 좌우 디렉터리를 나란히 배치하여 비교합니다.
* **폴더 우선 정렬(Directory-first Sorting)**: 폴더가 알파벳순으로 상단에 모여 정렬된 후 파일들이 아래쪽에 정렬됩니다.
* **단계별 펼침/접힘(Expand/Collapse)**: 초기 비교 시 모든 폴더가 닫힌 채 시작하며, 꺾쇠 아이콘(`▶`, `▼`)을 통해 단계적으로 구조를 탐색할 수 있습니다.
* **존재 여부 대조**: 한쪽에만 존재하는 파일은 상대방 영역을 빈칸`(No file on left/right)`으로 처리하여 완벽히 행을 맞춰 대조해 줍니다.
* **원클릭 파일 동기화**: 중앙의 방향 화살표를 눌러 좌측 파일을 우측으로, 혹은 우측 파일을 좌측으로 바로 복사할 수 있습니다.

### 📝 텍스트 비교 & 편집 (Text Compare & Merge)
* **사이드 바이 사이드 디프(Side-by-Side Diff)**: 커스텀 구현된 **Myers Diff 알고리즘**을 활용해 라인 단위 차이점을 강조 표시합니다. (삭제: 빨간색, 추가: 초록색, 변경: 파란색)
* **동기화 스크롤(Synchronized Scrolling)**: 한쪽 에디터를 스크롤하면 반대편 에디터도 가로/세로 동기화되어 움직입니다.
* **인라인 텍스트 편집**: 라인 내용을 더블클릭하지 않고도 각 패널에서 직접 키보드로 수정할 수 있습니다.
* **라인 머지(Line Merging)**: 중앙의 `<` 및 `>` 버튼을 사용하여 특정 라인의 변경 사항을 반대편 파일로 빠르게 병합할 수 있습니다.
* **개별 파일 저장**: 편집 혹은 병합된 최종 텍스트 결과를 각각의 실제 파일로 저장할 수 있습니다.

---

## 🛠 기술 스택 (Technology Stack)

* **Backend / Shell**: Electron (TypeScript, IPC contextBridge)
* **Frontend**: React (v18), Vite, TypeScript
* **Styling**: Custom CSS (CSS Variables 기반 프리미엄 다크 테마, 글래스모피즘 효과)
* **Icons**: Lucide React
* **Diff Engine**: Custom Myers Diff Algorithm (in-memory & fallback linear-search)

---

## 🚀 시작하기 (Getting Started)

### 사전 요구사항
* [Node.js](https://nodejs.org/) (v18 이상 권장, 개발 환경은 v25 기반 검증 완료)

### 설치 및 구동 방법

1. **저장소 클론 및 패키지 설치**
   ```bash
   git clone https://github.com/your-username/diff-compare.git
   cd diff-compare
   npm install
   ```

2. **개발 모드 실행**
   Vite 개발 서버와 Electron 쉘을 동시에 핫 리로드 모드로 실행합니다.
   ```bash
   npm run dev
   ```

3. **프로젝트 빌드**
   메인/프리로드 스크립트를 컴파일하고 React 앱을 프로덕션용으로 번들링합니다.
   ```bash
   npm run build
   ```

---

## 📂 프로젝트 구조 (Project Structure)

```text
diff-compare/
├── src/
│   ├── main/
│   │   ├── main.ts          # Electron 메인 프로세스 (윈도우 관리 및 파일 IPC 핸들러)
│   │   ├── preload.ts       # IPC 보안 브리지
│   │   └── diffEngine.ts    # 커스텀 Myers Diff 비교 알고리즘
│   └── renderer/
│       ├── components/
│       │   ├── FolderCompare.tsx  # 폴더 비교 및 동기화 컴포넌트
│       │   └── TextCompare.tsx    # 텍스트 비교, 라인 수정 및 머지 컴포넌트
│       ├── App.tsx          # 멀티 탭 관리 및 대시보드 레이아웃
│       ├── index.css        # 프리미엄 디자인 시스템 CSS 토큰 정의
│       ├── main.tsx         # React 진입점
│       └── global.d.ts      # IPC 타입 정의 선언
├── package.json             # 의존성 및 스크립트 설정
├── tsconfig.json            # TypeScript (Renderer) 설정
├── tsconfig.main.json       # TypeScript (Electron Main) 설정
└── vite.config.ts           # Vite 번들러 설정
```
