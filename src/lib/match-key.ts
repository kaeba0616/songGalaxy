/**
 * 곡 매칭 키 — 출처가 다른 곡을 같은 곡으로 알아보기 위한 정규화 (SSOT).
 *
 * 데이터셋 CSV(적재 스크립트)와 편입 시 조회(place-song)가 반드시 같은 규칙을 써야
 * 하므로 여기 한 곳에만 둔다. 규칙을 바꾸면 dataset_features를 다시 적재해야 한다.
 */

/** 소문자 + 문자/숫자만 남긴다 (공백·기호·따옴표 차이를 흡수) */
export function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * 부제를 뗀 제목 키.
 * "Song (feat. X)", "Song - Remastered 2011", "Song [Live]" → "song"
 * 스토어마다 표기가 달라 원제목만으로는 매칭이 자주 실패한다.
 */
export function baseTitleKey(title: string): string {
  const stripped = title
    .replace(/[([{][\s\S]*$/, "") // 첫 괄호부터 끝까지
    .replace(/\s[-–—]\s[\s\S]*$/, ""); // " - 부제"
  const base = normalizeKey(stripped);
  return base || normalizeKey(title); // 전부 날아가면 원제목으로
}

/**
 * 대표 가수 하나만 뽑는다.
 * 데이터셋은 "A;B", 스토어는 "A feat. B" / "A & B" 식이라 첫 이름만 비교한다.
 */
export function primaryArtistKey(artist: string): string {
  const first = artist.split(/[;,&/]|\sfeat\.?\s|\sft\.?\s|\swith\s|\sx\s/i)[0];
  return normalizeKey(first) || normalizeKey(artist);
}
