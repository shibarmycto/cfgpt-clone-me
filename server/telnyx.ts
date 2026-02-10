const TELNYX_API_KEY = process.env.TELNYX_API_KEY || "";
const TELNYX_BASE_URL = "https://api.telnyx.com/v2";

interface TelnyxNumber {
  phone_number: string;
  region_information?: any[];
  cost_information?: { monthly_cost: string; currency: string };
  features?: any[];
}

export interface AvailableNumber {
  phoneNumber: string;
  locality: string;
  region: string;
  monthlyRate: string;
  currency: string;
}

async function telnyxFetch(path: string, options: RequestInit = {}) {
  const res = await fetch(`${TELNYX_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Telnyx API error ${res.status}: ${text}`);
  }
  return res.json();
}

export async function searchAvailableNumbers(countryCode = "GB", limit = 20): Promise<AvailableNumber[]> {
  if (!TELNYX_API_KEY) {
    throw new Error("Telnyx API key not configured");
  }
  try {
    const data = await telnyxFetch(
      `/available_phone_numbers?filter[country_code]=${countryCode}&filter[limit]=${limit}&filter[features][]=voice`
    );
    const numbers = data.data || [];
    return numbers.map((n: any) => ({
      phoneNumber: n.phone_number,
      locality: n.region_information?.[0]?.region_name || "",
      region: n.region_information?.[0]?.region_type || "",
      monthlyRate: n.cost_information?.monthly_cost || "1.00",
      currency: n.cost_information?.currency || "USD",
    }));
  } catch (err: any) {
    console.error("[Telnyx] Search error:", err.message);
    throw err;
  }
}

export async function orderNumber(phoneNumber: string): Promise<any> {
  if (!TELNYX_API_KEY) {
    throw new Error("Telnyx API key not configured");
  }
  try {
    const data = await telnyxFetch("/number_orders", {
      method: "POST",
      body: JSON.stringify({
        phone_numbers: [{ phone_number: phoneNumber }],
      }),
    });
    return data.data;
  } catch (err: any) {
    console.error("[Telnyx] Order error:", err.message);
    throw err;
  }
}

export async function listOwnedNumbers(): Promise<AvailableNumber[]> {
  if (!TELNYX_API_KEY) {
    throw new Error("Telnyx API key not configured");
  }
  try {
    const data = await telnyxFetch("/phone_numbers?page[size]=100");
    const numbers = data.data || [];
    return numbers.map((n: any) => ({
      phoneNumber: n.phone_number,
      locality: n.connection_name || "",
      region: n.status || "",
      monthlyRate: "",
      currency: "",
    }));
  } catch (err: any) {
    console.error("[Telnyx] List error:", err.message);
    throw err;
  }
}
