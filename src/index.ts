#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TRELLO_API_BASE = "https://api.trello.com/1";

type TrelloPrimitive = string | number | boolean;
type TrelloParams = Record<string, TrelloPrimitive | undefined>;

class TrelloError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: string,
  ) {
    super(message);
    this.name = "TrelloError";
  }
}

function getCredentials() {
  const key = process.env.TRELLO_API_KEY;
  const token = process.env.TRELLO_TOKEN;

  if (!key || !token) {
    throw new TrelloError(
      "Missing Trello credentials. Set TRELLO_API_KEY and TRELLO_TOKEN.",
    );
  }

  return { key, token };
}

function resolveBoardId(boardId?: string) {
  const resolvedBoardId = boardId || process.env.TRELLO_DEFAULT_BOARD_ID;

  if (!resolvedBoardId) {
    throw new TrelloError(
      "Provide boardId or set TRELLO_DEFAULT_BOARD_ID in the project environment.",
    );
  }

  return resolvedBoardId;
}

function compactJson(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function toolText(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : compactJson(value),
      },
    ],
  };
}

function appendParams(url: URL, params: TrelloParams = {}) {
  const { key, token } = getCredentials();
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);

  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value));
    }
  }
}

async function trelloRequest<T>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params?: TrelloParams,
): Promise<T> {
  const url = new URL(`${TRELLO_API_BASE}${path}`);
  appendParams(url, params);

  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
    },
  });

  const responseText = await response.text();

  if (!response.ok) {
    throw new TrelloError(
      `Trello request failed: ${method} ${path}`,
      response.status,
      responseText,
    );
  }

  if (!responseText) {
    return undefined as T;
  }

  try {
    return JSON.parse(responseText) as T;
  } catch {
    return responseText as T;
  }
}

async function runTool<T>(operation: () => Promise<T>) {
  try {
    return toolText(await operation());
  } catch (error) {
    if (error instanceof TrelloError) {
      return toolText({
        error: error.message,
        status: error.status,
        details: error.details,
      });
    }

    return toolText({
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

const idSchema = z.string().min(1);
const posSchema = z.union([z.string().min(1), z.number()]).optional();

const server = new McpServer({
  name: "trello-mcp",
  version: "0.1.0",
});

server.tool(
  "trello_list_boards",
  "List Trello boards visible to the authenticated member.",
  {
    filter: z
      .enum(["all", "closed", "members", "open", "organization", "public", "starred"])
      .default("open"),
    fields: z.string().default("name,url,closed,desc,dateLastActivity,starred"),
  },
  async ({ filter, fields }) =>
    runTool(() =>
      trelloRequest("GET", "/members/me/boards", {
        filter,
        fields,
      }),
    ),
);

server.tool(
  "trello_get_board",
  "Get one Trello board with optional related lists, cards, labels, and members.",
  {
    boardId: idSchema.optional(),
    fields: z.string().default("name,desc,url,closed,dateLastActivity,labelNames"),
    lists: z.enum(["all", "closed", "none", "open"]).default("open"),
    cards: z.enum(["all", "closed", "none", "open", "visible"]).default("open"),
    labels: z.enum(["all", "none"]).default("all"),
    members: z.enum(["all", "none"]).default("none"),
  },
  async ({ boardId, fields, lists, cards, labels, members }) =>
    runTool(() => {
      const resolvedBoardId = resolveBoardId(boardId);

      return trelloRequest("GET", `/boards/${encodeURIComponent(resolvedBoardId)}`, {
        fields,
        lists,
        cards,
        labels,
        members,
      });
    }),
);

server.tool(
  "trello_list_lists",
  "List Trello lists on a board.",
  {
    boardId: idSchema.optional(),
    filter: z.enum(["all", "closed", "none", "open"]).default("open"),
    fields: z.string().default("name,closed,pos,idBoard"),
  },
  async ({ boardId, filter, fields }) =>
    runTool(() => {
      const resolvedBoardId = resolveBoardId(boardId);

      return trelloRequest("GET", `/boards/${encodeURIComponent(resolvedBoardId)}/lists`, {
        filter,
        fields,
      });
    }),
);

server.tool(
  "trello_create_list",
  "Create a new list on a Trello board.",
  {
    boardId: idSchema.optional(),
    name: z.string().min(1),
    pos: posSchema,
  },
  async ({ boardId, name, pos }) =>
    runTool(() => {
      const resolvedBoardId = resolveBoardId(boardId);

      return trelloRequest("POST", "/lists", {
        idBoard: resolvedBoardId,
        name,
        pos,
      });
    }),
);

server.tool(
  "trello_list_cards",
  "List Trello cards from either a board or a list.",
  {
    boardId: idSchema.optional(),
    listId: idSchema.optional(),
    filter: z.enum(["all", "closed", "none", "open", "visible"]).default("open"),
    fields: z
      .string()
      .default("name,desc,url,closed,due,dueComplete,idBoard,idList,idMembers,labels"),
  },
  async ({ boardId, listId, filter, fields }) =>
    runTool(async () => {
      if (boardId && listId) {
        throw new TrelloError("Provide only one of boardId or listId.");
      }

      const resolvedBoardId = listId ? undefined : resolveBoardId(boardId);
      const path = resolvedBoardId
        ? `/boards/${encodeURIComponent(resolvedBoardId)}/cards`
        : `/lists/${encodeURIComponent(listId!)}/cards`;

      return trelloRequest("GET", path, {
        filter,
        fields,
      });
    }),
);

server.tool(
  "trello_get_card",
  "Get one Trello card.",
  {
    cardId: idSchema,
    fields: z
      .string()
      .default("name,desc,url,closed,due,dueComplete,idBoard,idList,idMembers,labels"),
    actions: z.string().optional(),
    checklists: z.enum(["all", "none"]).default("none"),
  },
  async ({ cardId, fields, actions, checklists }) =>
    runTool(() =>
      trelloRequest("GET", `/cards/${encodeURIComponent(cardId)}`, {
        fields,
        actions,
        checklists,
      }),
    ),
);

server.tool(
  "trello_create_card",
  "Create a Trello card in a list.",
  {
    listId: idSchema,
    name: z.string().min(1),
    desc: z.string().optional(),
    due: z.string().datetime().optional(),
    pos: posSchema,
    idMembers: z.array(idSchema).optional(),
    idLabels: z.array(idSchema).optional(),
  },
  async ({ listId, name, desc, due, pos, idMembers, idLabels }) =>
    runTool(() =>
      trelloRequest("POST", "/cards", {
        idList: listId,
        name,
        desc,
        due,
        pos,
        idMembers: idMembers?.join(","),
        idLabels: idLabels?.join(","),
      }),
    ),
);

server.tool(
  "trello_update_card",
  "Update common Trello card fields.",
  {
    cardId: idSchema,
    name: z.string().min(1).optional(),
    desc: z.string().optional(),
    listId: idSchema.optional(),
    due: z.string().datetime().nullable().optional(),
    dueComplete: z.boolean().optional(),
    closed: z.boolean().optional(),
  },
  async ({ cardId, name, desc, listId, due, dueComplete, closed }) =>
    runTool(() =>
      trelloRequest("PUT", `/cards/${encodeURIComponent(cardId)}`, {
        name,
        desc,
        idList: listId,
        due: due === null ? "null" : due,
        dueComplete,
        closed,
      }),
    ),
);

server.tool(
  "trello_move_card",
  "Move a Trello card to another list.",
  {
    cardId: idSchema,
    listId: idSchema,
    pos: posSchema,
  },
  async ({ cardId, listId, pos }) =>
    runTool(() =>
      trelloRequest("PUT", `/cards/${encodeURIComponent(cardId)}`, {
        idList: listId,
        pos,
      }),
    ),
);

server.tool(
  "trello_add_comment",
  "Add a comment to a Trello card.",
  {
    cardId: idSchema,
    text: z.string().min(1),
  },
  async ({ cardId, text }) =>
    runTool(() =>
      trelloRequest("POST", `/cards/${encodeURIComponent(cardId)}/actions/comments`, {
        text,
      }),
    ),
);

server.tool(
  "trello_archive_card",
  "Archive or unarchive a Trello card.",
  {
    cardId: idSchema,
    archived: z.boolean().default(true),
  },
  async ({ cardId, archived }) =>
    runTool(() =>
      trelloRequest("PUT", `/cards/${encodeURIComponent(cardId)}`, {
        closed: archived,
      }),
    ),
);

const transport = new StdioServerTransport();
await server.connect(transport);
