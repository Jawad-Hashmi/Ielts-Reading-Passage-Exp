export const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    error: {
      message: err.message || "Internal Server Error",
      status: statusCode,
      ...(err.runId ? { runId: err.runId } : {}),
      ...(err.artifactDirectory ? { artifactDirectory: err.artifactDirectory } : {}),
    },
  });
};
