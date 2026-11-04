#!/usr/bin/env node
// Creates or updates the two RunPod Serverless endpoints at the cheapest settings that work:
//   aesyr-blender-cpu  CPU  cpu3c-2-4 (2 vCPU / 4 GB)   0 → 3 workers
//   aesyr-unimate      GPU  16 GB tier first (A4000 / RTX 2000 Ada / RTX 4000 Ada / A4500), then the
//                           24 GB tier (RTX 3090 / L4 / A5000) when 16 GB is out of stock; 0 → 2 workers
// Both scale to zero (workersMin 0, idle 5 s, FlashBoot on): nothing is billed while idle.
//
//   node scripts/runpod-deploy.mjs --blender-image ghcr.io/<owner>/aesyr-blender-worker:<tag> \
//                                  --unimate-image ghcr.io/<owner>/aesyr-unimate-worker:<tag> [--dry-run]
//   Private registry: add --registry-auth <RunPod container registry auth id>.
//   --with-openai-key: let UniMate label rig joints with OpenAI (copies OPENAI_API_KEY to RunPod).
//
// Reads RUNPOD_API_KEY (and OPENAI_API_KEY for UniMate's joint labelling) from .env.local.
// Prints the endpoint ids to put in .env.local. Safe to re-run: existing ones are updated by name.
import { readFileSync } from "node:fs";

const API = "https://rest.runpod.io/v1";
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? true : all[i + 1]]] : acc), []),
);
const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"(.*)"$/, "$1")]),
);
if (!env.RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY missing from .env.local");

const WORKERS = [
  {
    key: "blender",
    image: args["blender-image"],
    template: { name: "aesyr-blender", category: "CPU", containerDiskInGb: 10, env: { RECIPE_TIMEOUT: "600" } },
    endpoint: {
      name: "aesyr-blender-cpu",
      // REST v1 silently ignores computeType "CPU" and makes a GPU endpoint; CPU is pinned
      // afterwards through GraphQL saveEndpoint (instanceIds + empty gpuIds).
      cpuInstance: "cpu3c-2-4",
      workersMin: 0,
      workersMax: 3,
      idleTimeout: 5,
      flashboot: true,
      scalerType: "QUEUE_DELAY",
      scalerValue: 4,
      executionTimeoutMs: 10 * 60_000,
    },
  },
  {
    key: "unimate",
    image: args["unimate-image"],
    template: {
      name: "aesyr-unimate",
      category: "NVIDIA",
      containerDiskInGb: 30,
      // Joint labelling via OpenAI only with --with-openai-key (copies the key into the RunPod
      // template); otherwise UniMate's offline rules label the rig.
      env: { STEP_TIMEOUT: "900", ...(args["with-openai-key"] && env.OPENAI_API_KEY ? { OPENAI_API_KEY: env.OPENAI_API_KEY, UNIMATE_LABEL_MODEL: env.OPENAI_MODEL || "gpt-5-mini" } : {}) },
    },
    endpoint: {
      name: "aesyr-unimate",
      gpuTypeIds: [
        "NVIDIA RTX A4000", "NVIDIA RTX 2000 Ada Generation", "NVIDIA RTX 4000 Ada Generation", "NVIDIA RTX A4500",
        "NVIDIA GeForce RTX 3090", "NVIDIA L4", "NVIDIA RTX A5000",
      ],
      gpuCount: 1,
      // UniMate pins torch 2.5.1 (CUDA 12.4), which has no Blackwell kernels ("no kernel image is
      // available"). RunPod's 24 GB pool includes an RTX PRO 6000 Blackwell MIG slice, so the pools
      // are re-saved through GraphQL with every Blackwell type in them excluded.
      gpuPools: ["AMPERE_16", "AMPERE_24"],
      // The image is CUDA 12.4. Use a minimum, not allowedCudaVersions: an explicit version list
      // left the endpoint with no schedulable worker at all (seen 2026-11-04).
      allowedCudaVersions: [],
      minCudaVersion: "12.4",
      workersMin: 0,
      workersMax: 2,
      idleTimeout: 5,
      flashboot: true,
      scalerType: "QUEUE_DELAY",
      scalerValue: 4,
      executionTimeoutMs: 20 * 60_000,
    },
  },
];

async function call(method, path, body) {
  if (args["dry-run"] && method !== "GET") {
    const shown = JSON.parse(JSON.stringify(body ?? {}), (k, v) => (/KEY$/.test(k) ? "<hidden>" : v));
    console.log(`[dry-run] ${method} ${path}`, JSON.stringify(shown));
    return { id: `dry-${path.split("/")[1]}` };
  }
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : {};
}

async function gql(query, variables) {
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ query, variables }),
  });
  return res.json();
}

async function excludeBlackwell(id, e, pools) {
  let exclude = (await gql("query { gpuTypes { id } }")).data.gpuTypes.map((g) => g.id).filter((t) => /Blackwell|RTX 50d0|B200|B300/.test(t));
  for (let i = 0; i < 30; i++) {
    const input = { id, name: e.name, templateId: e.templateId, gpuIds: [...pools, ...exclude.map((x) => `-${x}`)].join(","), workersMin: e.workersMin, workersMax: e.workersMax, idleTimeout: e.idleTimeout, scalerType: e.scalerType, scalerValue: e.scalerValue };
    if (args["dry-run"]) return console.log("[dry-run] GraphQL saveEndpoint gpuIds", input.gpuIds);
    const r = await gql("mutation($input:EndpointInput!){saveEndpoint(input:$input){id gpuIds}}", { input });
    if (r.data) return console.log(`  ${e.name} GPUs: ${r.data.saveEndpoint.gpuIds}`);
    // Exclusions must belong to a selected pool: drop the one RunPod names and retry.
    const bad = r.errors?.[0]?.message.match(/Invalid exclusion "-(.+?)"/)?.[1];
    if (!bad) throw new Error(`Could not set GPU pools for ${e.name}: ${JSON.stringify(r.errors).slice(0, 300)}`);
    exclude = exclude.filter((x) => x !== bad);
  }
}

async function pinCpu(id, e, instance) {
  const input = { id, name: e.name, templateId: e.templateId, instanceIds: [instance], gpuIds: "", workersMin: e.workersMin, workersMax: e.workersMax, idleTimeout: e.idleTimeout, scalerType: e.scalerType, scalerValue: e.scalerValue };
  if (args["dry-run"]) return console.log("[dry-run] GraphQL saveEndpoint", JSON.stringify(input));
  const res = await fetch("https://api.runpod.io/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${env.RUNPOD_API_KEY}`, "content-type": "application/json", "user-agent": "Mozilla/5.0" },
    body: JSON.stringify({ query: "mutation($input:EndpointInput!){saveEndpoint(input:$input){id computeType instanceIds}}", variables: { input } }),
  });
  const body = await res.json();
  const saved = body.data?.saveEndpoint;
  if (saved?.computeType !== "CPU") throw new Error(`Could not pin ${e.name} to CPU: ${JSON.stringify(body.errors ?? body).slice(0, 300)}`);
}

const templates = await call("GET", "/templates");
const endpoints = await call("GET", "/endpoints");
const out = {};
for (const w of WORKERS) {
  if (!w.image) {
    console.log(`skip ${w.key}: pass --${w.key}-image`);
    continue;
  }
  const t = {
    ...w.template,
    imageName: w.image,
    isServerless: true,
    volumeInGb: 0,
    ports: [],
    ...(args["registry-auth"] ? { containerRegistryAuthId: args["registry-auth"] } : {}),
  };
  const existingT = (templates ?? []).find((x) => x.name === t.name);
  const template = existingT ? await call("PATCH", `/templates/${existingT.id}`, t) : await call("POST", "/templates", t);
  const templateId = existingT?.id ?? template.id;
  const { cpuInstance, gpuPools, ...rest } = w.endpoint;
  const e = { ...rest, templateId };
  const existingE = (endpoints ?? []).find((x) => x.name === e.name || x.name?.startsWith(`${e.name} `));
  const endpoint = existingE ? await call("PATCH", `/endpoints/${existingE.id}`, e) : await call("POST", "/endpoints", e);
  out[w.key] = existingE?.id ?? endpoint.id;
  if (cpuInstance) await pinCpu(out[w.key], e, cpuInstance);
  if (gpuPools) await excludeBlackwell(out[w.key], e, gpuPools);
  console.log(`${existingE ? "updated" : "created"} ${e.name}: endpoint ${out[w.key]} (template ${templateId})`);
}
console.log("\nAdd to .env.local:");
if (out.blender) console.log(`RUNPOD_BLENDER_ENDPOINT_ID=${out.blender}`);
if (out.unimate) console.log(`RUNPOD_UNIMATE_ENDPOINT_ID=${out.unimate}`);
