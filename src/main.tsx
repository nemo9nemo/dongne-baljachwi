import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 흑백·심플모던 톤 결정(2026-08-19)과 함께 Noto Sans KR을 자체 호스팅한다.
// CDN(Google Fonts) 대신 패키지로 번들링하는 이유: 오프라인 상태를 화면마다 신경 쓰는
// 앱인데 폰트만 외부 요청에 걸려 있으면 그 노력이 무의미해진다.
import '@fontsource/noto-sans-kr/400.css'
import '@fontsource/noto-sans-kr/500.css'
import '@fontsource/noto-sans-kr/700.css'
// --font-numeric(tokens.css)이 실제로 Inter를 쓰게 하는 실체. 날짜·통계 숫자처럼 라틴/숫자
// 비중이 큰 자리에만 제한적으로 쓴다(2026-08-21 디자이너 인수인계 §7 항목 1 해소).
import '@fontsource/inter/500.css'
import '@fontsource/inter/700.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
