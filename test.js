#!/usr/bin/env node

/**
 * Quick script to test Agmarknet Vistaar API responses.
 *
 * Usage:
 *   node test.js --token <TOKEN> --statecode DL --commoditycode 60 --districtcodes 414,415
 *
 * Optional:
 *   --from_date DD-MM-YYYY
 *   --to_date DD-MM-YYYY
 *
 * Environment fallback:
 *   MANDI_TOKEN, MANDI_STATECODE, MANDI_COMMODITYCODE, MANDI_DISTRICTCODES
 */

const BASE_URL = "https://api.agmarknet.gov.in/v1/fetch-agmarknet-vistaar";

function pad2(v) {
  return String(v).padStart(2, "0");
}

function formatDate(date) {
  return `${pad2(date.getDate())}-${pad2(date.getMonth() + 1)}-${date.getFullYear()}`;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "true";
    args[key] = value;
  }
  return args;
}

function firstDefined(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v);
  }
  return undefined;
}

function getConfig() {
  const args = parseArgs(process.argv);
  const now = new Date();
  const past = new Date();
  past.setDate(now.getDate() - 30);

  const token = firstDefined(args.token, process.env.MANDI_TOKEN);
  const statecode = firstDefined(args.statecode, process.env.MANDI_STATECODE, "DL");
  const commoditycode = firstDefined(args.commoditycode, process.env.MANDI_COMMODITYCODE, "60");
  const districtcodesRaw = firstDefined(args.districtcodes, process.env.MANDI_DISTRICTCODES, "414");
  const from_date = firstDefined(args.from_date, formatDate(past));
  const to_date = firstDefined(args.to_date, formatDate(now));

  if (!token) {
    throw new Error(
      "Missing token. Pass --token <TOKEN> or set MANDI_TOKEN in your environment."
    );
  }

  const districtcodes = districtcodesRaw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return { token, statecode, commoditycode, districtcodes, from_date, to_date };
}

function buildUrl(config, districtcode) {
  const query = new URLSearchParams({
    token: config.token,
    statecode: config.statecode,
    from_date: config.from_date,
    to_date: config.to_date,
    commoditycode: config.commoditycode,
    districtcode
  });
  return `${BASE_URL}?${query.toString()}`;
}

function parseItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.data)) return payload.data;
  if (payload && Array.isArray(payload.result)) return payload.result;
  if (payload && Array.isArray(payload.records)) return payload.records;
  return [];
}

async function fetchAndPrint(config, districtcode) {
  const url = buildUrl(config, districtcode);
  console.log(`\n[REQUEST] district=${districtcode}`);
  console.log(url);

  try {
    const res = await fetch(url);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }

    console.log(`[RESPONSE] district=${districtcode} status=${res.status} ok=${res.ok}`);

    if (typeof json === "string") {
      console.log(`[BODY:TEXT] ${json.slice(0, 1000)}`);
      return;
    }

    const items = parseItems(json);
    console.log(`[BODY] total_items=${items.length}`);
    if (items.length > 0) {
      console.log("[SAMPLE ITEM]");
      console.log(JSON.stringify(items[0], null, 2));
    } else {
      console.log(JSON.stringify(json, null, 2).slice(0, 2000));
    }
  } catch (err) {
    console.error(`[ERROR] district=${districtcode}`, err.message || err);
  }
}

async function main() {
  const config = getConfig();
  console.log("Testing API with config:");
  console.log(
    JSON.stringify(
      {
        statecode: config.statecode,
        commoditycode: config.commoditycode,
        from_date: config.from_date,
        to_date: config.to_date,
        districtcodes: config.districtcodes
      },
      null,
      2
    )
  );

  for (const districtcode of config.districtcodes) {
    // Sequential calls keep logs easy to read and avoid rate-limit bursts.
    await fetchAndPrint(config, districtcode);
  }
}

main().catch((err) => {
  console.error("[FATAL]", err.message || err);
  process.exit(1);
});
