import axios from "axios";
import { AifError, AifService } from "./aif.service";
import { LoggerService } from "../logger/logger.service";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

/** Fixtures copied verbatim from docs/postman/AIF.postman_collection.json. */
const SEND_OTP_SUCCESS = {
  Success: true,
  StatusCode: 200,
  OTPRequired: true,
  Message: "OTP has been sent successfully.",
  BeneficiaryId: 106545,
  MobileNumber: "XXXXXX0110",
};

const VERIFY_OTP_SUCCESS = {
  Success: true,
  StatusCode: 200,
  Message: "Authentication successful.",
  Token: "eyJhbGciOiJIUzI1NiJ9.fake.token",
  TokenType: "Bearer",
  ExpiresIn: 3600,
  Beneficiary: {
    Beneficiary_Id: 106545,
    Beneficiary_Name: "Usha Sharma",
    Mobile_Number: "XXXXXX0110",
  },
};

const httpError = (status: number, data: any) => {
  const err: any = new Error(`HTTP ${status}`);
  err.response = { status, data };
  return err;
};

describe("AifService", () => {
  let service: AifService;
  let logger: LoggerService;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;
    service = new AifService(logger, {
      get: (key: string) =>
        ({ AIF_BASE_URL: "https://aif.test/api", AIF_API_KEY: "k" }[key]),
    } as any);
  });

  describe("sendOtp", () => {
    it("returns the masked mobile number", async () => {
      mockedAxios.request.mockResolvedValue({ data: SEND_OTP_SUCCESS } as any);

      await expect(service.sendOtp("106545")).resolves.toEqual({
        maskedMobile: "XXXXXX0110",
        message: "OTP has been sent successfully.",
      });
    });

    it("sends beneficiaryId as a number, with the apiKey header", async () => {
      mockedAxios.request.mockResolvedValue({ data: SEND_OTP_SUCCESS } as any);

      await service.sendOtp("106545");

      const config = mockedAxios.request.mock.calls[0][0] as any;
      expect(config.data).toEqual({ beneficiaryId: 106545 });
      expect(config.headers.apiKey).toBe("k");
      expect(config.url).toBe("https://aif.test/api/validate_beneficiaries/");
    });

    it("maps a 404 beneficiary lookup to beneficiary_not_found", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(404, {
          Success: false,
          StatusCode: 404,
          ErrorCode: "BV40401",
          Message: "Beneficiary not found.",
        })
      );

      await expect(service.sendOtp("999999")).rejects.toMatchObject({
        code: "beneficiary_not_found",
      });
    });

    it("does not leak a bad API key to the farmer", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(401, {
          Success: false,
          StatusCode: 401,
          ErrorCode: "BV40402",
          Message: "Invalid API Key.",
        })
      );

      // Same ErrorCode family as beneficiary_not_found, but a 401 — must not be
      // reported as a farmer-correctable problem.
      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        code: "aif_unavailable",
      });
      expect(logger.error).toHaveBeenCalled();
    });

    it("reads the lowercase-keyed BV42201 body", async () => {
      // This response uses success/statusCode/errorCode/message, unlike every other one.
      mockedAxios.request.mockRejectedValue(
        httpError(422, {
          success: false,
          statusCode: 422,
          errorCode: "BV42201",
          message: "Registered mobile number not available.",
        })
      );

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        code: "mobile_not_registered",
      });
    });

    it.each([
      ["BV50301", 503],
      ["BV50302", 503],
      ["BV50401", 504],
    ])("maps %s to otp_service_unavailable", async (errorCode, status) => {
      mockedAxios.request.mockRejectedValue(
        httpError(status, { Success: false, ErrorCode: errorCode })
      );

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        code: "otp_service_unavailable",
      });
    });

    it("maps a network failure with no response to aif_unavailable", async () => {
      mockedAxios.request.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        code: "aif_unavailable",
      });
    });
  });

  describe("verifyOtp", () => {
    it("returns the token and beneficiary name", async () => {
      mockedAxios.request.mockResolvedValue({
        data: VERIFY_OTP_SUCCESS,
      } as any);

      await expect(service.verifyOtp("106545", "720934")).resolves.toEqual({
        token: "eyJhbGciOiJIUzI1NiJ9.fake.token",
        expiresIn: 3600,
        beneficiaryName: "Usha Sharma",
      });
    });

    it.each([
      ["Invalid OTP.", "otp_invalid"],
      ["OTP has already been used.", "otp_invalid"],
      ["OTP has expired. Please generate a new OTP.", "otp_expired"],
    ])("maps %s to %s", async (message, expected) => {
      mockedAxios.request.mockRejectedValue(
        httpError(400, { Success: false, StatusCode: 400, Message: message })
      );

      await expect(service.verifyOtp("106545", "000000")).rejects.toMatchObject(
        { code: expected }
      );
    });

    it("maps 429 to otp_attempts_exceeded", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(429, {
          Success: false,
          StatusCode: 429,
          Message:
            "Maximum OTP attempts exceeded. Please try again after 5 minutes.",
        })
      );

      await expect(service.verifyOtp("106545", "000000")).rejects.toMatchObject(
        { code: "otp_attempts_exceeded" }
      );
    });
  });

  describe("getLoanStatus", () => {
    it("unwraps the bare JSON string response", async () => {
      mockedAxios.request.mockResolvedValue({ data: "Disbursed" } as any);

      await expect(service.getLoanStatus("101154", "tok")).resolves.toBe(
        "Disbursed"
      );
    });

    it("sends the bearer token and the value on both body and query string", async () => {
      mockedAxios.request.mockResolvedValue({ data: "Disbursed" } as any);

      await service.getLoanStatus("101154", "tok");

      const config = mockedAxios.request.mock.calls[0][0] as any;
      expect(config.headers.Authorization).toBe("Bearer tok");
      expect(config.data).toEqual({ loanApplicationNumber: 101154 });
      expect(config.params).toEqual({ loanApplicationNumber: 101154 });
    });

    it("treats the 200-with-not-found string as an error", async () => {
      // AIF returns 200 OK with this body, so status code alone cannot detect it.
      mockedAxios.request.mockResolvedValue({
        data: "Application Number not found.",
      } as any);

      await expect(
        service.getLoanStatus("999999", "tok")
      ).rejects.toMatchObject({ code: "loan_application_not_found" });
    });

    it("maps the 400 object response to loan_application_not_found", async () => {
      mockedAxios.request.mockResolvedValue({
        data: { Message: "Invalid loanApplicationNumber." },
      } as any);

      await expect(service.getLoanStatus("", "tok")).rejects.toMatchObject({
        code: "loan_application_not_found",
      });
    });
  });

  describe("getSupportTickets", () => {
    it("normalises the ticket array", async () => {
      mockedAxios.request.mockResolvedValue({
        data: [
          {
            BeneficiaryId: 395412,
            LoanApplicationNumber: 0,
            subQueryType: "Update beneficiary details",
            Question: "Other",
            description: "Revising from 2 acres to 4000 sq. mtr.",
            Status: "Submitted",
          },
        ],
      } as any);

      await expect(service.getSupportTickets("395412", "tok")).resolves.toEqual(
        [
          {
            beneficiaryId: 395412,
            loanApplicationNumber: 0,
            subQueryType: "Update beneficiary details",
            question: "Other",
            description: "Revising from 2 acres to 4000 sq. mtr.",
            status: "Submitted",
          },
        ]
      );
    });

    it("treats the no-tickets string as an empty list, not an error", async () => {
      mockedAxios.request.mockResolvedValue({
        data: "No support tickets found for this beneficiary.",
      } as any);

      await expect(service.getSupportTickets("395412", "tok")).resolves.toEqual(
        []
      );
    });

    it("maps an expired token to session_expired", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(401, { Message: "Token has expired." })
      );

      await expect(
        service.getSupportTickets("395412", "tok")
      ).rejects.toBeInstanceOf(AifError);
      await expect(
        service.getSupportTickets("395412", "tok")
      ).rejects.toMatchObject({ code: "session_expired" });
    });
  });
});
