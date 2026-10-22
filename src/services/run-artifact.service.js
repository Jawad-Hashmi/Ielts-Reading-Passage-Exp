import { mkdir, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const outputRoot = fileURLToPath(new URL("../../output/", import.meta.url));

const allocateRunDirectory = async () => {
  await mkdir(outputRoot, { recursive: true });
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const existingNumbers = entries
    .filter((entry) => entry.isDirectory() && /^\d+$/u.test(entry.name))
    .map((entry) => Number(entry.name));
  let runNumber = Math.max(0, ...existingNumbers) + 1;

  while (true) {
    const directory = path.join(outputRoot, String(runNumber));
    try {
      await mkdir(directory);
      return { runNumber, directory };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      runNumber += 1;
    }
  }
};

export const createRunArtifacts = async ({ model, request }) => {
  const { runNumber, directory } = await allocateRunDirectory();
  const runId = String(runNumber);
  const startedAt = new Date().toISOString();

  const writeJson = (fileName, value) => writeFile(
    path.join(directory, fileName),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  const writeText = (fileName, value) => writeFile(path.join(directory, fileName), value, "utf8");

  const log = async (stage, details = {}) => {
    const entry = { timestamp: new Date().toISOString(), runId, stage, ...details };
    await appendFile(path.join(directory, "logs.jsonl"), `${JSON.stringify(entry)}\n`, "utf8");
    console.log(entry);
  };

  await writeJson("run.json", {
    runId,
    model,
    status: "in_progress",
    startedAt,
    request,
  });
  await log("run_started", { model, links: request.links.length });

  return {
    runId,
    directory,
    startedAt,
    writeJson,
    writeText,
    log,
    relativeDirectory: path.relative(process.cwd(), directory),
  };
};
