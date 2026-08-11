"use client";

/**
 * "지금 이 화면이 은하 위에 겹쳐 떠 있는가"를 알리는 통로.
 *
 * 겹쳐 떠 있을 때와 주소로 직접 열렸을 때는 "은하로 돌아가기"가 해야 할 일이 정반대다
 * (되돌아가기 vs 이동). 주소로 판단하면 틀린다 — 겹쳐 띄운 동안에도 주소는 /songs 처럼
 * 독립 페이지와 똑같기 때문이다. 그래서 껍데기(RouteOverlay)가 직접 알려준다.
 */
import { createContext, useContext } from "react";

const OverlayContext = createContext(false);

export const OverlayProvider = OverlayContext.Provider;

/** 이 컴포넌트가 겹쳐 띄운 화면 안에서 그려지고 있으면 true */
export function useIsInOverlay(): boolean {
  return useContext(OverlayContext);
}
