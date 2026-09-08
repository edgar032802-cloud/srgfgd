import crypto from "node:crypto"

/**
 * 예약자에게 보내는 안내 메시지.
 *
 * 카카오톡을 임의의 번호로 보내려면 **알림톡**이어야 한다 — 카카오톡 채널 개설,
 * 비즈니스 인증, 템플릿 사전 심사, 그리고 발송 대행사 계정이 모두 있어야 한다.
 * 웹페이지가 혼자 보낼 수 있는 길은 없다. 그래서 여기는 대행사(Solapi)를 붙일
 * 자리만 만들어 두고, 키가 없으면 **보내지 않고 문구를 남긴다**. 남긴 문구는
 * 운영 화면에 그대로 뜨므로 현장에서 직접 보낼 수 있다.
 *
 * 필요한 환경변수 (.env):
 *   SOLAPI_API_KEY, SOLAPI_API_SECRET   대행사 키
 *   SMS_SENDER                          사전 등록한 발신번호 (숫자만)
 *   KAKAO_PFID                          카카오 채널 발신 프로필 id (알림톡을 쓸 때)
 *   KAKAO_TEMPLATE_BOOKED / _CALLUP     심사 통과한 템플릿 id
 *
 * 알림톡 템플릿 id 가 없으면 문자(SMS/LMS)로 나간다. 둘 다 없으면 미발송.
 */

const SOLAPI_URL = "https://api.solapi.com/messages/v4/send"

const cfg = () => ({
  key: process.env.SOLAPI_API_KEY ?? "",
  secret: process.env.SOLAPI_API_SECRET ?? "",
  from: (process.env.SMS_SENDER ?? "").replace(/\D/g, ""),
  pfId: process.env.KAKAO_PFID ?? "",
  templates: {
    booked: process.env.KAKAO_TEMPLATE_BOOKED ?? "",
    callup: process.env.KAKAO_TEMPLATE_CALLUP ?? "",
  },
})

export function notifyConfigured() {
  const c = cfg()
  return Boolean(c.key && c.secret && c.from)
}

/** 운영 화면에 상태를 한 줄로 보여 주기 위한 요약. */
export function notifyStatus() {
  const c = cfg()
  if (!notifyConfigured()) return { ready: false, channel: "none" }
  return { ready: true, channel: c.pfId && c.templates.booked ? "알림톡" : "문자" }
}

/** 한글은 2바이트로 세는 이동통신 기준. 90바이트를 넘으면 LMS 다. */
function smsType(text) {
  let bytes = 0
  for (const ch of text) bytes += ch.charCodeAt(0) > 127 ? 2 : 1
  return bytes > 90 ? "LMS" : "SMS"
}

/** Solapi 는 HMAC-SHA256(date + salt) 를 헤더에 담는다. */
function authHeader({ key, secret }) {
  const date = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString("hex")
  const signature = crypto.createHmac("sha256", secret).update(date + salt).digest("hex")
  return `HMAC-SHA256 apiKey=${key}, date=${date}, salt=${salt}, signature=${signature}`
}

/**
 * 한 통 보낸다. 절대 던지지 않는다 — 문자가 안 나갔다고 예약까지 실패하면
 * 줄 서 있는 사람이 사라진다. 결과만 돌려주고 기록에 남긴다.
 *
 * @param {{to: string, text: string, kind: "booked"|"callup", variables?: object}} msg
 * @returns {Promise<{status: "sent"|"failed"|"skipped", channel: string, reason?: string, text: string}>}
 */
export async function sendMessage({ to, text, kind, variables }) {
  const c = cfg()
  const phone = String(to ?? "").replace(/\D/g, "")

  if (!notifyConfigured()) {
    return { status: "skipped", channel: "none", reason: "NOT_CONFIGURED", text }
  }
  if (!phone) return { status: "failed", channel: "none", reason: "NO_PHONE", text }

  const templateId = c.templates[kind] ?? ""
  const useKakao = Boolean(c.pfId && templateId)

  const message = useKakao
    ? {
        to: phone,
        from: c.from,
        type: "ATA",
        text, // 알림톡이 막히면 이 문구가 문자로 대신 나간다
        kakaoOptions: { pfId: c.pfId, templateId, variables: variables ?? {}, disableSms: false },
      }
    : { to: phone, from: c.from, type: smsType(text), text }

  try {
    const response = await fetch(SOLAPI_URL, {
      method: "POST",
      headers: { Authorization: authHeader(c), "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    })
    const data = await response.json().catch(() => ({}))

    // Solapi 는 200 을 주면서 본문에 실패를 담기도 한다.
    const failed = !response.ok || (data.statusCode && data.statusCode !== "2000")
    if (failed) {
      const reason = data.statusMessage ?? data.errorMessage ?? `HTTP ${response.status}`
      console.error("[booth] 발송 실패", phone.slice(-4), reason)
      return { status: "failed", channel: useKakao ? "알림톡" : "문자", reason, text }
    }
    return { status: "sent", channel: useKakao ? "알림톡" : "문자", text }
  } catch (e) {
    console.error("[booth] 발송 중 오류", e.message)
    return { status: "failed", channel: useKakao ? "알림톡" : "문자", reason: e.message, text }
  }
}
