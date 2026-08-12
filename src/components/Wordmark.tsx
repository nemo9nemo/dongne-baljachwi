import ui from '../styles/ui.module.css'

/**
 * 텍스트 워드마크.
 *
 * 미인증 화면(로그인·가입·비밀번호 재설정·메일 확인)에서만 쓴다. 로그인 뒤에는 탭바가
 * 서비스 정체성을 대신하므로 화면마다 로고를 반복할 이유가 없다.
 * 옆의 마크는 순수 장식이라 스크린리더에서 숨긴다 — 읽어야 할 내용은 서비스명뿐이다.
 */
export function Wordmark() {
  return (
    <p className={ui.brand}>
      <span className={ui.brandMark} aria-hidden="true" />
      동네 발자취
    </p>
  )
}
