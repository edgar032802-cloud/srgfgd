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

/**
 * **값은 반드시 trim 한다.**
 *
 * 배포 플랫폼 대시보드에 키를 붙여 넣을 때 앞뒤 공백이나 따옴표가 함께 들어가는
 * 일이 흔하다. `.env` 파일은 dotenv 가 다듬어 주지만 대시보드 입력칸은 넣은
 * 그대로 온다. 시크릿에 공백 한 칸이 붙으면 HMAC 서명이 어긋나 **모든 발송이
 * 401 로 죽는데**, 화면에는 그저 "보내지 못했습니다"만 뜬다. 원인을 찾기가
 * 대단히 어려운 종류의 실패라 아예 들어올 때 막는다.
 */
const clean = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "")

const cfg = () => ({
  key: clean(process.env.SOLAPI_API_KEY),
  secret: clean(process.env.SOLAPI_API_SECRET),
  from: clean(process.env.SMS_SENDER).replace(/\D/g, ""),
  pfId: clean(process.env.KAKAO_PFID),
  templates: {
    booked: clean(process.env.KAKAO_TEMPLATE_BOOKED),
    callup: clean(process.env.KAKAO_TEMPLATE_CALLUP),
  },
})

export function notifyConfigured() {
  const c = cfg()
  return Boolean(c.key && c.secret && c.from)
}

/**
 * 운영 화면에 상태를 한 줄로 보여 주기 위한 요약.
 *
 * 값 자체는 절대 내보내지 않는다. 대신 **길이**를 함께 준다 — 키가 잘려 들어갔거나
 * 공백이 붙었을 때 화면에서 바로 알아볼 수 있는 유일한 단서다.
 * (Solapi 키는 16자, 시크릿은 32자다.)
 */
export function notifyStatus() {
  const c = cfg()
  const shape = { keyLen: c.key.length, secretLen: c.secret.length, sender: c.from ? "***" + c.from.slice(-4) : "" }
  if (!notifyConfigured()) return { ready: false, channel: "none", shape }
  return { ready: true, channel: c.pfId && c.templates.booked ? "알림톡" : "문자", shape }
}

/** 마지막 실패 이유. 운영 화면이 "왜 안 갔는지"를 보여 줄 수 있게 들고 있는다. */
let lastError = null
export const lastNotifyError = () => lastError

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
      // 사람이 읽고 고칠 수 있는 형태로 남긴다. 401 이면 키가 틀렸거나 공백이
      // 붙은 것이고, 잔액이 없으면 그렇게 적혀 온다 — "보내지 못했습니다" 만으로는
      // 어느 쪽인지 알 수 없어 현장에서 손을 쓸 수가 없다.
      const reason = data.errorMessage ?? data.statusMessage ?? data.errorCode ?? `HTTP ${response.status}`
      lastError = { at: new Date().toISOString(), http: response.status, reason: String(reason).slice(0, 160) }
      console.error("[booth] 발송 실패", phone.slice(-4), response.status, reason)
      return { status: "failed", channel: useKakao ? "알림톡" : "문자", reason: lastError.reason, text }
    }
    lastError = null
    return { status: "sent", channel: useKakao ? "알림톡" : "문자", text }
  } catch (e) {
    lastError = { at: new Date().toISOString(), http: 0, reason: e.message }
    console.error("[booth] 발송 중 오류", e.message)
    return { status: "failed", channel: useKakao ? "알림톡" : "문자", reason: e.message, text }
  }
}
