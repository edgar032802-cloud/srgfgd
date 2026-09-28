import Reservation from "../components/Reservation.jsx"

/**
 * 활동 페이지 한 벌의 껍데기. 감각 유형 · 제목 · 본문, 그리고 맨 아래 체험 예약.
 *
 * 예약은 네 활동이 모두 똑같이 쓴다 — 활동마다 줄이 따로 서고, 대기 팀 수와
 * 내 순서도 그 줄 기준이다.
 */
function ActivityShell({ id, label, title, children }) {
  return (
    <article className="activity">
      <p className="activity__label">{label}</p>
      <h1 className="activity__title">{title}</h1>
      {children}
      <Reservation activity={id} title={title} />
    </article>
  )
}

/**
 * 아직 내용을 받지 못한 활동.
 *
 * 그럴듯한 진행 방법을 지어내지 않는다 — 작업치료 활동안은 학생회가 쓸 내용이지
 * 화면이 채워 넣을 것이 아니다. 자리만 잡아 두고 비어 있음을 그대로 말한다.
 */
function Pending() {
  return <p className="activity__pending">활동 내용을 준비하고 있습니다.</p>
}

export function SenseRegister() {
  return (
    <ActivityShell id="register" label="감각등록" title="보지 않고 물건 맞추기">
      <Pending />
    </ActivityShell>
  )
}

export function SenseSeek() {
  return (
    <ActivityShell id="seek" label="감각추구" title="말랑이 만들기">
      <Pending />
    </ActivityShell>
  )
}

export function SenseAvoid() {
  return (
    <ActivityShell id="avoid" label="감각회피" title="나만의 무드등 만들기">
      <Pending />
    </ActivityShell>
  )
}

export function SenseSensitive() {
  return (
    <ActivityShell id="sensitive" label="감각예민" title="클레이로 아큐 테리 만들기">
      <Pending />
    </ActivityShell>
  )
}
