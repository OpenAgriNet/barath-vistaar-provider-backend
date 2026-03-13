import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

/**
 * Telemetry helper for logging network API calls to observability service.
 * Follows the oan-ui-service pattern for consistency.
 * All calls are wrapped in try-catch to ensure telemetry failures don't affect main flow.
 */

interface TelemetryConfig {
  host: string;
  apislug: string;
  endpoint: string;
  channel: string;
  pdata: {
    id: string;
    ver: string;
    pid: string;
  };
}

const TELEMETRY_CONFIG: TelemetryConfig = {
  host: process.env.TELEMETRY_HOST || 'https://dev-vistaar.da.gov.in',
  apislug: '/action',
  endpoint: '/data/v3/telemetry',
  channel: 'beckn-network-provider',
  pdata: {
    id: 'beckn-onix-network-provider',
    ver: 'v1.0',
    pid: 'network-provider',
  },
};

/**
 * Send telemetry event to observability service
 * @param input - The input data (request body)
 * @param output - The output data (response or error)
 * @param success - Whether the operation was successful
 */
export async function startTelemetry(
  input: any,
  output: any,
  success: boolean,
): Promise<void> {
  try {
    const timestamp = Date.now();
    const messageId = uuidv4();

    // Build telemetry event payload matching oan-ui-service pattern
    const telemetryEvent = {
      eid: 'OE_ITEM_RESPONSE',
      ver: '2.2',
      mid: messageId,
      ets: timestamp,
      channel: TELEMETRY_CONFIG.channel,
      pdata: TELEMETRY_CONFIG.pdata,
      uid: 'network-provider-service',
      sid: uuidv4(), // Session ID for this telemetry call
      did: 'network-provider-device',
      edata: {
        eks: {
          target: {
            networkApiDetails: {
              input: input,
              output: output,
              success: success,
            },
          },
        },
      },
    };

    // Wrap the event in the ekstep.telemetry format
    const payload = {
      id: 'ekstep.telemetry',
      ver: '2.2',
      ets: timestamp,
      events: [telemetryEvent],
    };

    // Fire-and-forget POST to observability service
    // Using setTimeout to ensure it doesn't block the main flow
    setTimeout(async () => {
      try {
        // Construct full URL: host + apislug + endpoint
        const fullUrl = TELEMETRY_CONFIG.host + TELEMETRY_CONFIG.apislug + TELEMETRY_CONFIG.endpoint;
        
        await axios.post(fullUrl, payload, {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 5000, // 5 second timeout
        });
      } catch (innerError) {
        // Silently log telemetry errors without affecting main flow
        console.error('[Telemetry] Failed to send telemetry:', innerError instanceof Error ? innerError.message : String(innerError));
      }
    }, 0);
  } catch (error) {
    // Catch any errors in telemetry preparation and log them
    console.error('[Telemetry] Error preparing telemetry:', error instanceof Error ? error.message : String(error));
  }
}
