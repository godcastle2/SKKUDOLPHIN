# 명륜당 앞바다에 돌고래가 산다!

화면을 눌러 돌고래가 고리를 통과하도록 돕는 모바일 웹 게임입니다.

## 로컬 실행

```bash
python server.py
```

접속 주소:

- PC: `http://localhost:8000`
- 같은 와이파이의 휴대전화: `http://<PC-IP>:8000`
- QR 페이지: `http://<PC-IP>:8000/qr.html`

## 온라인 배포

게임은 GitHub Pages 정적 사이트로 배포됩니다. `main` 브랜치에 변경 사항을 올리면
`.github/workflows/pages.yml`이 실행되어 공개 게임을 자동으로 갱신합니다.

공개 주소:

```text
https://godcastle2.github.io/SKKUDOLPHIN/
```

GitHub 저장소에서 **Settings > Pages > Source**를 **GitHub Actions**로 한 번 설정하면
개발용 컴퓨터가 꺼져 있어도 게임을 계속 이용할 수 있습니다.

## 주요 파일

- `index.html`: 게임 화면
- `qr.html`: QR 공유 페이지
- `src/config.js`: 물리, 난이도, 고리 및 시각 설정
- `src/game.js`: 캔버스 렌더링, 조작, 점수 및 충돌 처리
- `src/physics.js`: 게임 물리 도우미
- `src/styles.css`: 모바일 화면 스타일
- `server.py`: 정적 파일 서버
- `tests/physics_test.py`: 물리 회귀 테스트

- `GET /healthz`: 배포 상태 확인

## 참고

- 실제 행사에서는 배포된 공개 주소를 QR 코드에 사용합니다.
