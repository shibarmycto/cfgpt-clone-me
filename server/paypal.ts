const PAYPAL_API_BASE = process.env.PAYPAL_MODE === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

export interface CreditPackage {
  id: string;
  name: string;
  price: number;
  currency: string;
  credits: number;
  description: string;
  creditsPerDay: number;
  days: number;
}

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "pkg_600",
    name: "Starter Pack",
    price: 10.00,
    currency: "GBP",
    credits: 600,
    description: "20 credits per day for 30 days",
    creditsPerDay: 20,
    days: 30,
  },
  {
    id: "pkg_1500",
    name: "Pro Pack",
    price: 20.00,
    currency: "GBP",
    credits: 1500,
    description: "50 credits per day for 30 days",
    creditsPerDay: 50,
    days: 30,
  },
];

async function getAccessToken(): Promise<string> {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("PayPal credentials not configured");
  }

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const response = await fetch(`${PAYPAL_API_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PayPal auth failed: ${err}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
}

export async function createOrder(packageId: string, returnUrl: string, cancelUrl: string): Promise<{ id: string; approvalUrl: string }> {
  const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
  if (!pkg) {
    throw new Error("Invalid package selected");
  }

  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{
        reference_id: pkg.id,
        description: `${pkg.name} - ${pkg.credits} AI Credits (${pkg.description})`,
        amount: {
          currency_code: pkg.currency,
          value: pkg.price.toFixed(2),
        },
      }],
      application_context: {
        brand_name: "CFGPT Clone Me",
        landing_page: "NO_PREFERENCE",
        user_action: "PAY_NOW",
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PayPal order creation failed: ${err}`);
  }

  const order = await response.json() as {
    id: string;
    links: Array<{ rel: string; href: string }>;
  };

  const approvalLink = order.links.find((l) => l.rel === "approve");
  if (!approvalLink) {
    throw new Error("No approval URL returned from PayPal");
  }

  return {
    id: order.id,
    approvalUrl: approvalLink.href,
  };
}

export async function captureOrder(orderId: string): Promise<{
  success: boolean;
  packageId: string;
  credits: number;
  transactionId: string;
}> {
  const accessToken = await getAccessToken();

  const response = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PayPal capture failed: ${err}`);
  }

  const capture = await response.json() as {
    id: string;
    status: string;
    purchase_units: Array<{
      reference_id: string;
      payments: {
        captures: Array<{ id: string; status: string }>;
      };
    }>;
  };

  if (capture.status !== "COMPLETED") {
    throw new Error(`Payment not completed. Status: ${capture.status}`);
  }

  const packageId = capture.purchase_units[0]?.reference_id || "";
  const pkg = CREDIT_PACKAGES.find(p => p.id === packageId);
  const transactionId = capture.purchase_units[0]?.payments?.captures?.[0]?.id || capture.id;

  return {
    success: true,
    packageId,
    credits: pkg?.credits || 0,
    transactionId,
  };
}

export function getPackages(): CreditPackage[] {
  return CREDIT_PACKAGES;
}
