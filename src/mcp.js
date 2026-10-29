import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { toolsFor } from "./tools.js";
export function createMcpServer(client) {
  const server = new McpServer({ name: "opencode-client", version: "0.1.0" });
  for (const tool of toolsFor(client))
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema.shape,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: !tool.readOnly,
          idempotentHint: tool.readOnly,
          openWorldHint: true,
        },
      },
      async (args) => {
        try {
          const result = await tool.run(tool.schema.parse(args));
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: error.message,
                  ...(error.sessionID
                    ? { sessionID: error.sessionID, directory: error.directory }
                    : {}),
                }),
              },
            ],
          };
        }
      },
    );
  return server;
}
export async function serve(client) {
  const server = createMcpServer(client);
  await server.connect(new StdioServerTransport());
  return server;
}
