import Reservation from "../components/Reservation.jsx"

const TAGS = ["눈-손 협응", "미세운동", "시지각", "촉각"]

/** 대상·활동·환경. 사용자가 준 근거를 한 줄씩으로만 남긴다. */
const CLAY_NOTES = [
  ["대상", "감각 예민 유형", "자극을 쉽게 인식하지만 스스로 피하지는 못합니다."],
  ["활동", "클레이 조형", "손과 눈을 계속 쓰며 하나의 과제에 머무릅니다."],
  ["환경", "안정적인 감각 경험", "회피하지 않고 마주하도록 하는 중재 개념입니다."],
]

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

/** 감각예민 — 홈에 있던 클레이 섹션의 내용이 이 페이지로 옮겨 왔다. */
export function SenseSensitive() {
  return (
    <ActivityShell id="sensitive" label="감각예민" title="클레이로 아큐 테리 만들기">
      <div className="activity__body">
        <div>
          <ul className="tags" aria-label="활동 요소">
            {TAGS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>

          <ul className="notes">
            {CLAY_NOTES.map(([rail, heading, body]) => (
              <li className="note-row" key={rail}>
                <span className="note-row__rail">{rail}</span>
                <div>
                  <h2>{heading}</h2>
                  <p>{body}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <figure className="activity__figure">
          <img src="/char/terry-sit.png" alt="클레이로 만든 테리" loading="lazy" width="520" height="550" />
        </figure>
      </div>
    </ActivityShell>
  )
}
