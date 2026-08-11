"use client";

/**
 * 프로필 사진 동그라미.
 *
 * 사진이 없으면 닉네임 첫 글자로 대신 그린다 — 로그인 직후 구글 사진을 받아오긴 하지만
 * 사진이 없는 계정도 있고, 유저가 직접 지울 수도 있다.
 * 외부 URL을 그대로 쓰고 파일을 보관하지 않는다 (앨범아트와 같은 방침).
 */
export default function Avatar({
  src,
  nickname,
  size = 28,
  className = "",
}: {
  src?: string | null;
  nickname?: string;
  size?: number;
  className?: string;
}) {
  const initial = (nickname ?? "").trim().charAt(0) || "★";
  const common = "shrink-0 rounded-full object-cover ring-1 ring-white/25";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- 외부 프로필 사진, 최적화 프록시 불필요
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        draggable={false}
        style={{ width: size, height: size }}
        className={`${common} ${className}`}
        // 링크가 죽었을 때 깨진 이미지 아이콘 대신 첫 글자로 넘어가게 한다
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
      className={`grid place-items-center bg-amber-100/20 font-medium text-amber-100 ${common} ${className}`}
    >
      {initial}
    </span>
  );
}
