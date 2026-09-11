import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";

const git = args => execFileSync("git", args, { encoding: "utf8" }).trim();
const commit = git(["rev-parse", "HEAD"]);
const info = {
  commit,
  dirty: Boolean(git(["status", "--porcelain", "--untracked-files=no"])),
  builtAt: new Date().toISOString(),
};
await writeFile(new URL("../web/dist/build-info.json", import.meta.url), JSON.stringify(info, null, 2) + "\n");
await writeFile(new URL("../web/dist/deploy-version.txt", import.meta.url), commit + "\n");
