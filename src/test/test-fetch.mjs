const url = "https://www.smithsonianmag.com/";

for (const method of ["HEAD", "GET"]) {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "user-agent": "PassageExperiment/1.0",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    });

    console.log({
      method,
      status: response.status,
      location: response.headers.get("location"),
      contentType: response.headers.get("content-type"),
      finalUrl: response.url,
    });

    await response.body?.cancel();
  } catch (error) {
    console.error(method, error.message);
  }
}
