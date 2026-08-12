import ui from '../styles/ui.module.css'

type Props = {
  /** 화면 이름 (PRD §4의 7개 화면 명칭) */
  title: string
  /** 어느 스펙에서 구현될 예정인지 */
  spec: string
}

/**
 * 아직 구현하지 않은 화면의 자리표시자.
 *
 * 이번 라운드 범위는 `01-auth-couple-link.md`뿐이다. 나머지 화면은 라우팅 구조를 먼저
 * 확정해 두기 위해 경로만 잡고 내용은 비워 둔다.
 * 노선도는 화면 배치 좌표 조달 방식이 아직 결정되지 않아 스펙이 확정되지 않았다.
 */
export function Placeholder({ title, spec }: Props) {
  return (
    <div className={ui.screen}>
      <h1 className={ui.title}>{title}</h1>
      <p className={ui.subtitle}>추후 구현 예정입니다.</p>
      <p className={ui.hint}>{spec}</p>
    </div>
  )
}
