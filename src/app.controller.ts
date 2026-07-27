import {
  Controller,
  Get,
  Post,
  UseGuards,
  Body,
  Render,
  Res,
  Req,
  Param,
  Request,
  Response,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AppService } from "./app.service";
import { AuthService } from "./auth/auth.service";
import { firstValueFrom } from "rxjs";
import { HttpService } from "@nestjs/axios";
import { GfrService } from "./services/gfr/gfr.service";
import { PmkisanGrievanceService } from "./services/pmkisan-grievance/pmkisan-grievance.service";
import { PmfbyGrievanceService } from "./services/pmfby/pmfby-greviance.service";
import { SathiService } from "./services/sathi/sathi.service";
import { SmamService } from "./services/smam/smam.service";
import { SchemeQdrantService } from "./services/scheme-qdrant/scheme-qdrant.service";
import { LoggerService } from './services/logger/logger.service';

@Controller("")
export class AppController {
  constructor(private readonly appService: AppService,
    private readonly authService: AuthService,
    private readonly httpService: HttpService,
    private readonly gfrService: GfrService,
    private readonly pmkisanGrievanceService: PmkisanGrievanceService,
    private readonly pmfbyGrievanceService: PmfbyGrievanceService,
    private readonly sathiSeedService: SathiService,
    private readonly smamService: SmamService,
    private readonly schemeQdrantService: SchemeQdrantService,
    private readonly logger: LoggerService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  //dsep
  @Post("dsep/search")
  getContentFromIcar(@Body() body: any) {
    this.logger.log("search api calling");
    return this.appService.handleSearch(body);
    //return this.appService.getCoursesFromFln(body);
  }

  @Post("dsep/select")
  selectCourse(@Body() body: any) {
    this.logger.log("select api calling");
    return this.appService.handleSelect(body);
  }

  @Post("dsep/init")
  initCourse(@Body() body: any) {
    this.logger.log("init api calling");
    return this.appService.handleInit(body);
  }

  @Post("dsep/confirm")
  confirmCourse(@Body() body: any) {
    this.logger.log("confirm api calling");
    return this.appService.handleConfirm(body);
  }

  @Post("dsep/rating")
  giveRating(@Body() body: any) {
    this.logger.log("rating api calling");
    return this.appService.handleRating(body);
  }

  //mobility search endpoint
  @Post("mobility/search")
  async getContentFromIcar1(@Body() body: any) {
    this.logger.log("search api calling");

    const categoryName = body?.message?.intent?.category?.descriptor?.name;
    this.logger.log("categoryName", categoryName);
    const categoryCode =
      body?.message?.intent?.category?.descriptor?.code?.toLowerCase();
    this.logger.log("categoryCode", categoryCode);
    const categoryNameLower = categoryName?.toLowerCase();
    this.logger.log("categoryNameLower", categoryNameLower);

    const route = this.resolveMobilitySearchRoute(body);
    this.logger.log("mobilitySearchRoute", route);

    switch (route) {
      case "knowledge-advisory":
        this.logger.log("Inside Knowledge Advisory search");
        return this.appService.searchForIntentQuery(body);

      case "weather-forecast":
        this.logger.log("Inside Weather Forecast search");
        return this.appService.weatherforecastSearch(body);

      case "weather-forecast-mausamgram":
        this.logger.log("Inside Weather Forecast search from mausamgram");
        return this.appService.masuamGramaWeatherForecastSearch(body);

      case "schemes-agri":
        // Hasura structured scheme catalog only — unchanged
        this.logger.log("Inside schemes-agri search (Hasura)");
        return this.appService.handlePmKisanSearch(body);

      case "scheme-agri-qdrant":
        // Vector document search only (Qdrant) — no Hasura
        this.logger.log("Inside scheme-agri-qdrant search (Qdrant vector only)");
        return this.schemeQdrantService.search(body);

      case "icar-schemes":
        this.logger.log("Inside Icar search");
        return this.appService.handleSearch(body);

      case "mandi":
        this.logger.log("Inside Mandi (price-discovery) search");
        return this.appService.mandiSearch(body);

      case "mandi-location":
        this.logger.log("Inside Mandi (price-discovery) search");
        return this.appService.mandiLocationSearch(body);

      case "pmfby":
        this.logger.log("Inside PMFBY search");
        return await this.appService.handlePmfbySearch(body);

      case "grievance-agri":
        this.logger.log("Inside PMKISAN Grievance search");
        return await this.pmkisanGrievanceService.searchGrievanceStatus(body);

      case "gfr-crop-registry": {
        this.logger.log("INSIDE GFR CROP REGISTRY SEARCH...");
        return this.gfrService.fetchCropRegistry(body);
      }

      case "gfr-crop-recommendation": {
        this.logger.log("INSIDE GFR CROP RECOMMENDATION SEARCH...");
        const gfrRecResponse = await this.appService.fetchGFRRecommendation(body);
        this.logger.log(
          "GFR recommendation final response-->>",
          JSON.stringify(gfrRecResponse, null, 2),
        );
        return gfrRecResponse;
      }
      case "smam": {
        this.logger.log("INSIDE SMAM SEARCH...");
        const smamResult = await this.smamService.searchSMAMBenfitData(body);
        this.logger.log("SMAM FINAL RESPONSE:", JSON.stringify(smamResult, null, 2));
        return smamResult;
      }
      
      case "sathi-seed": {
        const sathiResult = await this.sathiSeedService.getSeedAvailability(body);
        this.logger.log("SATHI FINAL RESPONSE:", JSON.stringify(sathiResult, null, 2));
        return sathiResult;
      }
      

      default:
        return this.appService.searchForIntentQuery(body);
    }
  }

  /**
   * Ordered route resolution for /mobility/search (first match wins).
   * GFR item ids: gfr-agri-crop-recommendation vs gfr-agri-crop-registy / default → registry.
   */
  private resolveMobilitySearchRoute(body: any): string {
    const categoryName = body?.message?.intent?.category?.descriptor?.name;
    const categoryCode =
      body?.message?.intent?.category?.descriptor?.code?.toLowerCase();
    const categoryNameLower = categoryName?.toLowerCase();
    const firstItemId =
      body?.message?.order?.items?.[0]?.id ??
      body?.message?.intent?.items?.[0]?.id ??
      body?.message?.intent?.item?.id;
    const gfrProviderId =
      body?.message?.order?.provider?.id ??
      body?.message?.intent?.provider?.id;
    const providerId = gfrProviderId?.toLowerCase();
    const itemDescriptorCode =
      body?.message?.intent?.item?.descriptor?.code?.toLowerCase();
    const itemDescriptorName = body?.message?.intent?.item?.descriptor?.name;

    switch (true) {
      case categoryName === "knowledge-advisory":
        return "knowledge-advisory";
      case categoryName === "Weather-Forecast":
        return "weather-forecast";
      case categoryName === "Weather-Forecast-Mausamgram":
        return "weather-forecast-mausamgram";
      // Qdrant vector document search — must match before schemes-agri / generic scheme routes
      case categoryCode === "scheme-agri-qdrant" ||
        categoryNameLower === "scheme-agri-qdrant":
        return "scheme-agri-qdrant";
      case categoryCode === "schemes-agri" || categoryNameLower === "schemes-agri":
        return "schemes-agri";
      case categoryCode === "icar-schemes" || categoryNameLower === "icar-schemes":
        return "icar-schemes";
      case (
        categoryCode === "pmfby" ||
        categoryNameLower === "pmfby" ||
        !!categoryCode?.startsWith("pmfby") ||
        providerId === "pmfby-grievance" ||
        firstItemId === "pmfby-grievance"
      ):
        return "pmfby";
      case categoryCode === "grievance" || categoryNameLower === "grievance-agri":
        return "grievance-agri";
      case gfrProviderId === "gfr-agri":
        switch (firstItemId) {
          case "gfr-agri-crop-recommendation":
            return "gfr-crop-recommendation";
          case "gfr-agri-crop-registy":
          default:
            return "gfr-crop-registry";
        }
      case categoryCode === "price-discovery":
        if (itemDescriptorCode === "mandi") return "mandi";
        if (itemDescriptorName) return "mandi-location";
        return "unknown";
      case gfrProviderId === "sathi-seed":
        return "sathi-seed";
      case providerId === "smam":
        return "smam";
      default:
        return "unknown";
    }
  }

  @Post("mobility/select")
  selectCourse1(@Body() body: any) {
    this.logger.log("select api calling");
    return this.appService.handleSelect(body);
  }

  @Post("mobility/init")
  async initCourse1(@Body() body: any) {
    this.logger.log("init api calling");
  
    const providerId = body?.message?.order?.provider?.id?.toLowerCase() ?? "";
    const itemId = body?.message?.order?.items?.[0]?.id?.toLowerCase() ?? "";
  
    this.logger.log(`[init] provider: ${providerId}, item: ${itemId}`);
  
    switch (providerId) {
      case "pmkisan-greviance":
        this.logger.log("INSIDE PMKISAN GRIEVANCE INIT...");
        const grievanceResponse = await this.pmkisanGrievanceService.createGrievance(body);
        this.logger.log("PM Kisan Grievance Response:", JSON.stringify(grievanceResponse, null, 2));
        return grievanceResponse;
  
      case "pmfby-grievance":
        this.logger.log("INSIDE PMFBY GRIEVANCE INIT...");
        return this.pmfbyGrievanceService.createGrievance(body);
  
      case "pmfby-agri":
        this.logger.log("INSIDE PMFBY INIT...");
        return this.appService.handlePmfbyInit(body);
  
      case "shc-discovery":
        this.logger.log("INSIDE SHC INIT...");
        try {
          const soilHealthCardResponse = await this.appService.fetchAndMapSoilHealthCard(body);
          return await this.appService.handleStatusForSHC(soilHealthCardResponse, body);
        } catch (error) {
          throw new HttpException(
            `Failed to process soil health card: ${error.message}`,
            error.status || HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
  
      default:
        if (body?.message?.order) {
          this.logger.log("INSIDE PMKISAN INIT...");
          return this.appService.handlePmkisanInit(body);
        }
        return this.appService.handleInit(body);
    }
  }

  @Post("mobility/confirm")
  confirmCourse1(@Body() body: any) {
    this.logger.log("confirm api calling");
    return this.appService.handleConfirm(body);
  }

  @Post("mobility/rating")
  giveRating1(@Body() body: any) {
    this.logger.log("rating api calling");
    return this.appService.handleRating(body);
  }

  @Post("mobility/status")
  async handleStatus(@Body() body: any) {
    this.logger.log("status api calling");

    return this.appService.handleStatus(body);
  }

  /** Proxy for Vistaar/PMKISAN API (avoids CORS when using vistaar-tester Next.js app from browser) */
  @Post("vistaar-proxy")
  async vistaarProxy(
    @Body() body: { operation: string; EncryptedRequest: string },
  ) {
    const base =
      process.env.PM_KISAN_BASE_URL ||
      process.env.PM_KISAN_BASE_OTP_URL ||
      "https://exlink.pmkisan.gov.in/services/chatbotservice.asmx";
    const paths: Record<string, string> = {
      sendOtp: "/ChatbotOTP",
      verifyOtp: "/ChatbotOTPVerified",
      getUser: "/ChatbotUserDetails",
    };
    const path = paths[body?.operation];
    if (!path || !body?.EncryptedRequest) {
      throw new HttpException(
        "Missing operation or EncryptedRequest",
        HttpStatus.BAD_REQUEST,
      );
    }
    const url = `${base.replace(/\/$/, "")}${path}`;
    const res = await firstValueFrom(
      this.httpService.post(
        url,
        { EncryptedRequest: body.EncryptedRequest },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
          responseType: "text",
        },
      ),
    ).catch((err) => {
      const status = err.response?.status || HttpStatus.BAD_GATEWAY;
      const msg = err.response?.data ?? err.message;
      throw new HttpException(msg, status);
    });
    return { data: res.data };
  }

  @Get("feedback/:id")
  @Render("feedback")
  getFeedbackForm(@Param("id") id: string) {
    return { id };
  }

  @Post("/submit-feedback/:id")
  submitFeedback(
    @Body("description") description: string,
    @Param("id") id: string,
    @Request() req: any,
  ) {
    this.logger.log("description", description);
    this.logger.log("id", id);

    const referer = req.get("Referer");
    this.logger.log("Referer", referer);

    //return this.appService.handleSubmit(description, id);

    // Check if the referer is not empty and belongs to your allowed domain
    if (
      (referer && referer.includes("https://vistaar.tekdinext.com/")) ||
      referer.includes("https://oan.tekdinext.com/")
    ) {
      // Allow access to the feedback form
      return this.appService.handleSubmit(description, id);
    } else {
      // Deny access if not loaded within the iframe
      // res.status(403).send('Access denied. This page can only be loaded within an iframe.');
      throw new HttpException(
        "Access denied. This page can only be loaded within an iframe.",
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
