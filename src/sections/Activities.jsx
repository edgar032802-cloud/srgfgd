import { motion } from "motion/react"

/**
 * 감각 유형별 활동 넷, 지금 바로 해볼 수 있는 것 하나, 그리고 인스타그램.
 *
 * 앞의 넷은 각자의 페이지(체험 예약이 거기 있다)로, 다음 하나는 이 페이지 안의
 * 달리기로, 마지막은 계정으로 간다.
 * 칸마다 모서리를 굴린 흰 카드로 띄운다 — 여기가 이 사이트에서 유일하게
 * "고르는" 화면이라, 누를 수 있다는 것이 한눈에 보여야 한다.
 */
const ITEMS = [
  { label: "감각등록", title: "보지 않고 물건 맞추기", href: "#/sense/register" },
  { label: "감각추구", title: "말랑이 만들기", href: "#/sense/seek" },
  { label: "감각예민", title: "클레이로 아큐 테리 만들기", href: "#/sense/sensitive" },
  { label: "감각회피", title: "나만의 무드등 만들기", href: "#/sense/avoid" },
  // 감각 활동 넷은 한 줄에 나란히 서고, 성격이 다른 게임은 그 아래 한 줄을 통째로 쓴다.
  { label: "지금 해보기", title: "테리와 함께 달리기", href: "#game", wide: true },
]

const INSTAGRAM = "https://www.instagram.com/shingu_occupational/"

/** 인스타그램 글리프. 아이콘 하나 때문에 폰트를 더 받지 않는다. */
function InstagramMark() {
  return (
    <svg className="tile__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" />
    </svg>
  )
}

export default function Activities() {
  return (
    <section className="sec activities" id="activities">
      <div className="wrap">
        <motion.h2
          className="sec__title activities__title"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.5 }}
        >
          체험 바로가기
        </motion.h2>

        <ul className="tiles">
          {ITEMS.map((item) => (
            <li key={item.href} className={item.wide ? "tiles__wide" : undefined}>
              <a className="tile" href={item.href}>
                <span className="tile__label">{item.label}</span>
                <span className="tile__title">{item.title}</span>
                <span className="tile__go" aria-hidden="true">
                  →
                </span>
              </a>
            </li>
          ))}

          <li className="tiles__wide">
            <a className="tile tile--insta" href={INSTAGRAM} target="_blank" rel="noreferrer noopener">
              <span className="tile__label">인스타그램</span>
              <span className="tile__title">@shingu_occupational</span>
              <InstagramMark />
            </a>
          </li>
        </ul>
      </div>
    </section>
  )
}
