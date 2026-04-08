# Gold Price Sync — Vercel Serverless Function

## Setup Instructions

### 1. Deploy to Vercel
```bash
npm install -g vercel
vercel
vercel env add SHOPIFY_TOKEN
vercel --prod
```

### 2. Add to Shopify Theme
Paste the cart intercept script in main-product.liquid
Replace VERCEL_URL with your actual Vercel deployment URL.

### Formula Used
Gold Value     = Weight (g) × Gold Rate (per gram)
Making Charges = Making % × Gold Value
GST (3%)       = 3% × (Gold Value + Making Charges)
Final Price    = Gold Value + Making Charges + GST
