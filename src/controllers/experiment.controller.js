import { generatePassages } from "../services/passage-experiment.service.js";
import { fileURLToPath } from "node:url";

export const createPassages = async (req, res, next) => {
  try {
    const result = await generatePassages(req.body);
    result.htmlUrl = `${req.protocol}://${req.get("host")}${result.htmlEndpoint}`;
    res.set("X-Run-ID", result.runId);
    res.set("X-HTML-URL", result.htmlUrl);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return next(error);
  }
};

export const getPassageRunHtml = (req, res, next) => {
  if (!/^\d+$/u.test(req.params.runId)) {
    return res.status(400).json({ success: false, error: { message: "Invalid run ID." } });
  }
  const htmlPath = fileURLToPath(new URL(`../../output/${req.params.runId}/output.html`, import.meta.url));
  res.type("html");
  return res.sendFile(htmlPath);
};
