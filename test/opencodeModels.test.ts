import { assert } from "chai";
import { parseOpenCodeModelList } from "../src/opencode/models";

describe("opencode models", function () {
  it("trims lines, drops blanks, dedupes case-insensitively, and sorts", function () {
    const models = parseOpenCodeModelList(
      "  z/model  \nOpenCode/Model-a\nopencode/model-a\n\n a/model \n",
    );
    assert.deepEqual(models, ["a/model", "OpenCode/Model-a", "z/model"]);
  });

  it("returns an empty list for blank output", function () {
    assert.deepEqual(parseOpenCodeModelList("\n   \n\t\n"), []);
  });
});
