import { AifSupportTicket } from "./aif.service";

export type AifAction = "on_init" | "on_status";

export interface AifTag {
  code: string;
  name: string;
  short_desc: string;
  list?: { code: string; name: string; value: string }[];
}

/**
 * Farmer-facing wording per doc §6. `retryable: false` marks the cases where retrying
 * cannot succeed, so the agent does not offer to try again.
 */
export const AIF_ERROR_COPY: Record<
  string,
  { short_desc: string; retryable: boolean }
> = {
  beneficiary_not_found: {
    short_desc:
      "No beneficiary was found with that ID. Please check the number and share it again.",
    retryable: true,
  },
  mobile_not_registered: {
    short_desc:
      "There is no mobile number registered against this beneficiary ID, so an OTP cannot be sent. The farmer must contact their AIF office to update their registered mobile number.",
    retryable: false,
  },
  invalid_mobile_on_record: {
    short_desc:
      "The mobile number on record is not valid. The farmer should contact their AIF office.",
    retryable: false,
  },
  otp_service_unavailable: {
    short_desc:
      "The AIF system could not be reached to send the OTP. Please try again in a few minutes.",
    retryable: true,
  },
  otp_invalid: {
    short_desc: "That OTP did not match. Please ask for the OTP again.",
    retryable: true,
  },
  otp_expired: {
    short_desc: "The OTP has expired. A new OTP must be requested.",
    retryable: true,
  },
  otp_attempts_exceeded: {
    short_desc:
      "Too many incorrect OTP attempts. The farmer must wait 5 minutes before trying again.",
    retryable: false,
  },
  loan_application_not_found: {
    short_desc:
      "No loan application was found with that number. Please check the number and share it again.",
    retryable: true,
  },
  session_expired: {
    short_desc:
      "The verified session has expired. A new OTP is needed before the status can be checked.",
    retryable: true,
  },
  aif_unavailable: {
    short_desc:
      "The AIF system cannot be reached right now. Please try again in a few minutes.",
    retryable: true,
  },
};

/**
 * Builds an on_init / on_status envelope, following the shapes already used in this
 * codebase:
 *
 * - on_init  (as buildPmfbyOnInitMessage):    provider + items[0].tags[]
 * - on_status (as handlePmfbyGrievanceStatus): id + state + provider + items[] +
 *                                              order.tags[]
 *
 * The request fulfillment is deliberately NOT echoed back the way the PMFBY grievance
 * handler does: for AIF it carries the `otp` tag, and the OTP must never be returned.
 */
export function buildAifResponse(
  body: any,
  action: AifAction,
  tag: AifTag,
  options: { state?: string; items?: any[] } = {}
) {
  const providerId = body?.message?.order?.provider?.id ?? "aif-agri";
  const itemId = body?.message?.order?.items?.[0]?.id ?? "aif";

  const outcomeTag = {
    display: true,
    descriptor: {
      name: tag.name,
      code: tag.code,
      short_desc: tag.short_desc,
    },
    ...(tag.list?.length && {
      list: tag.list.map((entry) => ({
        descriptor: { code: entry.code, name: entry.name },
        value: entry.value,
      })),
    }),
  };

  if (action === "on_init") {
    return {
      context: aifContext(body, action),
      message: {
        order: {
          provider: { id: providerId },
          items: [{ id: itemId, tags: [outcomeTag] }],
        },
      },
    };
  }

  return {
    context: aifContext(body, action),
    message: {
      order: {
        id: body?.message?.order?.id ?? body?.context?.transaction_id,
        state: options.state ?? "COMPLETED",
        provider: { id: providerId },
        items: options.items ?? [{ id: itemId }],
        tags: [outcomeTag],
      },
    },
  };
}

function aifContext(body: any, action: AifAction) {
  return {
    ...body.context,
    action,
    timestamp: new Date().toISOString(),
    ttl: "PT10M",
  };
}

/** One item per ticket (doc §4.4). No tickets is a success, not an error (doc §6). */
export function buildAifGrievanceResponse(
  body: any,
  tickets: AifSupportTicket[]
) {
  const itemId = body?.message?.order?.items?.[0]?.id ?? "aif";

  if (!tickets.length) {
    return buildAifResponse(body, "on_status", {
      code: "no_grievances",
      name: "Support Tickets",
      short_desc: "There are no open grievances or support tickets.",
      list: [
        { code: "ticket_count", name: "Ticket Count", value: "0" },
        { code: "source", name: "Source", value: "AIF Portal" },
      ],
    });
  }

  const items = tickets.map((ticket, index) => ({
    id: `${itemId}-ticket-${index + 1}`,
    tags: [
      {
        display: true,
        descriptor: {
          name: ticket.subQueryType || "Support Ticket",
          code: "grievance_status",
          short_desc: ticket.description,
        },
        list: [
          {
            descriptor: { code: "query_type", name: "Query Type" },
            value: ticket.subQueryType,
          },
          {
            descriptor: { code: "question", name: "Question" },
            value: ticket.question,
          },
          {
            descriptor: { code: "description", name: "Description" },
            value: ticket.description,
          },
          {
            descriptor: { code: "status", name: "Status" },
            value: ticket.status,
          },
          // Omitted when 0 — AIF uses 0 for tickets not tied to an application.
          ...(ticket.loanApplicationNumber
            ? [
                {
                  descriptor: {
                    code: "loan_application_number",
                    name: "Loan Application Number",
                  },
                  value: String(ticket.loanApplicationNumber),
                },
              ]
            : []),
          {
            descriptor: { code: "source", name: "Source" },
            value: "AIF Portal",
          },
        ],
      },
    ],
  }));

  return buildAifResponse(
    body,
    "on_status",
    {
      code: "grievance_status",
      name: "Support Tickets",
      short_desc: `${tickets.length} support ticket(s) found.`,
      list: [
        {
          code: "ticket_count",
          name: "Ticket Count",
          value: String(tickets.length),
        },
        { code: "source", name: "Source", value: "AIF Portal" },
      ],
    },
    { items }
  );
}
