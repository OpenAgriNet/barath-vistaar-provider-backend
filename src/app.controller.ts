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

@Controller("")
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly authService: AuthService,
    private readonly httpService: HttpService,
    private readonly gfrService: GfrService,
    private readonly pmkisanGrievanceService: PmkisanGrievanceService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  //dsep
  @Post("dsep/search")
  getContentFromIcar(@Body() body: any) {
    console.log("search api calling");
    return this.appService.handleSearch(body);
    //return this.appService.getCoursesFromFln(body);
  }

  @Post("dsep/select")
  selectCourse(@Body() body: any) {
    console.log("select api calling");
    return this.appService.handleSelect(body);
  }

  @Post("dsep/init")
  initCourse(@Body() body: any) {
    console.log("init api calling");
    return this.appService.handleInit(body);
  }

  @Post("dsep/confirm")
  confirmCourse(@Body() body: any) {
    console.log("confirm api calling");
    return this.appService.handleConfirm(body);
  }

  @Post("dsep/rating")
  giveRating(@Body() body: any) {
    console.log("rating api calling");
    return this.appService.handleRating(body);
  }

  //mobility search endpoint
  @Post("mobility/search")
  async getContentFromIcar1(@Body() body: any) {
    console.log("search api calling");

    const categoryName = body?.message?.intent?.category?.descriptor?.name;
    console.log("categoryName", categoryName);
    const categoryCode =
      body?.message?.intent?.category?.descriptor?.code?.toLowerCase();
    console.log("categoryCode", categoryCode);
    const categoryNameLower = categoryName?.toLowerCase();
    console.log("categoryNameLower", categoryNameLower);

    const route = this.resolveMobilitySearchRoute(body);
    console.log("mobilitySearchRoute", route);

    switch (route) {
      case "knowledge-advisory":
        console.log("Inside Knowledge Advisory search");
        return this.appService.searchForIntentQuery(body);

      case "weather-forecast":
        console.log("Inside Weather Forecast search");
        return this.appService.weatherforecastSearch(body);

      case "weather-forecast-mausamgram":
        console.log("Inside Weather Forecast search from mausamgram");
        return this.appService.masuamGramaWeatherForecastSearch(body);

      case "schemes-agri":
        console.log("Inside schemes-agri search");
        return this.appService.handlePmKisanSearch(body);

      case "icar-schemes":
        console.log("Inside Icar search");
        return this.appService.handleSearch(body);

      case "mandi":
        console.log("Inside Mandi (price-discovery) search");
        return this.appService.mandiSearch(body);

      case "pmfby":
        console.log("Inside PMFBY search");
        return await this.appService.handlePmfbySearch(body);

      case "grievance-agri":
        console.log("Inside PMKISAN Grievance search");
        return await this.pmkisanGrievanceService.searchGrievanceStatus(body);

      case "gfr-crop-registry": {
        console.log("INSIDE GFR CROP REGISTRY SEARCH...");
        return this.gfrService.fetchCropRegistry(body);
      }

      case "gfr-crop-recommendation": {
        console.log("INSIDE GFR CROP RECOMMENDATION SEARCH...");
        const gfrRecResponse = await this.appService.fetchGFRRecommendation(body);
        console.log(
          "GFR recommendation final response-->>",
          JSON.stringify(gfrRecResponse, null, 2),
        );
        return gfrRecResponse;
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
    const itemDescriptorCode =
      body?.message?.intent?.item?.descriptor?.code?.toLowerCase();

    switch (true) {
      case categoryName === "knowledge-advisory":
        return "knowledge-advisory";
      case categoryName === "Weather-Forecast":
        return "weather-forecast";
      case categoryName === "Weather-Forecast-Mausamgram":
        return "weather-forecast-mausamgram";
      case categoryCode === "schemes-agri" || categoryNameLower === "schemes-agri":
        return "schemes-agri";
      case categoryCode === "icar-schemes" || categoryNameLower === "icar-schemes":
        return "icar-schemes";
      case (
        categoryCode === "pmfby" ||
        categoryNameLower === "pmfby" ||
        !!categoryCode?.startsWith("pmfby")
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
        return itemDescriptorCode === "mandi" ? "mandi" : "unknown";
      default:
        return "unknown";
    }
  }

  @Post("mobility/select")
  selectCourse1(@Body() body: any) {
    console.log("select api calling");
    return this.appService.handleSelect(body);
  }

  @Post("mobility/init")
  async initCourse1(@Body() body: any) {
    console.log("init api calling");
    if (body?.message?.order?.provider?.id === "pmkisan-greviance") {
      console.log("INSIDE PMKISAN GRIEVANCE INIT...");
      const grievanceResponse =
        await this.pmkisanGrievanceService.createGrievance(body);
      console.log(
        "PM Kisan Grievance Response:",
        JSON.stringify(grievanceResponse, null, 2),
      );
      return grievanceResponse;
    } else if (
      body?.message?.order?.provider?.id?.toLowerCase() == "pmfby-agri" &&
      body?.message?.order?.items?.[0]?.id?.toLowerCase() == "pmfby"
    ) {
      console.log("INSIDE PMFBY INIT...");
      return this.appService.handlePmfbyInit(body);
    } else if (body?.message?.order?.provider?.id === "shc-discovery") {
      try {
        // Fetch soil health data

        let soilHeallthCardResponse =
          await this.appService.fetchAndMapSoilHealthCard(body);

        // Pass the first item to handleStatusForSHC for mapping
        return await this.appService.handleStatusForSHC(
          soilHeallthCardResponse,
          body,
        );
      } catch (error) {
        throw new HttpException(
          `Failed to process soil health card: ${error.message}`,
          error.status || HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else if (body?.message?.order) {
      console.log("Inside pmkisan init...");
      return this.appService.handlePmkisanInit(body);
    } else {
      return this.appService.handleInit(body);
    }
  }

  @Post("mobility/confirm")
  confirmCourse1(@Body() body: any) {
    console.log("confirm api calling");
    return this.appService.handleConfirm(body);
  }

  @Post("mobility/rating")
  giveRating1(@Body() body: any) {
    console.log("rating api calling");
    return this.appService.handleRating(body);
  }

  @Post("mobility/status")
  async handleStatus(@Body() body: any) {
    console.log("status api calling");

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
    console.log("description", description);
    console.log("id", id);

    const referer = req.get("Referer");
    console.log("Referer", referer);

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
