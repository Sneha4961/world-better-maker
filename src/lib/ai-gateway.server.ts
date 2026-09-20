/**
 * Server-only helper for calling the Lovable AI Gateway.
 * Wraps fetch so the gateway's X-Lovable-AIG-Run-ID is captured and propagated.
 */
const GATEWAY_BASE = "https://ai.gateway.lovable.dev/v1";

export function getLovableApiKey(): string {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured. Missing LOVABLE_API_KEY.");
  return key;
}

export function createLovableAiGatewayRunIdFetch(initialRunId?: string | null) {
  let runId = initialRunId ?? null;

  const fetchWithRunId = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const headers = new Headers(init?.headers);
    if (runId) headers.set("X-Lovable-AIG-Run-ID", runId);
    const res = await fetch(input, { ...init, headers });
    const minted = res.headers.get("X-Lovable-AIG-Run-ID");
    if (minted) runId = minted;
    return res;
  };

  return {
    fetch: fetchWithRunId,
    get runId() {
      return runId;
    },
  };
}

export { GATEWAY_BASE };
