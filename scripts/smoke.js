// Read-only by default. --delegate opts into one model call in a new test session.
import { connect } from "../src/client.js";
try {
  const client = await connect();
  const health = await client.health();
  const projects = await client.projects();
  const models = await client.models({ connectedOnly: true });
  const sessions = await client.sessions({ allProjects: true, limit: 10 });
  console.log(
    JSON.stringify(
      {
        health,
        projectCount: projects.length,
        connectedProviders: models.connected,
        modelCount: models.models.length,
        sessionCount: sessions.sessions.length,
        sessionScope: sessions.scope,
      },
      null,
      2,
    ),
  );
  if (process.argv.includes("--delegate")) {
    const directory = process.env.OPENCODE_TEST_DIRECTORY;
    if (!directory)
      throw new Error(
        "Set OPENCODE_TEST_DIRECTORY to an authorized server-side directory",
      );
    const model = process.env.OPENCODE_TEST_MODEL
      ? JSON.parse(process.env.OPENCODE_TEST_MODEL)
      : undefined;
    const submission = await client.delegate({
      directory,
      model,
      title: "OpenCode client smoke test",
      prompt:
        "Reply with exactly OPENCODE_CLIENT_OK. Do not use tools, edit files, or execute commands.",
    });
    console.log(JSON.stringify(submission));
    const result = await client.wait({ ...submission, timeoutMs: 60000 });
    console.log(JSON.stringify(result));
    if (
      result.state !== "completed" ||
      !result.message.parts.some(
        (p) => p.type === "text" && p.text.includes("OPENCODE_CLIENT_OK"),
      )
    )
      throw new Error(
        `Smoke task did not complete successfully: ${result.state}`,
      );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
