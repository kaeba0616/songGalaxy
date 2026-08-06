/**
 * 장르 → 성단(큰 테마) 매핑 — SSOT (docs/SSOT.md 참조)
 * 데이터셋의 125개 장르 전체를 12개 성단으로 그룹핑한다.
 * 성단 추가/이동은 반드시 여기서만 한다. build-themes 배치와 신곡 파이프라인이 함께 사용한다.
 *
 * 주의: 이미 좌표가 확정된 곡은 매핑을 바꿔도 이동하지 않는다 (좌표 불변 원칙).
 * 매핑 변경은 이후 적재되는 곡에만 영향을 준다.
 */

export interface ClusterDef {
  /** 성단 식별 슬러그 (themes.name, level 1) */
  slug: string;
  /** 화면에 표시할 이름표 */
  label: string;
  /** 성단 대표 색 (렌더러에서 별 색·라벨에 사용) */
  color: string;
  /** 이 성단에 속하는 원본 장르들 (themes.name, level 2) */
  genres: string[];
}

export const GENRE_CLUSTERS: ClusterDef[] = [
  {
    slug: "pop",
    label: "팝",
    color: "#ff6ec7",
    genres: ["pop", "indie-pop", "power-pop", "synth-pop", "pop-film", "party", "disco"],
  },
  {
    slug: "asian-pop",
    label: "아시아 팝",
    color: "#ff9de2",
    genres: ["k-pop", "j-pop", "j-idol", "j-rock", "j-dance", "anime", "mandopop", "cantopop"],
  },
  {
    slug: "rock",
    label: "록",
    color: "#ff5c5c",
    genres: [
      "rock", "alt-rock", "alternative", "hard-rock", "punk", "punk-rock", "psych-rock",
      "rock-n-roll", "rockabilly", "grunge", "emo", "indie", "british", "garage",
    ],
  },
  {
    slug: "metal",
    label: "메탈",
    color: "#b23a48",
    genres: [
      "metal", "heavy-metal", "black-metal", "death-metal", "metalcore", "grindcore",
      "hardcore", "industrial", "goth",
    ],
  },
  {
    slug: "electronic",
    label: "일렉트로닉",
    color: "#4dd7ff",
    genres: [
      "edm", "electro", "electronic", "house", "deep-house", "chicago-house",
      "progressive-house", "techno", "detroit-techno", "minimal-techno", "trance",
      "dubstep", "drum-and-bass", "breakbeat", "idm", "club", "dance", "hardstyle",
    ],
  },
  {
    slug: "hiphop-rnb",
    label: "힙합·R&B",
    color: "#ffb84d",
    genres: ["hip-hop", "r-n-b", "soul", "funk", "groove", "trip-hop", "gospel"],
  },
  {
    slug: "jazz-blues",
    label: "재즈·블루스",
    color: "#c48cff",
    genres: ["jazz", "blues"],
  },
  {
    slug: "folk-country",
    label: "포크·컨트리",
    color: "#d9a86c",
    genres: [
      "acoustic", "folk", "singer-songwriter", "songwriter", "country", "honky-tonk",
      "bluegrass", "guitar",
    ],
  },
  {
    slug: "classical",
    label: "클래식",
    color: "#f5e6a8",
    genres: ["classical", "opera", "piano", "new-age"],
  },
  {
    slug: "latin",
    label: "라틴",
    color: "#7dff8a",
    genres: [
      "latin", "latino", "salsa", "samba", "reggaeton", "brazil", "mpb", "pagode",
      "sertanejo", "forro", "tango", "spanish",
    ],
  },
  {
    slug: "world-reggae",
    label: "월드·레게",
    color: "#4dffc3",
    genres: [
      "world-music", "afrobeat", "reggae", "dancehall", "dub", "ska", "french",
      "german", "swedish", "turkish", "iranian", "indian", "malay",
    ],
  },
  {
    slug: "mood-theme",
    label: "무드·테마",
    color: "#9fb8ff",
    genres: [
      "chill", "sleep", "study", "ambient", "sad", "happy", "romance", "comedy",
      "children", "kids", "disney", "show-tunes",
    ],
  },
];

/** 장르 → 성단 역인덱스 */
export const GENRE_TO_CLUSTER: ReadonlyMap<string, ClusterDef> = new Map(
  GENRE_CLUSTERS.flatMap((cluster) => cluster.genres.map((genre) => [genre, cluster])),
);
