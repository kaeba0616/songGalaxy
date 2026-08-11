import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateShareSlug } from "./share-slug";

describe("generateShareSlug", () => {
  it("10자를 만든다", () => {
    assert.equal(generateShareSlug().length, 10);
  });

  it("헷갈리는 글자(0 O o 1 l I)를 쓰지 않는다", () => {
    // 링크를 손으로 옮겨 적는 사람이 있으므로 혼동 문자를 뺀다.
    // 소문자 o도 0/O와 헷갈리므로 같이 검사한다 — ALPHABET이 o를 다시 포함하게
    // 되돌아가도 이 테스트가 잡아내야 한다.
    for (let i = 0; i < 200; i++) {
      assert.doesNotMatch(generateShareSlug(), /[0Oo1lI]/);
    }
  });

  it("난수원이 같으면 같은 값이 나온다", () => {
    const fixed = () => 0;
    assert.equal(generateShareSlug(fixed), generateShareSlug(fixed));
  });

  it("난수원이 다르면 다른 값이 나온다", () => {
    let n = 0;
    const seq = () => (n++ % 7) / 7;
    const a = generateShareSlug(seq);
    const b = generateShareSlug(seq);
    assert.notEqual(a, b);
  });
});
