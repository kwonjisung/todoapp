# Google 로그인 켜기 (한 번만 하면 돼요)

약 10분 걸려요. 순서대로 하면 돼요. 이 설정을 하기 전까지 앱은 예전처럼(연결 링크 열쇠로) 그대로 동작해요.

준비할 것: 앱 주소 `https://jstodoshop.netlify.app`, 로그인할 Gmail 계정

---

## 1단계. Google에서 "로그인 열쇠" 만들기

1. PC에서 https://console.cloud.google.com 에 들어가 로그인해요.
2. 위쪽 프로젝트 선택 상자 → **새 프로젝트** → 이름 `todoapp` → **만들기**. 만든 프로젝트가 선택됐는지 확인해요.
3. 왼쪽 메뉴(☰) → **Google 인증 플랫폼**(Google Auth Platform) → **시작하기**
   - 앱 이름: `장바구니 메모`
   - 사용자 지원 이메일: 내 Gmail
   - 대상: **외부**(External)
   - 연락처 이메일: 내 Gmail → 동의 체크 → **만들기**
4. 왼쪽 **대상**(Audience) 메뉴 → 아래쪽 **테스트 사용자** → **사용자 추가** → 로그인할 Gmail 주소(나, 가족)를 넣고 저장.
   - 게시 상태는 **테스트** 그대로 두세요. 이렇게 하면 여기에 넣은 사람만 로그인할 수 있어서 더 안전해요.
5. 왼쪽 **클라이언트**(Clients) → **클라이언트 만들기**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 이름: `todoapp`
   - **승인된 리디렉션 URI** → URI 추가: `https://jstodoshop.netlify.app/api/auth/callback` (한 글자도 틀리면 안 돼요)
   - "승인된 자바스크립트 원본"은 비워 둬도 돼요.
   - **만들기**
6. 뜨는 창에서 **클라이언트 ID**와 **클라이언트 보안 비밀번호**(Client secret)를 복사해 메모장에 둬요.
   - 비밀번호는 이 창에서만 보일 수 있어요. 놓쳤으면 클라이언트를 열어 새 비밀번호를 추가하면 돼요.
   - 비밀번호는 다른 사람에게 보내지 마세요.

## 2단계. Netlify에 넣기

1. https://app.netlify.com/projects/jstodoshop 에 들어가요.
2. **Project configuration** → **Environment variables** → **Add a variable** → **Add a single variable**
3. 아래 두 개(선택이면 세 개)를 하나씩 추가해요. 값 앞뒤에 공백이 없게 붙여 넣어요.

   | Key | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` | 1단계에서 복사한 클라이언트 ID (`....apps.googleusercontent.com`) |
   | `GOOGLE_CLIENT_SECRET` | 1단계에서 복사한 클라이언트 보안 비밀번호 ("Contains secret values" 체크) |
   | `ALLOWED_EMAILS` (선택) | 쓸 수 있는 Gmail만, 쉼표로: `me@gmail.com,family@gmail.com` |

4. **Deploys** → **Trigger deploy** → **Deploy site**. 환경 변수는 새로 배포해야 적용돼요.

## 3단계. 앱에서 로그인

1. 지금 쓰던 휴대폰(또는 PC)에서 앱을 열면 위에 **Google로 로그인** 버튼이 보여요. 눌러서 로그인해요.
2. "이 목록을 내 Google 계정으로 옮겼어요"가 뜨면 끝. 지금까지 적은 목록이 그대로 계정으로 옮겨져요.
   - 옮긴 뒤에는 예전 연결 링크로는 목록을 볼 수 없어요 (보안).
   - 혹시 몰라 서버에 옮기기 전 원본을 한 벌 백업해 둬요.
3. 다른 기기에서도 앱을 열고 같은 Google 계정으로 로그인하면 같은 목록이 보여요.
   - 예전 링크로 연결돼 있던 기기는 "이 목록은 Google 계정으로 옮겨졌어요"가 뜨고, 로그인하면 다시 보여요. 그 기기에만 있던 변경도 합쳐져요.
   - 홈 화면에 설치한 앱(아이폰)은 Safari와 로그인이 따로라서, 설치한 앱 안에서 한 번 더 로그인해요.

## 음성·단축어(MacroDroid)

- 예전 열쇠를 넣어 둔 매크로는 **그대로 동작**해요 (이제 "추가만" 되고 목록은 못 읽는 열쇠가 돼요).
- 새 주소로 바꾸고 싶으면: 앱 오른쪽 위 버전 표시 → **내 계정** → "음성·단축어용 추가 주소" 복사. "새 주소 만들기"를 누르면 예전 주소는 못 쓰게 돼요.

## 문제가 생기면

- 로그인 누르면 Google에서 `redirect_uri_mismatch` → 1단계 5번의 리디렉션 URI가 정확한지 확인.
- `access_denied` 또는 "이 Google 계정은 이 앱을 쓸 수 없어요" → 1단계 4번 테스트 사용자, 또는 `ALLOWED_EMAILS`에 그 Gmail이 있는지 확인.
- 로그인 버튼이 안 보임 → 2단계 환경 변수 이름 철자, 그리고 다시 배포했는지 확인.
