import "server-only";
import type { SmsProvider } from "./types";

/** Later-ready stub (SPEC M12): an Android phone acting as an SMS gateway. */
export const androidGatewayDriver: SmsProvider = {
  name: "android_gateway",
  channel: "sms",
  caps: { autoSend: true, inbound: true, mms: false, receipts: true },
  async send() {
    return {
      status: "failed",
      error: "android_gateway driver is not configured (Later)",
      retryable: false,
    };
  },
};
