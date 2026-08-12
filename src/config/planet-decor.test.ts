import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PLANET_DECOR,
  decorPlacement,
  groundHeightOffset,
  isDecorSlug,
} from "./planet-decor";

describe("PLANET_DECOR", () => {
  it("slug가 겹치지 않는다", () => {
    const slugs = PLANET_DECOR.map((d) => d.slug);
    assert.equal(new Set(slugs).size, slugs.length);
  });

  it("모든 항목이 label과 place를 갖는다", () => {
    for (const d of PLANET_DECOR) {
      assert.ok(d.label.length > 0, `${d.slug}에 label이 없다`);
      assert.ok(d.place === "ground" || d.place === "sky", `${d.slug}의 place가 이상하다`);
    }
  });

  it("isDecorSlug는 카탈로그에 있는 것만 통과시킨다", () => {
    assert.equal(isDecorSlug(PLANET_DECOR[0].slug), true);
    assert.equal(isDecorSlug("no-such-thing"), false);
    // 저장된 slug를 그대로 SQL/씬에 넘기지 않는다 — 이 검사가 유일한 관문이다
    assert.equal(isDecorSlug(""), false);
  });
});

describe("decorPlacement", () => {
  it("같은 사람의 같은 항목은 늘 같은 자리다", () => {
    // 좌표를 저장하지 않고 해시로 다시 만든다 — 재현되지 않으면 오브젝트가 매번 순간이동한다
    assert.deepEqual(decorPlacement(7, "trees"), decorPlacement(7, "trees"));
  });

  it("사람이 다르면 자리도 다르다", () => {
    assert.notDeepEqual(decorPlacement(7, "trees"), decorPlacement(8, "trees"));
  });

  it("같은 사람이라도 항목이 다르면 자리가 다르다 — 겹쳐 놓이면 안 된다", () => {
    assert.notDeepEqual(decorPlacement(7, "trees"), decorPlacement(7, "rocks"));
  });

  it("거리는 25~75 안이다", () => {
    // 이 행성은 반경 300 구여서 눈높이에서 지평선이 약 30밖에 안 된다.
    // 그보다 멀리 두면 행성이 스스로 가려 아무것도 안 보인다.
    for (let userId = 1; userId <= 50; userId++) {
      for (const d of PLANET_DECOR) {
        const p = decorPlacement(userId, d.slug);
        assert.ok(p.distance >= 25 && p.distance <= 75, `${userId}/${d.slug} → ${p.distance}`);
      }
    }
  });

  it("방위는 0~2π, 고도는 25~40°, 배율은 0.8~1.25 안이다", () => {
    for (let userId = 1; userId <= 50; userId++) {
      for (const d of PLANET_DECOR) {
        const p = decorPlacement(userId, d.slug);
        assert.ok(p.angle >= 0 && p.angle < Math.PI * 2, `angle ${p.angle}`);
        assert.ok(p.elevation >= 25 && p.elevation <= 40, `elevation ${p.elevation}`);
        assert.ok(p.scale >= 0.8 && p.scale <= 1.25, `scale ${p.scale}`);
      }
    }
  });
});

describe("groundHeightOffset", () => {
  it("발밑(거리 0)에서는 지면 꼭대기가 +1.5다", () => {
    assert.equal(Math.round(groundHeightOffset(0) * 10) / 10, 1.5);
  });

  it("멀어질수록 내려간다", () => {
    assert.ok(groundHeightOffset(240) < groundHeightOffset(60));
    assert.ok(groundHeightOffset(60) < groundHeightOffset(0));
  });

  it("거리 60·240에서의 값 (구면 공식)", () => {
    assert.equal(Math.round(groundHeightOffset(60) * 10) / 10, -4.6);
    assert.equal(groundHeightOffset(240), -118.5);
  });

  it("지면 밖(300 이상)이면 지면 가장자리 높이로 묶는다", () => {
    // sqrt(음수) = NaN이 되어 오브젝트가 화면에서 사라진다
    assert.equal(groundHeightOffset(300), -298.5);
    assert.equal(groundHeightOffset(9999), -298.5);
  });
});
