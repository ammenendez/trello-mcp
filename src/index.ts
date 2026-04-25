#!/usr/bin/env node
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const TRELLO_API_BASE = "https://api.trello.com/1";

type TrelloPrimitive = string | number | boolean;
type TrelloParams = Record<string, TrelloPrimitive | undefined>;

type Priority = "P1" | "P2" | "P3";
type ProductLevel = "alto" | "medio" | "baixo";
type UrgencyLevel = "alta" | "media" | "baixa";
type ProductType = "feature" | "bug" | "refactor" | "ux" | "infra";

type TrelloLabel = {
  id: string;
  name: string;
  color: string | null;
};

type TrelloList = {
  id: string;
  name: string;
  closed: boolean;
  pos: number;
};

type TrelloCard = {
  id: string;
  name: string;
  desc?: string;
  url?: string;
  closed?: boolean;
  idBoard?: string;
  idList?: string;
  idLabels?: string[];
  labels?: TrelloLabel[];
};

type ProductMetadata = {
  modulo: string;
  tipo: ProductType;
  impacto: ProductLevel;
  esforco: ProductLevel;
  urgencia: UrgencyLevel;
  prioridade: Priority;
  score: number;
  reasons: string[];
};

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
const levelSchema = z.enum(["alto", "medio", "baixo"]);
const urgencySchema = z.enum(["alta", "media", "baixa"]);
const productTypeSchema = z.enum(["feature", "bug", "refactor", "ux", "infra"]);

const PRODUCT_LABEL_COLORS: Record<string, string> = {
  modulo: "blue",
  tipo: "purple",
  impacto: "red",
  esforco: "orange",
  urgencia: "yellow",
  prioridade: "green",
};

function normalizeText(value: string | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => {
    const normalizedTerm = normalizeText(term);
    const pattern = new RegExp(
      `(^|[^a-z0-9])${escapeRegExp(normalizedTerm)}([^a-z0-9]|$)`,
    );
    return pattern.test(text);
  });
}

function levelScore(level: ProductLevel | UrgencyLevel) {
  switch (level) {
    case "alto":
    case "alta":
      return 3;
    case "medio":
    case "media":
      return 2;
    case "baixo":
    case "baixa":
      return 1;
  }
}

function priorityFromScore(score: number): Priority {
  if (score >= 5) {
    return "P1";
  }

  if (score >= 3) {
    return "P2";
  }

  return "P3";
}

function calculateProductPriority(
  impacto: ProductLevel,
  esforco: ProductLevel,
  urgencia: UrgencyLevel,
): { prioridade: Priority; score: number } {
  const score = levelScore(impacto) + levelScore(urgencia) - levelScore(esforco);
  return {
    prioridade: priorityFromScore(score),
    score,
  };
}

function moduleFromText(text: string) {
  if (includesAny(text, ["financeiro", "pagamento", "cobranca", "assinatura", "plano", "receita", "fatura", "asaas"])) {
    return "financeiro";
  }
  if (includesAny(text, ["whatsapp", "mensagem", "notificacao externa"])) {
    return "whatsapp";
  }
  if (includesAny(text, ["ia", "inteligencia artificial", "modelo", "recomendacao"])) {
    return "ia";
  }
  if (includesAny(text, ["treino", "corrida", "pace", "distancia", "atividade", "ciclo base"])) {
    return "treinos";
  }
  if (includesAny(text, ["atleta", "corredor", "participa", "perfil", "cadastro"])) {
    return "atletas";
  }
  if (includesAny(text, ["clube", "membro", "lider", "organiza", "ingressar"])) {
    return "clubes";
  }
  if (includesAny(text, ["relatorio", "dashboard", "metrica", "burndown"])) {
    return "relatorios";
  }
  if (includesAny(text, ["evento", "calendario"])) {
    return "eventos";
  }
  if (includesAny(text, ["infra", "deploy", "ci", "banco", "database", "backend", "api", "servidor"])) {
    return "infra";
  }

  return "geral";
}

function classifyModule(text: string, manualContext: string) {
  const moduleFromCard = moduleFromText(text);
  return moduleFromCard === "geral" ? moduleFromText(manualContext) : moduleFromCard;
}

function classifyProductType(text: string): ProductType {
  if (includesAny(text, ["bug", "erro", "falha", "corrigir", "crash", "quebrado"])) {
    return "bug";
  }
  if (includesAny(text, ["refactor", "refator", "debito tecnico", "limpeza"])) {
    return "refactor";
  }
  if (includesAny(text, ["ux", "layout", "tela", "interface", "experiencia"])) {
    return "ux";
  }
  if (includesAny(text, ["infra", "deploy", "ci", "banco", "database", "servidor"])) {
    return "infra";
  }

  return "feature";
}

function classifyCardMetadata(
  card: Pick<TrelloCard, "name" | "desc">,
  manualContext = "",
): ProductMetadata {
  const text = normalizeText(`${card.name} ${card.desc ?? ""}`);
  const context = normalizeText(manualContext);
  const combined = `${text} ${context}`;
  const reasons: string[] = [];
  let modulo = classifyModule(text, context);
  let tipo = classifyProductType(text);
  let impacto: ProductLevel = "medio";
  let esforco: ProductLevel = "medio";
  let urgencia: UrgencyLevel = "media";
  const isInformational = includesAny(text, [
    "o que e",
    "dicas de uso",
    "como usar",
    "template",
  ]);

  if (isInformational) {
    modulo = "processo";
    tipo = "ux";
    impacto = "baixo";
    esforco = "baixo";
    urgencia = "baixa";
    reasons.push("card parece informativo ou de apoio ao processo");
  }

  if (tipo === "bug") {
    impacto = "alto";
    urgencia = includesAny(combined, ["critico", "producao", "bloqueia", "crash"]) ? "alta" : "media";
    reasons.push("bugs recebem impacto alto, com urgencia ajustada pelo risco operacional");
  }

  if (includesAny(text, ["critico", "criticos", "bloqueia", "bloqueador", "fluxo incompleto", "nao funciona"])) {
    impacto = "alto";
    urgencia = "alta";
    reasons.push("o card indica bloqueio ou fluxo incompleto");
  }

  if (includesAny(combined, ["cadastro", "criar clube", "registro", "pagamento", "assinatura", "ingressar", "login"])) {
    impacto = "alto";
    urgencia = "alta";
    reasons.push("fecha ou destrava um fluxo principal do usuario");
  }

  if (includesAny(combined, ["backend pronto", "sem frontend", "frontend pendente"])) {
    urgencia = "alta";
    reasons.push("ha indicio de backend pronto sem fechamento no frontend");
  }

  if (tipo === "refactor") {
    esforco = "medio";
    urgencia = includesAny(text, ["desbloqueia", "bloqueia", "necessario para"]) ? "media" : "baixa";
    reasons.push("refactor so sobe prioridade quando desbloqueia entrega");
  }

  if (modulo === "whatsapp" || includesAny(combined, ["integracao futura", "futuro", "postergar integracoes", "postergar whatsapp"])) {
    urgencia = "baixa";
    reasons.push("integracoes futuras ficam com baixa urgencia inicial");
  }

  if (includesAny(combined, ["simples", "texto", "dicas", "documentacao", "burndown", "o que e"])) {
    esforco = "baixo";
    reasons.push("escopo aparenta ser pequeno ou informativo");
  }

  if (includesAny(combined, ["integracao", "arquitetura", "migracao", "pagamento", "financeiro", "permissao", "seguranca"])) {
    esforco = "alto";
    reasons.push("envolve integracao, arquitetura ou dominio sensivel");
  }

  if (includesAny(context, [`focar ${modulo}`, `priorizar ${modulo}`, modulo])) {
    urgencia = "alta";
    reasons.push(`contexto manual prioriza o modulo ${modulo}`);
  }

  if (includesAny(context, ["evitar refactor", "evitar refactors"]) && tipo === "refactor") {
    urgencia = "baixa";
    reasons.push("contexto manual pede para evitar refactors nao criticos");
  }

  if (isInformational) {
    impacto = "baixo";
    esforco = "baixo";
    urgencia = "baixa";
  }

  const calculated = calculateProductPriority(impacto, esforco, urgencia);
  let prioridade = calculated.prioridade;
  let score = calculated.score;

  if (tipo === "bug" && urgencia === "alta") {
    prioridade = "P1";
    score = Math.max(score, 5);
    reasons.push("bug critico sempre entra como prioridade maxima");
  }

  if (reasons.length === 0) {
    reasons.push("classificacao baseada em modulo, tipo e complexidade inferidos pelo titulo e descricao");
  }

  return {
    modulo,
    tipo,
    impacto,
    esforco,
    urgencia,
    prioridade,
    score,
    reasons,
  };
}

function metadataLabels(metadata: ProductMetadata) {
  return [
    `modulo:${metadata.modulo}`,
    `tipo:${metadata.tipo}`,
    `impacto:${metadata.impacto}`,
    `esforco:${metadata.esforco}`,
    `urgencia:${metadata.urgencia}`,
    `prioridade:${metadata.prioridade}`,
  ];
}

function metadataComment(card: TrelloCard, metadata: ProductMetadata) {
  return [
    `Classificacao automatica do MCP para "${card.name}".`,
    "",
    `- Modulo: ${metadata.modulo}`,
    `- Tipo: ${metadata.tipo}`,
    `- Impacto: ${metadata.impacto}`,
    `- Esforco: ${metadata.esforco}`,
    `- Urgencia: ${metadata.urgencia}`,
    `- Prioridade: ${metadata.prioridade} (score ${metadata.score})`,
    "",
    `Justificativa: ${metadata.reasons.join("; ")}.`,
  ].join("\n");
}

function labelColor(labelName: string) {
  const prefix = labelName.split(":")[0] ?? "";
  return PRODUCT_LABEL_COLORS[prefix] ?? "blue";
}

async function getBoardLabels(boardId: string) {
  return trelloRequest<TrelloLabel[]>(
    "GET",
    `/boards/${encodeURIComponent(boardId)}/labels`,
    {
      fields: "name,color",
      limit: 1000,
    },
  );
}

async function ensureBoardLabels(boardId: string, labelNames: string[]) {
  const existingLabels = await getBoardLabels(boardId);
  const labelsByName = new Map(
    existingLabels.map((label) => [normalizeText(label.name), label]),
  );
  const ensuredLabels: TrelloLabel[] = [];

  for (const labelName of labelNames) {
    const normalizedName = normalizeText(labelName);
    const existingLabel = labelsByName.get(normalizedName);

    if (existingLabel) {
      ensuredLabels.push(existingLabel);
      continue;
    }

    const createdLabel = await trelloRequest<TrelloLabel>("POST", "/labels", {
      idBoard: boardId,
      name: labelName,
      color: labelColor(labelName),
    });
    labelsByName.set(normalizedName, createdLabel);
    ensuredLabels.push(createdLabel);
  }

  return ensuredLabels;
}

async function addLabelsToCard(card: TrelloCard, labels: TrelloLabel[]) {
  const existingLabelIds = new Set([
    ...(card.idLabels ?? []),
    ...(card.labels ?? []).map((label) => label.id),
  ]);
  const addedLabels: TrelloLabel[] = [];

  for (const label of labels) {
    if (existingLabelIds.has(label.id)) {
      continue;
    }

    await trelloRequest("POST", `/cards/${encodeURIComponent(card.id)}/idLabels`, {
      value: label.id,
    });
    existingLabelIds.add(label.id);
    addedLabels.push(label);
  }

  return addedLabels;
}

async function getCardForProduct(cardId: string) {
  return trelloRequest<TrelloCard>("GET", `/cards/${encodeURIComponent(cardId)}`, {
    fields: "name,desc,url,closed,idBoard,idList,idLabels,labels",
  });
}

async function enrichCardMetadata({
  card,
  boardId,
  manualContext,
  addComment,
  dryRun,
}: {
  card: TrelloCard;
  boardId?: string;
  manualContext?: string;
  addComment: boolean;
  dryRun: boolean;
}) {
  const resolvedBoardId = resolveBoardId(boardId ?? card.idBoard);
  const metadata = classifyCardMetadata(card, manualContext);
  const labels = metadataLabels(metadata);
  const comment = metadataComment(card, metadata);

  if (dryRun) {
    return {
      card: {
        id: card.id,
        name: card.name,
        url: card.url,
      },
      metadata,
      labels,
      comment,
      dryRun: true,
    };
  }

  const ensuredLabels = await ensureBoardLabels(resolvedBoardId, labels);
  const addedLabels = await addLabelsToCard(card, ensuredLabels);

  if (addComment) {
    await trelloRequest("POST", `/cards/${encodeURIComponent(card.id)}/actions/comments`, {
      text: comment,
    });
  }

  return {
    card: {
      id: card.id,
      name: card.name,
      url: card.url,
    },
    metadata,
    labels,
    addedLabels: addedLabels.map((label) => label.name),
    commentAdded: addComment,
    dryRun: false,
  };
}

function defaultSprintName(sprintNumber?: number, startDate?: string, endDate?: string) {
  const numberPart = sprintNumber === undefined ? "XX" : String(sprintNumber).padStart(2, "0");
  const start = startDate ?? "data_inicio";
  const end = endDate ?? "data_fim";
  return `Sprint ${numberPart} - ${start} a ${end}`;
}

function priorityRank(priority: Priority) {
  switch (priority) {
    case "P1":
      return 3;
    case "P2":
      return 2;
    case "P3":
      return 1;
  }
}

function listNameMatches(listName: string, matchers: string[]) {
  const normalizedListName = normalizeText(listName);
  return matchers.some((matcher) => normalizedListName.includes(normalizeText(matcher)));
}

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

server.tool(
  "calculate_priority",
  "Calculate product priority from impact, effort, and urgency.",
  {
    impacto: levelSchema,
    esforco: levelSchema,
    urgencia: urgencySchema,
    tipo: productTypeSchema.optional(),
  },
  async ({ impacto, esforco, urgencia, tipo }) =>
    runTool(async () => {
      const calculated = calculateProductPriority(impacto, esforco, urgencia);
      const prioridade =
        tipo === "bug" && urgencia === "alta" ? "P1" : calculated.prioridade;

      return {
        impacto,
        esforco,
        urgencia,
        tipo,
        score: tipo === "bug" && urgencia === "alta"
          ? Math.max(calculated.score, 5)
          : calculated.score,
        prioridade,
      };
    }),
);

server.tool(
  "enrich_card_metadata",
  "Classify an existing Trello card and add product labels plus a comment.",
  {
    cardId: idSchema,
    boardId: idSchema.optional(),
    manualContext: z.string().default(""),
    addComment: z.boolean().default(true),
    dryRun: z.boolean().default(false),
  },
  async ({ cardId, boardId, manualContext, addComment, dryRun }) =>
    runTool(async () => {
      const card = await getCardForProduct(cardId);

      return enrichCardMetadata({
        card,
        boardId,
        manualContext,
        addComment,
        dryRun,
      });
    }),
);

server.tool(
  "build_sprint",
  "Suggest or build the next sprint from Trello backlog cards.",
  {
    boardId: idSchema.optional(),
    sourceListIds: z.array(idSchema).optional(),
    sourceListNames: z.array(z.string().min(1)).default(["backlog"]),
    sprintListName: z.string().min(1).optional(),
    sprintNumber: z.number().int().positive().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    maxCards: z.number().int().positive().max(50).default(10),
    maxEffortScore: z.number().int().positive().optional(),
    manualContext: z.string().default(""),
    enrichCards: z.boolean().default(true),
    addComment: z.boolean().default(true),
    dryRun: z.boolean().default(true),
  },
  async ({
    boardId,
    sourceListIds,
    sourceListNames,
    sprintListName,
    sprintNumber,
    startDate,
    endDate,
    maxCards,
    maxEffortScore,
    manualContext,
    enrichCards,
    addComment,
    dryRun,
  }) =>
    runTool(async () => {
      const resolvedBoardId = resolveBoardId(boardId);
      const lists = await trelloRequest<TrelloList[]>(
        "GET",
        `/boards/${encodeURIComponent(resolvedBoardId)}/lists`,
        {
          filter: "open",
          fields: "name,closed,pos",
        },
      );
      const listById = new Map(lists.map((list) => [list.id, list]));
      const requestedSourceIds = new Set(sourceListIds ?? []);
      let sourceLists = sourceListIds?.length
        ? lists.filter((list) => requestedSourceIds.has(list.id))
        : lists.filter((list) => listNameMatches(list.name, sourceListNames));

      if (sourceLists.length === 0 && !sourceListIds?.length) {
        sourceLists = lists.filter(
          (list) =>
            !listNameMatches(list.name, [
              "feito",
              "done",
              "concluido",
              "sprint ",
              "em andamento",
            ]),
        );
      }

      if (sourceLists.length === 0) {
        throw new TrelloError("No source lists found for sprint planning.");
      }

      const sourceIds = new Set(sourceLists.map((list) => list.id));
      const cards = await trelloRequest<TrelloCard[]>(
        "GET",
        `/boards/${encodeURIComponent(resolvedBoardId)}/cards`,
        {
          filter: "open",
          fields: "name,desc,url,closed,idBoard,idList,idLabels,labels",
        },
      );
      const candidates = cards
        .filter((card) => card.idList && sourceIds.has(card.idList))
        .map((card, index) => {
          const metadata = classifyCardMetadata(card, manualContext);
          return {
            card,
            metadata,
            sourceList: card.idList ? listById.get(card.idList)?.name : undefined,
            originalIndex: index,
          };
        })
        .sort((left, right) => {
          const priorityDelta =
            priorityRank(right.metadata.prioridade) -
            priorityRank(left.metadata.prioridade);
          if (priorityDelta !== 0) {
            return priorityDelta;
          }

          const scoreDelta = right.metadata.score - left.metadata.score;
          if (scoreDelta !== 0) {
            return scoreDelta;
          }

          const impactDelta =
            levelScore(right.metadata.impacto) - levelScore(left.metadata.impacto);
          if (impactDelta !== 0) {
            return impactDelta;
          }

          const effortDelta =
            levelScore(left.metadata.esforco) - levelScore(right.metadata.esforco);
          if (effortDelta !== 0) {
            return effortDelta;
          }

          return left.originalIndex - right.originalIndex;
        });

      const selected: typeof candidates = [];
      let effortTotal = 0;

      for (const candidate of candidates) {
        const nextEffortTotal = effortTotal + levelScore(candidate.metadata.esforco);
        if (selected.length >= maxCards) {
          break;
        }
        if (maxEffortScore !== undefined && nextEffortTotal > maxEffortScore) {
          continue;
        }

        selected.push(candidate);
        effortTotal = nextEffortTotal;
      }

      const targetListName =
        sprintListName ?? defaultSprintName(sprintNumber, startDate, endDate);

      if (dryRun) {
        return {
          dryRun: true,
          boardId: resolvedBoardId,
          targetListName,
          sourceLists: sourceLists.map((list) => ({ id: list.id, name: list.name })),
          selectedCards: selected.map(({ card, metadata, sourceList }) => ({
            id: card.id,
            name: card.name,
            url: card.url,
            sourceList,
            metadata,
            labels: metadataLabels(metadata),
          })),
          totals: {
            candidates: candidates.length,
            selected: selected.length,
            effortScore: effortTotal,
          },
        };
      }

      let targetList = lists.find(
        (list) => normalizeText(list.name) === normalizeText(targetListName),
      );

      if (!targetList) {
        targetList = await trelloRequest<TrelloList>("POST", "/lists", {
          idBoard: resolvedBoardId,
          name: targetListName,
          pos: "top",
        });
      }

      const updatedCards = [];
      for (const { card, metadata, sourceList } of selected) {
        const enrichment = enrichCards
          ? await enrichCardMetadata({
              card,
              boardId: resolvedBoardId,
              manualContext,
              addComment,
              dryRun: false,
            })
          : undefined;
        await trelloRequest("PUT", `/cards/${encodeURIComponent(card.id)}`, {
          idList: targetList.id,
        });
        updatedCards.push({
          id: card.id,
          name: card.name,
          url: card.url,
          sourceList,
          targetList: targetList.name,
          metadata,
          enrichment,
        });
      }

      return {
        dryRun: false,
        boardId: resolvedBoardId,
        targetList: {
          id: targetList.id,
          name: targetList.name,
        },
        sourceLists: sourceLists.map((list) => ({ id: list.id, name: list.name })),
        movedCards: updatedCards,
        totals: {
          candidates: candidates.length,
          moved: updatedCards.length,
          effortScore: effortTotal,
        },
      };
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
