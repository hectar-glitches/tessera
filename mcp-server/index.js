#!/usr/bin/env node
// OrgCache MCP server (stdio transport). Exposes OrgCache to any MCP-compatible agent
// (Claude Code, Cursor, Devin, etc.). See README.md for client config.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { checkCache, storeAnswer, getTrending, ORGCACHE_URL, ORG } from "./lib.js";

const asText = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

const seg = {
  role: z.enum(["engineer", "designer", "pm", "devops", "manager"]).optional(),
  seniority: z.enum(["junior", "mid", "senior", "staff", "principal"]).optional(),
  tenure: z.enum(["onboarding", "experienced"]).optional(),
};

const server = new McpServer({ name: "orgcache", version: "1.0.0" });

server.registerTool(
  "check_cache",
  {
    title: "Check OrgCache",
    description: "Check the org semantic cache for an answer to a question, filtered by role + seniority. Returns a cached answer or null.",
    inputSchema: { question: z.string(), ...seg },
  },
  async (args) => asText(await checkCache(args)),
);

server.registerTool(
  "store_answer",
  {
    title: "Store answer in OrgCache",
    description: "Store a new question/answer in the org cache for a given role + seniority segment.",
    inputSchema: { question: z.string(), answer: z.string(), ...seg },
  },
  async (args) => asText(await storeAnswer(args)),
);

server.registerTool(
  "get_trending",
  {
    title: "Get trending OrgCache FAQs",
    description: "Return the top trending questions for a role + seniority + tenure segment.",
    inputSchema: { ...seg },
  },
  async (args) => asText(await getTrending(args)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logs; stdout is reserved for the MCP protocol.
console.error(`[orgcache-mcp] connected. backend=${ORGCACHE_URL} org=${ORG}`);
