import { getHealthStatus } from "../services/health.service.js";

export const checkHealth = (req, res, next) => {
  try {
    const healthData = getHealthStatus();
    res.status(200).json({
      success: true,
      data: healthData,
    });
  } catch (error) {
    next(error);
  }
};
