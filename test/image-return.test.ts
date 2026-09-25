import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  collectTurnImagePaths,
  extractImagePaths,
  grokSessionAssetsDir,
  grokSessionMediaDirs,
} from "../src/bot/image-return.js";
import { IMAGE_OUTPUT_DIRECTIVE } from "../src/render/image-output.js";

test("extractImagePaths does not hang on an inlined base64 image", () => {
  const blob = "iVBORw0KGgo" + "A".repeat(200_000);
  const start = Date.now();
  const paths = extractImagePaths(blob, "/workspace/GitHub/JungAuto");
  assert.ok(Date.now() - start < 200);
  assert.deepEqual(paths, []);
});

test("extractImagePaths takes a MEDIA tag and ignores a path that is not on disk", () => {
  const paths = extractImagePaths(
    "see MEDIA:/tmp/shot.png and also /no/such/file.jpg",
    "/workspace",
  );
  assert.deepEqual(paths, ["/tmp/shot.png"]);
});

test("extractImagePaths takes a bare absolute path that exists, backticks included", () => {
  const dir = mkdtempSync(join(tmpdir(), "imgret-"));
  const shot = join(dir, "outlook-register-stop.png");
  writeFileSync(shot, Buffer.from([1, 2, 3, 4]));
  const paths = extractImagePaths(`截图：\`${shot}\``, "/workspace");
  assert.deepEqual(paths, [shot]);
});

test("extractImagePaths ignores a relative path", () => {
  const paths = extractImagePaths("saved as images/1.jpg", "/workspace");
  assert.deepEqual(paths, []);
});

test("grokSessionAssetsDir matches encodeURIComponent(cwd) layout", () => {
  const cwd = "H:\\Lucru\\Domains\\WinAppBuilder";
  const dir = grokSessionAssetsDir(cwd, "abc-session");
  assert.equal(
    dir,
    join(homedir(), ".grok", "sessions", encodeURIComponent(cwd), "abc-session", "assets"),
  );
});

test("grokSessionMediaDirs includes both images and assets", () => {
  const cwd = "H:\\Lucru\\Domains\\WinAppBuilder";
  const dirs = grokSessionMediaDirs(cwd, "abc-session");
  assert.equal(dirs.length, 2);
  assert.ok(dirs[0]!.endsWith(join("abc-session", "images")));
  assert.ok(dirs[1]!.endsWith(join("abc-session", "assets")));
});

test("IMAGE_OUTPUT_DIRECTIVE tells the agent to write a MEDIA tag", () => {
  assert.match(IMAGE_OUTPUT_DIRECTIVE, /MEDIA:\/absolute\/path/);
  assert.ok(!/\s$/.test(IMAGE_OUTPUT_DIRECTIVE));
  assert.ok(!/\n{3,}/.test(IMAGE_OUTPUT_DIRECTIVE));
});

test("collectTurnImagePaths sends only a path the reply names", () => {
  const dir = mkdtempSync(join(tmpdir(), "imgret-root-"));
  const shot = join(dir, "shot.webp");
  writeFileSync(shot, Buffer.from([9, 9, 9]));
  const named = collectTurnImagePaths({
    scanText: `截图：\`${shot}\``,
    cwd: dir,
    since: Date.now(),
  });
  assert.deepEqual(named, [shot]);

  const unnamed = collectTurnImagePaths({
    scanText: "done, nothing to show",
    cwd: dir,
    since: Date.now(),
  });
  assert.deepEqual(unnamed, []);
});

test("collectTurnImagePaths drops the user's own upload echoed from session assets", () => {
  const cwd = join(homedir(), "proj");
  const sessionId = "sess-1";
  const upload = join(grokSessionAssetsDir(cwd, sessionId), "image-user.jpg");
  const paths = collectTurnImagePaths({
    scanText: `MEDIA:${upload}`,
    cwd,
    sessionId,
    since: Date.now(),
  });
  assert.equal(paths.some((p) => p.endsWith("image-user.jpg")), false);
});
