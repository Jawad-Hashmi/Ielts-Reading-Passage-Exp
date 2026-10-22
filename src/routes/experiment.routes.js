import { Router } from "express";
import { createPassages, getPassageRunHtml } from "../controllers/experiment.controller.js";

const router = Router();

router.get("/passages/:runId/html", getPassageRunHtml);
router.post("/passages", createPassages);

export default router;
