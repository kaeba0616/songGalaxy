/**
 * Next.js 서버 시작 시 1회 실행되는 훅.
 *
 * WSL처럼 IPv6가 라우팅되지 않는 환경에서 Node 20의 happy-eyeballs
 * (autoSelectFamily, 기본 250ms 창)가 일부 호스트로의 IPv4 연결을
 * 조기에 끊어 fetch가 ETIMEDOUT으로 죽는다 (MusicBrainz 등에서 재현).
 * 서버 전역에서 비활성화한다.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const net = await import("node:net");
    net.setDefaultAutoSelectFamily(false);
  }
}
