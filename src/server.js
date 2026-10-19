import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { config } from "./config/env.js";
import healthRoutes from "./routes/health.routes.js";
import { errorHandler } from "./middleware/error.middleware.js";

const app = express();

// Security and utility middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// 2. Use morgan in "dev" mode for color-coded logging HTTP requests
app.use(morgan("dev"));

// API Routes
app.use("/api/v1", healthRoutes);

// Global Error Handler
app.use(errorHandler);

app.listen(config.port, () => {
  console.log(
    `Server running in ${config.nodeEnv} mode on port ${config.port}`,
  );
});
