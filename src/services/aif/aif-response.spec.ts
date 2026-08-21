import {
  AIF_ERROR_COPY,
  buildAifGrievanceResponse,
  buildAifResponse,
} from "./aif-response";
import { AifSupportTicket } from "./aif.service";

const body = {
  context: {
    domain: "schemes:vistaar",
    action: "status",
    transaction_id: "txn-1",
    version: "1.1.0",
  },
  message: {
    order: {
      id: "order-1",
      provider: { id: "aif-agri" },
      items: [{ id: "aif" }],
    },
  },
};

const ticket = (over: Partial<AifSupportTicket> = {}): AifSupportTicket => ({
  beneficiaryId: 395412,
  loanApplicationNumber: 0,
  subQueryType: "Update Project details",
  question: "Update project cost/loan amounts",
  description: "A revised DPR is uploaded",
  status: "Submitted",
  ...over,
});

describe("buildAifResponse", () => {
  it("sets the action and preserves the incoming context", () => {
    const res = buildAifResponse(body, "on_init", {
      code: "otp_sent",
      name: "OTP Sent",
      short_desc: "OTP has been sent successfully.",
    });

    expect(res.context.action).toBe("on_init");
    expect(res.context.transaction_id).toBe("txn-1");
    expect(res.context.domain).toBe("schemes:vistaar");
  });

  it("omits order id and state on on_init", () => {
    const res: any = buildAifResponse(body, "on_init", {
      code: "otp_sent",
      name: "OTP Sent",
      short_desc: "sent",
    });

    expect(res.message.order.id).toBeUndefined();
    expect(res.message.order.state).toBeUndefined();
  });

  it("sets order id and state on on_status", () => {
    const res: any = buildAifResponse(body, "on_status", {
      code: "loan_status",
      name: "Loan Application Status",
      short_desc: "Disbursed",
    });

    expect(res.message.order.id).toBe("order-1");
    expect(res.message.order.state).toBe("COMPLETED");
  });

  it("puts on_status tags at order level, with items carrying ids only", () => {
    // Matches handlePmfbyGrievanceStatus, the codebase's on_status shape.
    const res: any = buildAifResponse(body, "on_status", {
      code: "loan_status",
      name: "Loan Application Status",
      short_desc: "Disbursed",
    });

    expect(res.message.order.tags[0].descriptor.code).toBe("loan_status");
    expect(res.message.order.items).toEqual([{ id: "aif" }]);
    expect(res.message.order.items[0].tags).toBeUndefined();
  });

  it("puts on_init tags inside items, with no order id or state", () => {
    // Matches buildPmfbyOnInitMessage, the codebase's on_init shape.
    const res: any = buildAifResponse(body, "on_init", {
      code: "otp_sent",
      name: "OTP Sent",
      short_desc: "sent",
    });

    expect(res.message.order.items[0].tags[0].descriptor.code).toBe("otp_sent");
    expect(res.message.order.tags).toBeUndefined();
  });

  it("never echoes the request fulfillment back", () => {
    // The AIF fulfillment carries the otp tag; echoing it would return the OTP.
    const withOtp = {
      ...body,
      message: {
        order: {
          ...body.message.order,
          fulfillments: [
            {
              customer: {
                person: {
                  tags: [{ descriptor: { code: "otp" }, value: "720934" }],
                },
              },
            },
          ],
        },
      },
    };

    const res: any = buildAifResponse(withOtp, "on_status", {
      code: "loan_status",
      name: "Loan Application Status",
      short_desc: "Disbursed",
    });

    expect(res.message.order.fulfillments).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain("720934");
  });

  it("carries the tag list as descriptor/value pairs", () => {
    const res: any = buildAifResponse(body, "on_init", {
      code: "otp_sent",
      name: "OTP Sent",
      short_desc: "sent",
      list: [
        {
          code: "masked_mobile",
          name: "Registered Mobile",
          value: "XXXXXX0110",
        },
      ],
    });

    expect(res.message.order.items[0].tags[0].list).toEqual([
      {
        descriptor: { code: "masked_mobile", name: "Registered Mobile" },
        value: "XXXXXX0110",
      },
    ]);
  });

  it("falls back to the documented provider and item ids", () => {
    const res: any = buildAifResponse({ context: {} }, "on_init", {
      code: "x",
      name: "X",
      short_desc: "x",
    });

    expect(res.message.order.provider.id).toBe("aif-agri");
    expect(res.message.order.items[0].id).toBe("aif");
  });
});

describe("buildAifGrievanceResponse", () => {
  it("reports no tickets as a success, not an error", () => {
    const res: any = buildAifGrievanceResponse(body, []);

    expect(res.message.order.state).toBe("COMPLETED");
    expect(res.message.order.tags[0].descriptor.code).toBe("no_grievances");
  });

  it("returns one item per ticket", () => {
    const res: any = buildAifGrievanceResponse(body, [
      ticket(),
      ticket({ loanApplicationNumber: 1330776 }),
      ticket(),
    ]);

    expect(res.message.order.items).toHaveLength(3);
    expect(res.message.order.items.map((i: any) => i.id)).toEqual([
      "aif-ticket-1",
      "aif-ticket-2",
      "aif-ticket-3",
    ]);
  });

  it("keeps the ticket count on the order when items are supplied", () => {
    // Voice reads out the count before offering detail (doc §7.4), so the summary
    // must survive alongside the per-ticket items.
    const res: any = buildAifGrievanceResponse(body, [ticket(), ticket()]);

    const summary = res.message.order.tags[0];
    expect(summary.descriptor.short_desc).toBe("2 support ticket(s) found.");
    expect(summary.list).toContainEqual({
      descriptor: { code: "ticket_count", name: "Ticket Count" },
      value: "2",
    });
  });

  it("omits the loan application number when the ticket is not tied to one", () => {
    // AIF sends 0 rather than null for standalone tickets.
    const res: any = buildAifGrievanceResponse(body, [
      ticket({ loanApplicationNumber: 0 }),
    ]);

    const codes = res.message.order.items[0].tags[0].list.map(
      (entry: any) => entry.descriptor.code
    );
    expect(codes).not.toContain("loan_application_number");
  });

  it("includes the loan application number when there is one", () => {
    const res: any = buildAifGrievanceResponse(body, [
      ticket({ loanApplicationNumber: 1330776 }),
    ]);

    expect(res.message.order.items[0].tags[0].list).toContainEqual({
      descriptor: {
        code: "loan_application_number",
        name: "Loan Application Number",
      },
      value: "1330776",
    });
  });

  it("attributes every ticket to the AIF Portal", () => {
    const res: any = buildAifGrievanceResponse(body, [ticket()]);

    expect(res.message.order.items[0].tags[0].list).toContainEqual({
      descriptor: { code: "source", name: "Source" },
      value: "AIF Portal",
    });
  });
});

describe("AIF_ERROR_COPY", () => {
  it.each([
    "mobile_not_registered",
    "invalid_mobile_on_record",
    "otp_attempts_exceeded",
  ])("marks %s as not retryable", (code) => {
    // Doc §6: retrying these cannot succeed, so the agent must not offer a retry.
    expect(AIF_ERROR_COPY[code].retryable).toBe(false);
  });

  it.each([
    "beneficiary_not_found",
    "otp_invalid",
    "loan_application_not_found",
  ])("marks %s as retryable", (code) => {
    expect(AIF_ERROR_COPY[code].retryable).toBe(true);
  });

  it("never exposes an AIF error code to the farmer", () => {
    for (const entry of Object.values(AIF_ERROR_COPY)) {
      expect(entry.short_desc).not.toMatch(/BV\d{5}/);
    }
  });
});
