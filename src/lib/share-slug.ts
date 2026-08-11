/**
 * 공유 링크용 slug 생성 — playlists.share_slug의 값 원본 (docs/SSOT.md).
 *
 * 0/O, 1/l/I처럼 눈으로 헷갈리는 글자는 뺐다. 링크를 손으로 옮겨 적는 경우가 있고,
 * 한 글자만 틀려도 404가 되기 때문이다.
 * 32글자 중 10자 → 32^10 ≈ 1126조 가지. 충돌은 DB의 unique 제약이 최종적으로 막는다.
 */
const ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz";
const LENGTH = 10;

export function generateShareSlug(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < LENGTH; i++) {
    out += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return out;
}
