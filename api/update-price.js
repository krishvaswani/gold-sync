const https = require("https");

const SHOPIFY_STORE = "keniwear.myshopify.com";
const GST_PCT = 3;

const PURITY_KEYS = {
  "9K":  "gold_rate_9k",
  "14K": "gold_rate_14k",
  "18K": "gold_rate_18k",
  "22K": "gold_rate_22k",
  "24K": "gold_rate_24k"
};

function shopifyRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: SHOPIFY_STORE,
      path: `/admin/api/2024-01${path}`,
      method,
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        ...(data && { "Content-Length": Buffer.byteLength(data) })
      }
    };

    const req = https.request(options, (res) => {
      let responseData = "";
      res.on("data", chunk => responseData += chunk);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(responseData) });
        } catch {
          resolve({ status: res.statusCode, data: responseData });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;
  if (!SHOPIFY_TOKEN) return res.status(500).json({ error: "SHOPIFY_TOKEN not set" });

  try {
    const { variantId, productId } = req.body;
    if (!variantId || !productId) {
      return res.status(400).json({ error: "variantId and productId required" });
    }

    // 1. Get shop metafields (gold rates)
    const shopRes = await shopifyRequest("GET", "/metafields.json?namespace=custom", null, SHOPIFY_TOKEN);
    if (shopRes.status !== 200) {
      return res.status(500).json({ error: "Failed to fetch shop metafields", status: shopRes.status });
    }
    const rates = {};
    for (const mf of shopRes.data.metafields) {
      rates[mf.key] = parseFloat(mf.value) || 0;
    }

    // 2. Get product metafields
    const prodRes = await shopifyRequest("GET", `/products/${productId}/metafields.json?namespace=custom`, null, SHOPIFY_TOKEN);
    if (prodRes.status !== 200) {
      return res.status(500).json({ error: "Failed to fetch product metafields", status: prodRes.status });
    }
    const productMeta = {};
    for (const mf of prodRes.data.metafields) {
      productMeta[mf.key] = parseFloat(mf.value) || 0;
    }

    const weight    = productMeta["gold_weight"]    || 0;
    const makingPct = productMeta["making_percent"] || 0;

    if (!weight || !makingPct) {
      return res.status(400).json({ error: "Product metafields missing: gold_weight or making_percent" });
    }

    // 3. Get variant title
    const variantRes = await shopifyRequest("GET", `/variants/${variantId}.json`, null, SHOPIFY_TOKEN);
    if (variantRes.status !== 200) {
      return res.status(500).json({ error: "Failed to fetch variant", status: variantRes.status });
    }
    const variantTitle = variantRes.data.variant.title;

    // 4. Find gold rate for purity
    let goldRate = 0;
    for (const [purity, key] of Object.entries(PURITY_KEYS)) {
      if (variantTitle.toUpperCase().includes(purity)) {
        goldRate = rates[key] || 0;
        break;
      }
    }

    if (!goldRate) {
      return res.status(400).json({ error: `No gold rate found for: ${variantTitle}` });
    }

    // 5. Calculate price
    const goldValue  = weight * goldRate;
    const making     = (makingPct / 100) * goldValue;
    const gst        = (GST_PCT / 100) * (goldValue + making);
    const finalPrice = goldValue + making + gst;

    // 6. Update variant price
    const updateRes = await shopifyRequest(
      "PUT",
      `/variants/${variantId}.json`,
      { variant: { id: parseInt(variantId), price: finalPrice.toFixed(2) } },
      SHOPIFY_TOKEN
    );

    if (updateRes.status !== 200) {
      return res.status(500).json({ error: "Failed to update variant price", status: updateRes.status });
    }

    return res.status(200).json({
      success: true,
      variant: variantTitle,
      price: finalPrice.toFixed(2),
      breakdown: {
        weight, goldRate,
        goldValue:  goldValue.toFixed(2),
        making:     making.toFixed(2),
        gst:        gst.toFixed(2),
        final:      finalPrice.toFixed(2)
      }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};