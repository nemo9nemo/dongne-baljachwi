import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
} from 'react-router-dom'
import { SessionProvider } from './auth/SessionProvider'
import {
  RedirectIfSignedIn,
  RequireAuth,
  RequireCouple,
  RequireNoCouple,
} from './auth/guards'
import { AppShell } from './components/AppShell'
import { isSupabaseConfigured } from './lib/supabase'
import { LineMapScreen } from './screens/lines/LineMapScreen'
import { MapViewScreen } from './screens/lines/MapViewScreen'
import { RecordDetailScreen } from './screens/records/RecordDetailScreen'
import { RecordEditorScreen } from './screens/records/RecordEditorScreen'
import { StationDetailScreen } from './screens/stations/StationDetailScreen'
import { TimelineScreen } from './screens/timeline/TimelineScreen'
import { AuthCallbackScreen } from './screens/auth/AuthCallbackScreen'
import { ForgotPasswordScreen } from './screens/auth/ForgotPasswordScreen'
import { LoginScreen } from './screens/auth/LoginScreen'
import { ResetPasswordScreen } from './screens/auth/ResetPasswordScreen'
import { SignUpScreen } from './screens/auth/SignUpScreen'
import { VerifyEmailScreen } from './screens/auth/VerifyEmailScreen'
import { CoupleLinkedScreen } from './screens/invite/CoupleLinkedScreen'
import { InviteScreen } from './screens/invite/InviteScreen'
import { OnboardingScreen } from './screens/onboarding/OnboardingScreen'
import { ProfileScreen } from './screens/profile/ProfileScreen'
import shell from './components/AppShell.module.css'
import frame from './styles/app-frame.module.css'
import ui from './styles/ui.module.css'

/**
 * backdrop/frame div는 순수 프레젠테이션이다. 로그인 화면과 AppShell은 라우팅상 형제라
 * 공통 조상이 여기뿐이어서, 데스크톱 앱 프레임을 이 위치에서 씌운다.
 * (styles/app-frame.module.css — 모바일에서는 아무 효과 없음)
 */
function RootFrame() {
  return (
    <div className={frame.backdrop}>
      <div className={frame.frame}>
        {/* Supabase 프로젝트가 아직 없으면 모든 네트워크 호출이 실패한다.
            화면이 조용히 비어 보이는 것보다 이유를 알려주는 게 낫다. */}
        {!isSupabaseConfigured && (
          <p className={shell.configWarning} role="alert">
            .env.local의 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY가 비어 있어 서버 호출이
            모두 실패합니다.
          </p>
        )}
        <Outlet />
      </div>
    </div>
  )
}

/**
 * 라우팅 구조.
 *
 * PRD §4의 7개 화면 경로를 확정해 두고, 구현이 끝난 화면부터 자리표시자를 걷어낸다.
 * 지금 실제 화면이 있는 것: 01(인증·커플 연결), 03(노선도), 04(역 상세), 05(기록 작성/수정),
 * 06(기록 상세), 07(지도 보기), 08(타임라인). 09(프로필)는 설정 영역만.
 * 경로 명명은 개발자 재량이다 (04 F-09).
 *
 * 가드 계층:
 *   RequireAuth → RequireCouple → AppShell(탭 레이아웃) → 각 화면
 * 온보딩만 `RequireAuth → RequireNoCouple`로 반대 조건을 건다 (01 §2.4).
 *
 * **`<BrowserRouter>`가 아니라 데이터 라우터를 쓰는 이유**: 기록 작성 화면이 작성 중
 * 이탈을 막아야 하는데(05 F-04/AC-14), `useBlocker`는 데이터 라우터에서만 동작한다.
 * 라우트 트리 자체는 이전과 같다. 로더/액션은 쓰지 않는다 — 데이터 페칭은 각 화면이
 * Supabase를 직접 부르는 방식 그대로다 (ADR-001 순수 SPA).
 */
const router = createBrowserRouter(
  createRoutesFromElements(
    <Route element={<RootFrame />}>
      {/* 미인증 전용 */}
      <Route element={<RedirectIfSignedIn />}>
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/signup" element={<SignUpScreen />} />
      </Route>

      {/* 세션 유무와 무관하게 열려야 하는 메일 링크 착지점 */}
      <Route path="/verify-email" element={<VerifyEmailScreen />} />
      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
      <Route path="/auth/callback" element={<AuthCallbackScreen />} />
      <Route path="/auth/reset-password" element={<ResetPasswordScreen />} />

      <Route element={<RequireAuth />}>
        {/* 커플 미연결 상태에서만 보이는 온보딩 */}
        <Route element={<RequireNoCouple />}>
          <Route path="/onboarding" element={<OnboardingScreen />} />
        </Route>

        {/* 온보딩의 연장선. 탭 레이아웃 없이 전체 화면으로 보여준다.
            RequireCouple을 씌우지 않는 이유: 커플을 만든 직후 세션 갱신이 끝나기
            전에 여기로 이동하기 때문이다. 커플 없이 직접 들어온 경우는 각 화면이
            스스로 온보딩으로 돌려보낸다. */}
        <Route path="/invite" element={<InviteScreen />} />
        <Route path="/couple/linked" element={<CoupleLinkedScreen />} />

        <Route element={<RequireCouple />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<Navigate to="/lines" replace />} />
            <Route path="/lines" element={<LineMapScreen />} />
            <Route path="/map" element={<MapViewScreen />} />
            <Route path="/stations/:stationId" element={<StationDetailScreen />} />
            {/* 작성/수정은 같은 화면이다 (05 F-02). 차이는 초기값과 저장 동작뿐. */}
            <Route path="/records/new" element={<RecordEditorScreen />} />
            <Route path="/records/:recordId" element={<RecordDetailScreen />} />
            <Route path="/records/:recordId/edit" element={<RecordEditorScreen />} />
            <Route path="/timeline" element={<TimelineScreen />} />
            <Route path="/profile" element={<ProfileScreen />} />
          </Route>
        </Route>
      </Route>

      <Route
        path="*"
        element={
          <div className={ui.centerBox}>
            <p>없는 페이지예요.</p>
          </div>
        }
      />
    </Route>,
  ),
)

export default function App() {
  return (
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  )
}
