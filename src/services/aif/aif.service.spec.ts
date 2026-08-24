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

    it("returns the AIF message for a 404 beneficiary lookup", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(404, {
          Success: false,
          StatusCode: 404,
          ErrorCode: "BV40401",
          Message: "Beneficiary not found.",
        })
      );

      await expect(service.sendOtp("999999")).rejects.toMatchObject({
        message: "Beneficiary not found.",
      });
    });

    it("logs the status and error code behind the message", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(401, {
          Success: false,
          StatusCode: 401,
          ErrorCode: "BV40402",
          Message: "Invalid API Key.",
        })
      );

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        message: "Invalid API Key.",
      });
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining("status=401 code=BV40402")
      );
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
        message: "Registered mobile number not available.",
      });
    });

    it("does not pass ExceptionMessage on to the caller", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(500, {
          Success: false,
          Message: "An error occurred.",
          ExceptionMessage: "Object reference not set to an instance.",
        })
      );

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        message: "An error occurred.",
      });
    });

    it("falls back to the status when AIF sends no message", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(503, { Success: false, ErrorCode: "BV50301" })
      );

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        message: "AIF request failed (status 503).",
      });
    });

    it("reports the transport error when there is no response", async () => {
      mockedAxios.request.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.sendOtp("106545")).rejects.toMatchObject({
        message: "ECONNREFUSED",
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
      "Invalid OTP.",
      "OTP has already been used.",
      "OTP has expired. Please generate a new OTP.",
      "Maximum OTP attempts exceeded. Please try again after 5 minutes.",
    ])("returns %s unchanged", async (message) => {
      mockedAxios.request.mockRejectedValue(
        httpError(400, { Success: false, StatusCode: 400, Message: message })
      );

      await expect(service.verifyOtp("106545", "000000")).rejects.toMatchObject(
        { message }
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
      ).rejects.toMatchObject({ message: "Application Number not found." });
    });

    it("returns the message from the object response", async () => {
      mockedAxios.request.mockResolvedValue({
        data: { Message: "Invalid loanApplicationNumber." },
      } as any);

      await expect(service.getLoanStatus("", "tok")).rejects.toMatchObject({
        message: "Invalid loanApplicationNumber.",
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

    it("surfaces an expired token as the message AIF sent", async () => {
      mockedAxios.request.mockRejectedValue(
        httpError(401, { Message: "Token has expired." })
      );

      await expect(
        service.getSupportTickets("395412", "tok")
      ).rejects.toBeInstanceOf(AifError);
      await expect(
        service.getSupportTickets("395412", "tok")
      ).rejects.toMatchObject({ message: "Token has expired." });
    });
  });
});
