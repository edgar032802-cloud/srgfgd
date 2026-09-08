/**
 * 운영 화면 비밀번호를 이 탭에서만 들고 있는다.
 *
 * sessionStorage 라 탭을 닫으면 사라진다 — 부스에서 쓰던 휴대폰을 잠깐 놓고
 * 가더라도 다음 사람이 그대로 명단을 열지 못한다. 정답은 서버에만 있고,
 * 여기 담기는 것은 사용자가 방금 입력한 값이다.
 */
export const PASSWORD_KEY = "freesiaBoothPw"

export function readPassword() {
  try {
    return sessionStorage.getItem(PASSWORD_KEY) ?? ""
  } catch {
    return ""
  }
}

export function savePassword(value) {
  try {
    if (value) sessionStorage.setItem(PASSWORD_KEY, value)
    else sessionStorage.removeItem(PASSWORD_KEY)
  } catch {
    // 저장소를 못 쓰는 브라우저 — 이 화면을 떠나면 다시 물어본다.
  }
}
