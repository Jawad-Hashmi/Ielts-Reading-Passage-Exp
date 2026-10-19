export const getHealthStatus = () => {
  return {
    status: "UP",
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  };
};
