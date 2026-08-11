import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateShareSlug } from "./share-slug";

describe("generateShareSlug", () => {
  it("10자를 만든다", () => {
    assert.equal(generateShareSlug().length, 10);
  });

  it("헷갈리는 글자(0 O 1 l I)를 쓰지 않는다", () => {
    // 링크를 손으로 옮겨 적는 사람이 있으므로 혼동 문자를 뺀다
    for (let i = 0; i < 200; i++) {
      assert.doesNotMatch(generateShareSlug(), /[0O1lI]/);
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
