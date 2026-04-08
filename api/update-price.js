const axios = require("axios");

const SHOPIFY_STORE = "keniwear.myshopify.com";
const GST_PCT = 3;

const PURITY_KEYS = {
  "9K":  "gold_rate_9k",
  "14K": "gold_rate_14k",
  "18K": "gold_rate_18k",
  "22K": "gold_rate_22k",
  "24K": "gold_rate_24k"
};

module.exports = async (req, res) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const SHOPIFY_TOKEN = process.env.SHOPIFY_TOKEN;

  if (!SHOPIFY_TOKEN) {
    return res.status(500).json({ error: "Shopify token not configured" });
  }

  const headers = {
    "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    "Content-Type": "application/json"
  };

  try {
    const { variantId, productId } = req.body;

    if (!variantId || !productId) {
      return res.status(400).json({ error: "variantId and productId are required" });
    }

    // 1. Get shop metafields (gold rates)
    const shopRes = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/metafields.json?namespace=custom`,
      { headers }
    );
    const rates = {};
    for (const mf of shopRes.data.metafields) {
      rates[mf.key] = parseFloat(mf.value) || 0;
    }

    // 2. Get product metafields (weight + making %)
    const prodRes = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/products/${productId}/metafields.json?namespace=custom`,
      { headers }
    );
    const productMeta = {};
    for (const mf of prodRes.data.metafields) {
      productMeta[mf.key] = parseFloat(mf.value) || 0;
    }

    const weight    = productMeta["gold_weight"]    || 0;
    const makingPct = productMeta["making_percent"] || 0;

    if (!weight || !makingPct) {
      return res.status(400).json({ error: "Product gold_weight or making_percent metafield is missing" });
    }

    // 3. Get variant title to determine purity
    const variantRes = await axios.get(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/variants/${variantId}.json`,
      { headers }
    );
    const variantTitle = variantRes.data.variant.title;

    // 4. Match purity and get gold rate
    let goldRate = 0;
    for (const [purity, key] of Object.entries(PURITY_KEYS)) {
      if (variantTitle.includes(purity)) {
        goldRate = rates[key] || 0;
        break;
      }
    }

    if (!goldRate) {
      return res.status(400).json({
        error: `Gold rate not found for purity: ${variantTitle}. Please update shop metafields.`
      });
    }

    // 5. Calculate final price using formula
    // Gold Value = Weight × Gold Rate
    // Making Charges = Making % × Gold Value
    // GST = 3% × (Gold Value + Making Charges)
    // Final Price = Gold Value + Making Charges + GST
    const goldValue  = weight * goldRate;
    const making     = (makingPct / 100) * goldValue;
    const gst        = (GST_PCT / 100) * (goldValue + making);
    const finalPrice = goldValue + making + gst;

    // 6. Update variant price in Shopify
    await axios.put(
      `https://${SHOPIFY_STORE}/admin/api/2024-01/variants/${variantId}.json`,
      { variant: { id: variantId, price: finalPrice.toFixed(2) } },
      { headers }
    );

    console.log(`✅ Updated: ${variantTitle} → ₹${finalPrice.toFixed(2)}`);

    return res.status(200).json({
      success: true,
      variant: variantTitle,
      price: finalPrice.toFixed(2),
      breakdown: {
        weight,
        goldRate,
        goldValue:  goldValue.toFixed(2),
        making:     making.toFixed(2),
        gst:        gst.toFixed(2),
        final:      finalPrice.toFixed(2)
      }
    });

  } catch (err) {
    console.error("Error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
